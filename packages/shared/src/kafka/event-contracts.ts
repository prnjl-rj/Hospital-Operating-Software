export const HOSPITAL_KAFKA_TOPICS = [
  'hospital.patient.registered',
  'hospital.appointment.created',
  'hospital.appointment.cancelled',
  'hospital.encounter.created',
  'hospital.lab.order.created',
  'hospital.lab.result.ready',
  'hospital.prescription.created',
  'hospital.payment.completed',
  'hospital.bed.allocated',
  'hospital.patient.discharged',
] as const;

export type HospitalEventType = (typeof HOSPITAL_KAFKA_TOPICS)[number];

// Standardized Event Envelope required by BLOCK 07
export interface HosEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  eventType: HospitalEventType | string;
  eventVersion: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  hospitalId?: string;
  data: T;
}

export function buildEventEnvelope<T>(params: {
  eventId: string;
  eventType: string;
  eventVersion?: string;
  occurredAt?: Date | string;
  producer: string;
  correlationId: string;
  hospitalId?: string;
  data: T;
}): HosEventEnvelope<T> {
  return {
    eventId: params.eventId,
    eventType: params.eventType,
    eventVersion: params.eventVersion || '1.0',
    occurredAt:
      params.occurredAt instanceof Date
        ? params.occurredAt.toISOString()
        : params.occurredAt || new Date().toISOString(),
    producer: params.producer,
    correlationId: params.correlationId,
    hospitalId: params.hospitalId,
    data: params.data,
  };
}

