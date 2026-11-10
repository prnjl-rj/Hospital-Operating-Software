import { Admin, Consumer, Kafka, Producer, logLevel } from 'kafkajs';
import {
  HOSPITAL_KAFKA_TOPICS,
  HosEventEnvelope,
  buildEventEnvelope,
} from './event-contracts';

export interface OutboxPrismaAdapter {
  outboxEvent: {
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany?: (args: any) => Promise<any>;
  };
  processedEvent: {
    findUnique: (args: any) => Promise<any | null>;
    create: (args: any) => Promise<any>;
  };
}

export class HospitalKafkaEngine {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private admin: Admin | null = null;
  private readonly consumers: Consumer[] = [];

  constructor(
    private readonly brokers: string[] = (
      process.env.KAFKA_BROKERS || 'localhost:9094'
    ).split(','),
    private readonly clientId: string = process.env.KAFKA_CLIENT_ID || 'hos-platform',
  ) {
    this.kafka = new Kafka({
      clientId: this.clientId,
      brokers: this.brokers,
      logLevel: logLevel.ERROR,
      retry: {
        initialRetryTime: 250,
        retries: 5,
      },
    });
  }

  async connectProducerAndAdmin(): Promise<void> {
    if (!this.admin) {
      this.admin = this.kafka.admin();
      await this.admin.connect();
    }
    if (!this.producer) {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        idempotent: true,
      });
      await this.producer.connect();
    }
  }

  async ensureHospitalTopics(numPartitions = 3, replicationFactor = 1): Promise<string[]> {
    await this.connectProducerAndAdmin();
    const existingTopics = await this.admin!.listTopics();
    const requiredTopics: string[] = [];

    for (const baseTopic of HOSPITAL_KAFKA_TOPICS) {
      requiredTopics.push(baseTopic);
      requiredTopics.push(`${baseTopic}.dlq`);
    }

    const toCreate = requiredTopics
      .filter((t) => !existingTopics.includes(t))
      .map((topic) => ({
        topic,
        numPartitions: topic.endsWith('.dlq') ? 1 : numPartitions,
        replicationFactor,
      }));

    if (toCreate.length > 0) {
      await this.admin!.createTopics({
        waitForLeaders: true,
        topics: toCreate,
      });
    }

    return this.admin!.listTopics();
  }

  // ===========================================================================
  // 1. Transactional Outbox Relay Publisher (Rule 19 & Rule 20)
  // ===========================================================================
  async flushOutboxForSchema(
    prismaAdapter: OutboxPrismaAdapter,
    producerServiceName: string,
    batchSize = 50,
  ): Promise<{ publishedCount: number; dlqCount: number }> {
    await this.connectProducerAndAdmin();

    const pendingEvents = await prismaAdapter.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { occurredAt: 'asc' },
      take: batchSize,
    });

    let publishedCount = 0;
    let dlqCount = 0;

    for (const row of pendingEvents) {
      const envelope = buildEventEnvelope({
        eventId: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion || '1.0',
        occurredAt: row.occurredAt,
        producer: row.producer || producerServiceName,
        correlationId: row.correlationId,
        hospitalId: row.hospitalId,
        data: row.payload as Record<string, unknown>,
      });

      try {
        await this.producer!.send({
          topic: row.eventType,
          acks: -1,
          messages: [
            {
              key: row.partitionKey,
              value: JSON.stringify(envelope),
              headers: {
                eventId: envelope.eventId,
                eventType: envelope.eventType,
                eventVersion: envelope.eventVersion,
                correlationId: envelope.correlationId,
                producer: envelope.producer,
              },
            },
          ],
        });

        await prismaAdapter.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        });
        publishedCount++;
      } catch (err) {
        const nextRetry = (row.retryCount || 0) + 1;
        const errMessage = (err as Error).message || 'KAFKA_PUBLISH_ERROR';
        if (nextRetry >= 3) {
          // Route to Dead-Letter Queue
          await this.publishToDlq(row.eventType, envelope, errMessage, producerServiceName);
          await prismaAdapter.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: 'DLQ',
              retryCount: nextRetry,
              lastError: errMessage,
            },
          });
          dlqCount++;
        } else {
          await prismaAdapter.outboxEvent.update({
            where: { id: row.id },
            data: {
              retryCount: nextRetry,
              lastError: errMessage,
            },
          });
        }
      }
    }

    return { publishedCount, dlqCount };
  }

  // ===========================================================================
  // 2. Dead-Letter Queue (DLQ) Publisher & Replay Procedure
  // ===========================================================================
  async publishToDlq(
    originalTopic: string,
    envelope: HosEventEnvelope<any>,
    errorReason: string,
    failedConsumerGroup: string,
  ): Promise<void> {
    await this.connectProducerAndAdmin();
    const dlqTopic = originalTopic.endsWith('.dlq') ? originalTopic : `${originalTopic}.dlq`;
    await this.producer!.send({
      topic: dlqTopic,
      acks: -1,
      messages: [
        {
          key: envelope.eventId,
          value: JSON.stringify({
            ...envelope,
            dlqMetadata: {
              originalTopic,
              errorReason,
              failedConsumerGroup,
              failedAt: new Date().toISOString(),
            },
          }),
        },
      ],
    });
  }

  async replayFailedOutboxEvents(prismaAdapter: OutboxPrismaAdapter): Promise<number> {
    if (!prismaAdapter.outboxEvent.updateMany) return 0;
    const res = await prismaAdapter.outboxEvent.updateMany({
      where: { status: { in: ['FAILED', 'DLQ'] } },
      data: { status: 'PENDING', retryCount: 0, lastError: null },
    });
    return res.count ?? 0;
  }

  // ===========================================================================
  // 3. Idempotent Consumer Processing with ProcessedEvent Deduplication & DLQ
  // ===========================================================================
  async processEnvelopeIdempotently<T = Record<string, unknown>>(params: {
    envelope: HosEventEnvelope<T>;
    consumerGroup: string;
    prismaAdapter: OutboxPrismaAdapter;
    handler: (envelope: HosEventEnvelope<T>) => Promise<void>;
    maxRetries?: number;
  }): Promise<{ processed: boolean; duplicateSkipped: boolean; routedToDlq: boolean }> {
    const { envelope, consumerGroup, prismaAdapter, handler, maxRetries = 3 } = params;

    // 1. Check ProcessedEvent table for idempotency (Rule 18)
    const alreadyProcessed = await prismaAdapter.processedEvent.findUnique({
      where: {
        eventId_consumerGroup: {
          eventId: envelope.eventId,
          consumerGroup,
        },
      },
    });

    if (alreadyProcessed) {
      return { processed: false, duplicateSkipped: true, routedToDlq: false };
    }

    // 2. Execute handler with retry & DLQ fallback
    let attempt = 0;
    let lastErr: Error | null = null;
    while (attempt < maxRetries) {
      try {
        await handler(envelope);
        await prismaAdapter.processedEvent.create({
          data: {
            eventId: envelope.eventId,
            consumerGroup,
            eventType: envelope.eventType,
          },
        });
        return { processed: true, duplicateSkipped: false, routedToDlq: false };
      } catch (err) {
        lastErr = err as Error;
        attempt++;
      }
    }

    await this.publishToDlq(
      envelope.eventType,
      envelope,
      lastErr?.message || 'CONSUMER_HANDLER_FAILED',
      consumerGroup,
    );
    return { processed: false, duplicateSkipped: false, routedToDlq: true };
  }

  async createAndRunConsumer<T = Record<string, unknown>>(params: {
    consumerGroup: string;
    topics: string[];
    prismaAdapter: OutboxPrismaAdapter;
    handler: (envelope: HosEventEnvelope<T>) => Promise<void>;
  }): Promise<Consumer> {
    const consumer = this.kafka.consumer({ groupId: params.consumerGroup });
    await consumer.connect();
    for (const topic of params.topics) {
      await consumer.subscribe({ topic, fromBeginning: true });
    }

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const envelope = JSON.parse(message.value.toString()) as HosEventEnvelope<T>;
        await this.processEnvelopeIdempotently({
          envelope,
          consumerGroup: params.consumerGroup,
          prismaAdapter: params.prismaAdapter,
          handler: params.handler,
        });
      },
    });

    this.consumers.push(consumer);
    return consumer;
  }

  async getConsumerGroupOffsets(consumerGroup: string, topic: string) {
    await this.connectProducerAndAdmin();
    return this.admin!.fetchOffsets({ groupId: consumerGroup, topics: [topic] });
  }

  async disconnectAll(): Promise<void> {
    for (const c of this.consumers) {
      await c.disconnect().catch(() => {});
    }
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
    }
    if (this.admin) {
      await this.admin.disconnect().catch(() => {});
      this.admin = null;
    }
  }
}

