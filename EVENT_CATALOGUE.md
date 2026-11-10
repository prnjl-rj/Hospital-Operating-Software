# BLOCK 01 — Standardized Kafka Event Catalogue (`EVENT_CATALOGUE.md`)

## 1. Standardized Event Envelope

Every event published to Apache Kafka via the Transactional Outbox conforms to the shared TypeScript interface `HosEventEnvelope<T>`:

```json
{
  "eventId": "019314a8-7c40-7000-8000-000000000001",
  "eventType": "hospital.patient.registered",
  "eventVersion": "1.0",
  "occurredAt": "2026-11-10T10:45:00.000Z",
  "producer": "hospital-core-service",
  "correlationId": "corr-98f1a2b3-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "hospitalId": "hosp-main-001",
  "data": {
    "patientId": "pat-019314a8",
    "mrn": "HOS-2026-000001",
    "departmentId": "dept-gen-med",
    "registeredByUserId": "usr-recep-01"
  }
}
```

### Privacy & Security Rule for Events
Kafka payloads **never** include free-text clinical notes, HIV/psychiatric sensitive narratives, raw government ID numbers, or credit card details. They carry immutable entity IDs, status transitions, and operational references.

---

## 2. Topic & Event Specification Catalogue

| Topic / `eventType` | Ver | Partition Key | Producer Service | Consumer Services & Actions | Retention / DLQ |
|---|---|---|---|---|---|
| `hospital.patient.registered` | `1.0` | `patientId` | `hospital-core-service` | • `operations-billing-service`: Creates patient billing account & sends welcome notification<br>• `identity-service`: Writes compliance audit log | 7d / `.dlq` |
| `hospital.appointment.created` | `1.0` | `patientId` | `hospital-core-service` | • `operations-billing-service`: Adds OPD consultation provisional charge & queues SMS/Email confirmation via BullMQ<br>• `api-gateway`: Updates live OPD dashboard | 7d / `.dlq` |
| `hospital.appointment.cancelled` | `1.0` | `patientId` | `hospital-core-service` | • `operations-billing-service`: Voids provisional consultation charge & sends cancellation notice<br>• `api-gateway`: Broadcasts slot release | 7d / `.dlq` |
| `hospital.encounter.created` | `1.0` | `patientId` | `clinical-emr-service` | • `hospital-core-service`: Marks OPD queue token `IN_CONSULTATION`<br>• `operations-billing-service`: Opens active encounter billing folio | 30d / `.dlq` |
| `hospital.lab.order.created` | `1.0` | `patientId` | `diagnostics-pharmacy-service` | • `operations-billing-service`: Appends lab test tariff line items to invoice<br>• `api-gateway`: Pushes new order to Lab Technician portal queue | 30d / `.dlq` |
| `hospital.lab.result.ready` | `1.0` | `patientId` | `diagnostics-pharmacy-service` | • `clinical-emr-service`: Attaches result reference to Encounter timeline<br>• `operations-billing-service`: Triggers patient/doctor notification<br>• `api-gateway`: Real-time alert to ordering Doctor & Nurse dashboard | 30d / `.dlq` |
| `hospital.prescription.created` | `1.0` | `patientId` | `clinical-emr-service` | • `diagnostics-pharmacy-service`: Creates `PharmacyDispenseOrder` in Pharmacy worklist<br>• `clinical-emr-service` (Nursing/Compounder): Schedules MAR / injection tasks<br>• `api-gateway`: Live Pharmacy queue update | 30d / `.dlq` |
| `hospital.payment.completed` | `1.0` | `invoiceId` | `operations-billing-service` | • `clinical-emr-service`: Clears financial hold on IPD discharge<br>• `operations-billing-service` (Notification): Dispatches payment receipt job<br>• `identity-service`: Immutable financial audit entry | 90d / `.dlq` |
| `hospital.bed.allocated` | `1.0` | `bedId` | `clinical-emr-service` | • `operations-billing-service`: Starts daily bed-tariff billing accrual<br>• `api-gateway`: Updates live 500-bed occupancy map across Nurse & Admin portals | 30d / `.dlq` |
| `hospital.patient.discharged` | `1.0` | `patientId` | `clinical-emr-service` | • `clinical-emr-service` (Bed): Transitions bed to `CLEANING`<br>• `operations-billing-service` (Facility): Creates housekeeping turnaround task & sends discharge summary notification | 90d / `.dlq` |

---

## 3. Reliability, Retry & Dead-Letter Queue (DLQ) Strategy

1. **Transactional Outbox:** Producers insert into `OutboxEvent` (`status = PENDING`) within the same PostgreSQL transaction as the domain mutation. The Outbox Relay polls/streams pending rows, publishes to Kafka with `acks = -1` (all in-sync replicas) and `idempotent = true`, and marks `status = PUBLISHED`.
2. **Idempotent Consumers:** Every consumer wraps processing in a transaction that inserts `(eventId, consumerGroup)` into `ProcessedEvent`. If the unique constraint fails, the duplicate message is safely acknowledged and skipped.
3. **Exponential Backoff & DLQ:** Transient consumer failures retry 3 times (`1s`, `5s`, `15s`). If all retries fail, the message is published to `<topic>.dlq` with error metadata (`errorMessage`, `failedConsumerGroup`, `failedAt`) and increments the Prometheus counter `hos_kafka_dlq_messages_total`, triggering an Alertmanager alert.

