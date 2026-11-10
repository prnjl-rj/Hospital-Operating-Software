# HOSPITAL OPERATING SOFTWARE (HOS) — ENTERPRISE 500+ BED MULTISPECIALTY PLATFORM

## 1. Overview
**Hospital Operating Software (HOS)** is an enterprise-grade, multi-tenant, event-driven hospital operating platform engineered for a **500+ bed multispecialty hospital** supporting multiple buildings, floors, wards, departments, hundreds of staff, and thousands of concurrent patients.

---

## 2. Technology Stack
- **Frontend (`frontend/`):** React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, Zod — implementing **13 role-based hospital portals**.
- **Backend Microservices (`services/`):** Node.js 22, TypeScript, NestJS 10, OpenAPI/Swagger, gRPC Protobuf (`packages/shared/src/grpc/hospital.proto`), structured across **6 deployable NestJS runtimes** encapsulating all **38 hospital domain services**:
  1. `api-gateway` (`:4000`) — BFF, OpenAPI `/api/docs`, SSE Real-Time Hub, Prometheus `/api/v1/metrics`, Jira Tracker.
  2. `identity-service` (`:4001`) — 15-Role RBAC, ABAC, JWT rotation, Replay-Attack Family Revocation, TOTP MFA, SHA-256 Hash-Chained `AuditLog`.
  3. `hospital-core-service` (`:4002`) — Multi-building topology, Departments, HR/Staff/Payroll, Doctors, Master Patient Index (MPI), OPD Appointment & Queue Engine.
  4. `clinical-emr-service` (`:4003`) — Encounters, Immutable Signed SOAP Notes + Addenda, Vital Signs, E-Prescriptions, Nursing & Compounder MAR, 500+ Bed IPD Admissions/Transfers/Discharge, Emergency Triage, OT Scheduling, ICU Flowsheets.
  5. `diagnostics-pharmacy-service` (`:4004`) — Laboratory LIS (Specimen Barcoding + Critical Result Alerts), Radiology RIS/PACS DICOM Metadata, FEFO Pharmacy Dispensing, Inventory Batches, Blood Bank Crossmatch.
  6. `operations-billing-service` (`:4005`) — Append-Only Invoices, Idempotent Payments (`Idempotency-Key`), Insurance Pre-Auth/Claims, Ambulance Fleet, Biomedical Assets, Housekeeping Turnaround, KMS-Encrypted S3 Medical Documents, Executive KPIs.
- **Database (`database/`):** PostgreSQL 16 (`hos-postgres:5435`) with **5 isolated database schemas** (`identity`, `hospital_core`, `clinical`, `diagnostics_pharmacy`, `operations_billing`), 5 independent Prisma clients, and PL/pgSQL immutability triggers (`trg_prevent_signed_clinical_note_mutation`, `trg_prevent_audit_log_mutation`).
- **Event Streaming (`packages/shared/src/kafka/`):** Apache Kafka 3.8 KRaft (`hos-kafka:9094`, Kafka UI `:8085`) with **10 primary hospital topics + 10 `.dlq` topics**, Transactional Outbox publishing, and `ProcessedEvent` idempotent consumer deduplication.
- **Caching, Locks & Queues (`packages/shared/src/redis/`):** Redis 7 (`hos-redis:6380`) + BullMQ background workers + Lua atomic distributed locks + graceful fallback when Redis is unavailable (`Rule 29`).
- **Observability (`monitoring/`):** Prometheus (`:9095`), Alertmanager (`:9096`), Grafana (`:3035` with 10 hospital dashboard panels), and W3C OpenTelemetry trace propagation.
- **Cloud, K8s & CI/CD (`infrastructure/`, `.github/workflows/`):** AWS Multi-AZ Terraform (`infrastructure/terraform/`), Kubernetes & Helm (`infrastructure/k8s/`, `infrastructure/helm/hos-chart/`), and 14-step GitHub Actions pipeline (`.github/workflows/ci-cd.yml`).

---

## 3. Quick Start Commands
```powershell
# 1. Start Local Infrastructure (PostgreSQL, Redis, Kafka KRaft, Prometheus, Alertmanager, Grafana)
docker compose up -d

# 2. Generate All 5 Prisma Clients, Push Schemas & Seed Synthetic Hospital Data
npm run db:generate
npm run db:push
npm run db:seed

# 3. Run Complete Automated Unit, Integration & E2E Verification Suite
npm test

# 4. Build Frontend Production Bundle
npm --workspace=@hos/frontend run build
```

