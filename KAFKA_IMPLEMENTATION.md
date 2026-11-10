# BLOCK 07 — Apache Kafka (KRaft Mode), Transactional Outbox & Idempotent Consumers (`KAFKA_IMPLEMENTATION.md`)

## 1. ZooKeeper-less KRaft Broker Configuration

Apache Kafka (`apache/kafka:3.8.0`, container `hos-kafka`) runs in **KRaft mode** (`KAFKA_PROCESS_ROLES=broker,controller`) with two listeners:
- **Internal Container Listener (`PLAINTEXT://kafka:29092`):** Used by `hos-kafka-ui` and containerized microservices on `hos-internal-net`.
- **External Host Listener (`EXTERNAL://localhost:9094`):** Used by host development processes and integration test runners.
- **Kafka UI:** Accessible at `http://localhost:8085` connected to `hos-kraft-cluster` (`kafka:29092`).

---

## 2. Standardized Event Envelope (`HosEventEnvelope<T>`)

Defined in [`packages/shared/src/kafka/event-contracts.ts`](file:///c:/Users/Pranjal/OneDrive/Desktop/Emerald%20Windows/My_Projects/HOS%20-%20Antigravity/packages/shared/src/kafka/event-contracts.ts):

```typescript
export interface HosEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  hospitalId?: string;
  data: T;
}
```

---

## 3. Provisioned Topics & Dead-Letter Queues (`.dlq`)

`HospitalKafkaEngine.ensureHospitalTopics()` automatically provisions **10 primary topics** (`3` partitions each) and **10 corresponding Dead-Letter Queue (`.dlq`) topics**:
1. `hospital.patient.registered` (+ `.dlq`)
2. `hospital.appointment.created` (+ `.dlq`)
3. `hospital.appointment.cancelled` (+ `.dlq`)
4. `hospital.encounter.created` (+ `.dlq`)
5. `hospital.lab.order.created` (+ `.dlq`)
6. `hospital.lab.result.ready` (+ `.dlq`)
7. `hospital.prescription.created` (+ `.dlq`)
8. `hospital.payment.completed` (+ `.dlq`)
9. `hospital.bed.allocated` (+ `.dlq`)
10. `hospital.patient.discharged` (+ `.dlq`)

---

## 4. Transactional Outbox & Idempotent Consumer Flow

1. **Producer Transaction:** Domain services write the domain entity and an `OutboxEvent` (`status = 'PENDING'`) in the **same PostgreSQL ACID transaction**.
2. **Outbox Relay (`flushOutboxForSchema`):** Reads `PENDING` rows, publishes to Kafka with `acks = -1` and `idempotent = true`, and updates `status = 'PUBLISHED'`.
3. **Idempotent Consumer (`processEnvelopeIdempotently`):** Checks `(eventId, consumerGroup)` in the target schema's `ProcessedEvent` table before executing the handler. Duplicate deliveries return `{ duplicateSkipped: true }` with zero duplicate side effects.
4. **Retry & DLQ Fallback:** Transient consumer errors retry up to `3` times. Permanent failures publish the envelope + `dlqMetadata` to `<topic>.dlq`.
5. **Replay Procedure (`replayFailedOutboxEvents`):** Resets `FAILED`/`DLQ` outbox rows to `PENDING` for controlled re-publishing.

