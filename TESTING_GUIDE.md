# HOSPITAL OPERATING SOFTWARE (HOS) — TESTING & QUALITY ASSURANCE GUIDE

## 1. Testing Strategy Overview
The Hospital Operating Software enforces a multi-layered automated testing pyramid against live containerized infrastructure (`hos-postgres:5435`, `hos-redis:6380`, `hos-kafka:9094`) using **Vitest** and **Supertest**. All tests execute strictly with synthetic patient records (`Rule 13 & Rule 26`).

| Test Layer | Suite File | Scope & Verification |
|---|---|---|
| **Unit — Database & Prisma Ownership** | `tests/unit/database-schemas.spec.ts` | Verifies 5 isolated PostgreSQL schemas (`identity`, `hospital_core`, `clinical`, `diagnostics_pharmacy`, `operations_billing`), PL/pgSQL immutability triggers, and zero cross-schema foreign keys. |
| **Unit — Frontend Portals & Build** | `tests/unit/frontend-portals.spec.ts` | Verifies all 13 role-based hospital portals, state stores, API client interceptors, and production Vite bundle generation. |
| **Integration — Identity, Auth, RBAC, ABAC, MFA & Audit** | `tests/integration/identity-auth-rbac.spec.ts` | Verifies 15 hospital roles, Argon2id/PBKDF2 password hashing, JWT rotation, refresh-token replay attack family revocation, TOTP MFA, ABAC evaluation, and SHA-256 hash-chained `AuditLog` with PostgreSQL immutability triggers. |
| **Integration — Core Clinical, Diagnostics, Pharmacy & Billing** | `tests/integration/core-microservices.spec.ts` | Verifies patient registration, OPD appointment conflict detection, vital signs, SOAP clinical note signature + immutability + addendum, IPD bed allocation, lab critical result alert, FEFO pharmacy dispensing, and idempotent payment processing. |
| **Integration — Apache Kafka & Transactional Outbox** | `tests/integration/kafka-outbox.spec.ts` | Verifies 10 primary hospital Kafka topics + 10 `.dlq` topics on live KRaft broker (`localhost:9094`), transactional outbox polling, `ProcessedEvent` idempotency deduplication, and dead-letter queue routing. |
| **Integration — Redis, BullMQ & S3 KMS Document Management** | `tests/integration/redis-bullmq-s3.spec.ts` | Verifies read-through TTL caching, sliding-window rate limiting, atomic Lua distributed lock (`SET NX PX`), BullMQ background worker retries/deduplication, and AWS S3 `aws:kms` presigned upload/download URLs with SHA-256 checksums. |
| **Integration — Real-Time SSE/PubSub, Security & Failure Resilience** | `tests/integration/realtime-security-resilience.spec.ts` | Verifies all 6 real-time hospital channels over Redis Pub/Sub, automatic PHI redaction, graceful fallback when Redis is unreachable (`Rule 29`), HTTP `401`/`403` RBAC enforcement, Prometheus `/api/v1/metrics`, and backup/restore scripts. |

---

## 2. Running the Test Suites

### Run All Unit and Integration Suites
```powershell
npm test
```

### Run Individual Suites
```powershell
npx vitest run tests/unit/database-schemas.spec.ts
npx vitest run tests/unit/frontend-portals.spec.ts
npx vitest run tests/integration/identity-auth-rbac.spec.ts
npx vitest run tests/integration/core-microservices.spec.ts
npx vitest run tests/integration/kafka-outbox.spec.ts
npx vitest run tests/integration/redis-bullmq-s3.spec.ts
npx vitest run tests/integration/realtime-security-resilience.spec.ts
```

---

## 3. Failure & Resilience Scenarios Tested
1. **Signed Clinical Note Tampering Attempt:** Verified that both the NestJS service layer (`ForbiddenException`) and PostgreSQL trigger (`trg_prevent_signed_clinical_note_mutation`) block any `UPDATE` or `DELETE` on signed SOAP notes (`Rule 28`).
2. **Audit Log Tampering Attempt:** Verified that `trg_prevent_audit_log_mutation` rejects `UPDATE`/`DELETE` on `identity."AuditLog"` and `verifyAuditChainIntegrity()` validates the cryptographic SHA-256 hash chain (`Rule 17`).
3. **Refresh Token Replay Attack:** Verified that presenting an already-rotated refresh token immediately revokes the entire token family (`revokeTokenFamily`).
4. **Duplicate Payment Submission:** Verified that repeating `POST /api/v1/payments` with the same `Idempotency-Key` returns the original payment receipt (`idempotentReplay: true`) without double-charging the patient (`Rule 18 & Rule 27`).
5. **Duplicate Kafka Event Delivery:** Verified that `KafkaOutboxEngine` records `(consumerGroup, eventId)` in `ProcessedEvent` and skips duplicate deliveries (`skippedDuplicate: true`).
6. **Poison Kafka Message / Handler Failure:** Verified that failing messages are retried with exponential backoff and routed to `<topic>.dlq` with error diagnostics (`Rule 20`).
7. **Redis Outage Graceful Degradation:** Verified that when Redis is unreachable, `HospitalRedisBullMqEngine` and `HospitalRealtimeHub` fall back safely to PostgreSQL and in-process `EventEmitter` without crashing clinical workflows (`Rule 29`).

