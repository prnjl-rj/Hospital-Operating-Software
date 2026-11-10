import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { HospitalKafkaEngine } from '../../packages/shared/src/kafka/kafka-outbox-engine';
import { HOSPITAL_KAFKA_TOPICS } from '../../packages/shared/src/kafka/event-contracts';
import { HospitalCoreService } from '../../services/hospital-core-service/src/hospital-core.service';
import { OperationsBillingService } from '../../services/operations-billing-service/src/operations-billing.service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

describe('BLOCK 07 — Live Apache Kafka (KRaft) Outbox Publishing, Idempotent Consumption & DLQ Integration', () => {
  let kafkaEngine: HospitalKafkaEngine;
  let coreService: HospitalCoreService;
  let opsService: OperationsBillingService;

  beforeAll(async () => {
    kafkaEngine = new HospitalKafkaEngine(['localhost:9094'], 'hos-integration-test');
    coreService = new HospitalCoreService();
    opsService = new OperationsBillingService();
  });

  afterAll(async () => {
    await kafkaEngine.disconnectAll();
    await coreService.onModuleDestroy();
    await opsService.onModuleDestroy();
  });

  it('provisions all 10 hospital topics and 10 DLQ topics on live KRaft broker', async () => {
    const allTopics = await kafkaEngine.ensureHospitalTopics(3, 1);
    for (const topic of HOSPITAL_KAFKA_TOPICS) {
      expect(allTopics).toContain(topic);
      expect(allTopics).toContain(`${topic}.dlq`);
    }
  });

  it('publishes pending PostgreSQL OutboxEvents from hospital_core to Kafka and consumes idempotently in operations_billing', async () => {
    // 1. Register a patient in hospital-core-service -> creates PENDING OutboxEvent
    const patient = await coreService.registerPatient(
      {
        hospitalId: 'hosp-main-001',
        firstName: 'Meera',
        lastName: 'Deshmukh (Kafka Outbox Test)',
        dateOfBirth: '1988-03-15',
        gender: 'FEMALE',
        bloodGroup: 'AB+',
        phone: `+91-97${Math.floor(10000000 + Math.random() * 89999999)}`,
        addressLine: '77 KRaft Event Lane',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
      },
      'usr-recep-01',
    );

    // 2. Flush Outbox from hospital_core schema to live Kafka broker
    const flushResult = await kafkaEngine.flushOutboxForSchema(
      coreService.prisma as any,
      'hospital-core-service',
      100,
    );
    expect(flushResult.publishedCount).toBeGreaterThanOrEqual(1);
    expect(flushResult.dlqCount).toBe(0);

    // Verify OutboxEvent for this patient is now marked PUBLISHED in PostgreSQL
    const publishedOutbox = await coreService.prisma.outboxEvent.findFirst({
      where: {
        partitionKey: patient.id,
        eventType: 'hospital.patient.registered',
      },
    });
    expect(publishedOutbox).not.toBeNull();
    expect(publishedOutbox!.status).toBe('PUBLISHED');

    // 3. Process the event idempotently in operations-billing-service (creates Welcome Notification)
    let sideEffectExecutions = 0;
    const envelope = {
      eventId: publishedOutbox!.id,
      eventType: publishedOutbox!.eventType,
      eventVersion: '1.0',
      occurredAt: publishedOutbox!.occurredAt.toISOString(),
      producer: 'hospital-core-service',
      correlationId: publishedOutbox!.correlationId,
      hospitalId: publishedOutbox!.hospitalId,
      data: publishedOutbox!.payload as Record<string, any>,
    };

    const firstConsume = await kafkaEngine.processEnvelopeIdempotently({
      envelope,
      consumerGroup: 'hos-cg-operations-billing',
      prismaAdapter: opsService.prisma as any,
      handler: async (env) => {
        sideEffectExecutions++;
        await opsService.queueNotification({
          hospitalId: env.hospitalId || 'hosp-main-001',
          recipientPhone: patient.phone,
          channel: 'SMS',
          templateCode: 'PATIENT_WELCOME_MRN',
          subject: 'Welcome to Emerald Multispecialty Hospital',
          body: `Synthetic Registration Confirmed: MRN ${env.data.mrn}`,
          correlationId: env.correlationId,
        });
      },
    });
    expect(firstConsume.processed).toBe(true);
    expect(firstConsume.duplicateSkipped).toBe(false);
    expect(sideEffectExecutions).toBe(1);

    // 4. Duplicate Kafka delivery test: re-deliver exact same eventId -> must skip without duplicate side effect!
    const duplicateConsume = await kafkaEngine.processEnvelopeIdempotently({
      envelope,
      consumerGroup: 'hos-cg-operations-billing',
      prismaAdapter: opsService.prisma as any,
      handler: async () => {
        sideEffectExecutions++;
      },
    });
    expect(duplicateConsume.processed).toBe(false);
    expect(duplicateConsume.duplicateSkipped).toBe(true);
    expect(sideEffectExecutions).toBe(1);
  });

  it('routes poison/failing events to the .dlq Dead-Letter Queue topic after max retries', async () => {
    const poisonEnvelope = {
      eventId: `poison-${Date.now()}`,
      eventType: 'hospital.payment.completed',
      eventVersion: '1.0',
      occurredAt: new Date().toISOString(),
      producer: 'operations-billing-service',
      correlationId: `corr-poison-${Date.now()}`,
      hospitalId: 'hosp-main-001',
      data: { invalidPayload: true },
    };

    let attempts = 0;
    const dlqResult = await kafkaEngine.processEnvelopeIdempotently({
      envelope: poisonEnvelope,
      consumerGroup: 'hos-cg-clinical-emr',
      prismaAdapter: opsService.prisma as any,
      maxRetries: 3,
      handler: async () => {
        attempts++;
        throw new Error('SIMULATED_DOWNSTREAM_CONSUMER_FAILURE');
      },
    });

    expect(attempts).toBe(3);
    expect(dlqResult.routedToDlq).toBe(true);
    expect(dlqResult.processed).toBe(false);
  });
});

