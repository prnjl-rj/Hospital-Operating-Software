import { EventEmitter } from 'events';
import Redis from 'ioredis';

export type RealtimeChannel =
  | 'OPD_QUEUE_UPDATE'
  | 'BED_AVAILABILITY_UPDATE'
  | 'LAB_CRITICAL_RESULT_ALERT'
  | 'PHARMACY_DISPENSE_UPDATE'
  | 'NURSING_TASK_UPDATE'
  | 'ADMIN_SYSTEM_NOTIFICATION';

export interface RealtimeBroadcastEvent {
  eventId: string;
  channel: RealtimeChannel;
  hospitalId: string;
  departmentId?: string;
  targetRoles?: string[];
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  occurredAt: string;
  correlationId?: string;
  // Strictly non-PHI operational payload (no patient names, phone numbers, or Aadhaar/IDs)
  payload: Record<string, unknown>;
}

const PHI_FORBIDDEN_FIELDS = new Set([
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'email',
  'nationalIdHash',
  'address',
  'subjective',
  'objective',
  'assessment',
  'plan',
]);

export function sanitizeRealtimePayload(input: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (PHI_FORBIDDEN_FIELDS.has(k)) {
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = sanitizeRealtimePayload(v as Record<string, unknown>);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

export class HospitalRealtimeHub {
  private readonly emitter = new EventEmitter();
  private readonly recentBuffer: RealtimeBroadcastEvent[] = [];
  private readonly maxBufferSize = 100;
  private pubClient?: Redis;
  private subClient?: Redis;
  private redisConnected = false;

  constructor(redisUrl?: string) {
    this.emitter.setMaxListeners(500);
    const url = redisUrl || process.env.REDIS_URL;
    if (url) {
      try {
        this.pubClient = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        this.subClient = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        this.pubClient.on('error', () => {
          this.redisConnected = false;
        });
        this.subClient.on('error', () => {
          this.redisConnected = false;
        });
      } catch {
        this.redisConnected = false;
      }
    }
  }

  async connectRedis(): Promise<boolean> {
    if (!this.pubClient || !this.subClient) return false;
    try {
      await this.pubClient.connect();
      await this.subClient.connect();
      await this.subClient.subscribe('hos:realtime:broadcast');
      this.subClient.on('message', (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as RealtimeBroadcastEvent;
          this.emitLocal(parsed);
        } catch {
          // Ignore malformed broadcast messages
        }
      });
      this.redisConnected = true;
      return true;
    } catch {
      this.redisConnected = false;
      return false;
    }
  }

  private emitLocal(event: RealtimeBroadcastEvent): void {
    this.recentBuffer.unshift(event);
    if (this.recentBuffer.length > this.maxBufferSize) {
      this.recentBuffer.pop();
    }
    this.emitter.emit('broadcast', event);
    this.emitter.emit(`hospital:${event.hospitalId}`, event);
    this.emitter.emit(`channel:${event.channel}`, event);
  }

  async publish(event: Omit<RealtimeBroadcastEvent, 'occurredAt' | 'payload'> & { payload: Record<string, unknown> }): Promise<RealtimeBroadcastEvent> {
    const sanitizedEvent: RealtimeBroadcastEvent = {
      ...event,
      occurredAt: new Date().toISOString(),
      payload: sanitizeRealtimePayload(event.payload),
    };

    if (this.redisConnected && this.pubClient) {
      try {
        await this.pubClient.publish('hos:realtime:broadcast', JSON.stringify(sanitizedEvent));
        return sanitizedEvent;
      } catch {
        // Graceful fallback to local EventEmitter when Redis is degraded (Rule 29)
      }
    }

    this.emitLocal(sanitizedEvent);
    return sanitizedEvent;
  }

  /**
   * Translates a domain Kafka event into the appropriate real-time hospital channel
   */
  async bridgeKafkaEvent(kafkaEvent: {
    eventId: string;
    eventType: string;
    hospitalId: string;
    correlationId?: string;
    payload: Record<string, unknown>;
  }): Promise<RealtimeBroadcastEvent | null> {
    const mapping: Record<
      string,
      { channel: RealtimeChannel; severity: 'INFO' | 'WARNING' | 'CRITICAL'; targetRoles: string[] }
    > = {
      'appointment.checked_in': {
        channel: 'OPD_QUEUE_UPDATE',
        severity: 'INFO',
        targetRoles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'DEPARTMENT_HEAD', 'HOSPITAL_ADMIN'],
      },
      'bed.allocated': {
        channel: 'BED_AVAILABILITY_UPDATE',
        severity: 'INFO',
        targetRoles: ['WARD_MANAGER', 'NURSE', 'DOCTOR', 'RECEPTIONIST', 'HOSPITAL_ADMIN'],
      },
      'bed.released': {
        channel: 'BED_AVAILABILITY_UPDATE',
        severity: 'INFO',
        targetRoles: ['WARD_MANAGER', 'NURSE', 'HOUSEKEEPING_SUPERVISOR', 'HOSPITAL_ADMIN'],
      },
      'lab.result.published': {
        channel: Boolean(kafkaEvent.payload?.isCritical) ? 'LAB_CRITICAL_RESULT_ALERT' : 'NURSING_TASK_UPDATE',
        severity: Boolean(kafkaEvent.payload?.isCritical) ? 'CRITICAL' : 'INFO',
        targetRoles: ['DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'DEPARTMENT_HEAD'],
      },
      'pharmacy.dispensed': {
        channel: 'PHARMACY_DISPENSE_UPDATE',
        severity: 'INFO',
        targetRoles: ['PHARMACIST', 'NURSE', 'COMPOUNDER', 'DOCTOR'],
      },
      'admission.discharged': {
        channel: 'NURSING_TASK_UPDATE',
        severity: 'INFO',
        targetRoles: ['NURSE', 'WARD_MANAGER', 'BILLING_OFFICER', 'HOUSEKEEPING_SUPERVISOR'],
      },
      'payment.completed': {
        channel: 'ADMIN_SYSTEM_NOTIFICATION',
        severity: 'INFO',
        targetRoles: ['BILLING_OFFICER', 'HOSPITAL_ADMIN', 'SUPER_ADMIN'],
      },
    };

    const route = mapping[kafkaEvent.eventType];
    if (!route) return null;

    return this.publish({
      eventId: kafkaEvent.eventId,
      channel: route.channel,
      hospitalId: kafkaEvent.hospitalId,
      targetRoles: route.targetRoles,
      severity: route.severity,
      correlationId: kafkaEvent.correlationId,
      payload: kafkaEvent.payload,
    });
  }

  subscribeForUser(
    filter: { hospitalId: string; role: string; channels?: RealtimeChannel[] },
    listener: (event: RealtimeBroadcastEvent) => void,
  ): () => void {
    const handler = (event: RealtimeBroadcastEvent) => {
      if (event.hospitalId !== filter.hospitalId) return;
      if (
        filter.role !== 'SUPER_ADMIN' &&
        filter.role !== 'HOSPITAL_ADMIN' &&
        event.targetRoles &&
        event.targetRoles.length > 0 &&
        !event.targetRoles.includes(filter.role)
      ) {
        return;
      }
      if (filter.channels && filter.channels.length > 0 && !filter.channels.includes(event.channel)) {
        return;
      }
      listener(event);
    };

    this.emitter.on(`hospital:${filter.hospitalId}`, handler);
    return () => {
      this.emitter.off(`hospital:${filter.hospitalId}`, handler);
    };
  }

  getRecentEvents(hospitalId: string, role: string, limit = 25): RealtimeBroadcastEvent[] {
    return this.recentBuffer
      .filter((event) => {
        if (event.hospitalId !== hospitalId) return false;
        if (
          role !== 'SUPER_ADMIN' &&
          role !== 'HOSPITAL_ADMIN' &&
          event.targetRoles &&
          event.targetRoles.length > 0 &&
          !event.targetRoles.includes(role)
        ) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    if (this.subClient) {
      await this.subClient.quit().catch(() => undefined);
    }
    if (this.pubClient) {
      await this.pubClient.quit().catch(() => undefined);
    }
  }
}

export const globalRealtimeHub = new HospitalRealtimeHub();

