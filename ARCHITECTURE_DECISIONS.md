# BLOCK 01 — Architecture Decision Records (`ARCHITECTURE_DECISIONS.md`)

## ADR-001: Modular Domain-Clustered Microservices over 38 Nano-Containers
- **Context:** The hospital requires 38 distinct functional capabilities. Deploying 38 separate Node.js containers locally and in Kubernetes would consume >15 GB of idle RAM and introduce excessive network hops.
- **Decision:** Group the 38 required domain services into **6 cohesive, domain-aligned NestJS microservice runtimes** (`api-gateway`, `identity-service`, `hospital-core-service`, `clinical-emr-service`, `diagnostics-pharmacy-service`, `operations-billing-service`), where each capability is a self-contained NestJS module with clear interfaces.
- **Consequences:** All 38 capabilities are fully implemented and independently testable; any module can be extracted into its own container in minutes if load demands it, while keeping local Docker Compose and EKS operational overhead practical.

## ADR-002: PostgreSQL with Isolated Per-Service Schemas and Dedicated Credentials
- **Context:** Microservices must never share tables or perform cross-service SQL joins, yet running 6 separate RDS clusters in development/staging is cost-prohibitive.
- **Decision:** Use PostgreSQL 16 as the single ACID transactional engine, enforcing strict logical isolation via dedicated schemas (`identity`, `hospital_core`, `clinical`, `diagnostics_pharmacy`, `operations_billing`), separate Prisma schemas, independent migration histories, and dedicated PostgreSQL role credentials per service.
- **Consequences:** Zero cross-service table coupling, full ACID guarantees for clinical and financial records, and seamless migration to dedicated RDS instances per service at scale.

## ADR-003: Apache Kafka in KRaft Mode + Transactional Outbox Pattern
- **Context:** Dual-writing to PostgreSQL and Kafka directly in request handlers risks lost events or phantom events when a process crashes mid-request.
- **Decision:** Run Apache Kafka in ZooKeeper-less **KRaft mode** and enforce the **Transactional Outbox Pattern** (`OutboxEvent` table) on producers and **Idempotent Consumer Pattern** (`ProcessedEvent` table) on consumers.
- **Consequences:** Guaranteed event delivery even if Kafka is temporarily unreachable during a clinical or billing write operation.

## ADR-004: Immutable Signed Clinical Records with Addendum-Only Corrections
- **Context:** Medical-legal compliance prohibits silently altering a signed doctor's note, prescription, or diagnostic report.
- **Decision:** Enforce a state check in `clinical-emr-service` and `diagnostics-pharmacy-service` that blocks `UPDATE`/`DELETE` once `status == 'SIGNED'` or `'FINALIZED'`. Amendments must be appended as `ClinicalNoteAddendum` records preserving the original signed snapshot and cryptographic content hash.
- **Consequences:** Full medico-legal auditability and compliance with Rule 27 & Rule 28.

## ADR-005: Redis + BullMQ Restricted to Ephemeral State, Caching & Background Jobs
- **Context:** High-read dashboards and asynchronous notifications require low-latency caching and delayed job queues.
- **Decision:** Use Redis 7 strictly for rate limiting, short-TTL read caching (KPIs, department catalogs), WebSocket pub/sub coordination, and BullMQ background jobs. Never store authoritative clinical, inventory, or financial state exclusively in Redis, and degrade gracefully to PostgreSQL if Redis is unreachable.
- **Consequences:** High performance without risking clinical or financial data loss on cache eviction.

