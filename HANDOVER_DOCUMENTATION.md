# HOSPITAL OPERATING SOFTWARE (HOS) — ENGINEERING HANDOVER DOCUMENTATION (`HANDOVER_DOCUMENTATION.md`)

## 1. Executive Handover Summary
The **Hospital Operating Software (HOS)** repository has been implemented end-to-end from a greenfield directory (`BLOCK 00`) to a fully verified, containerized, event-driven, monitored healthcare platform (`BLOCK 17`).

---

## 2. Repository Directory Map
- `services/api-gateway/` — Unified BFF, Swagger (`/api/docs`), Real-Time SSE Hub (`/api/v1/realtime/*`), Prometheus Exporter (`/api/v1/metrics`), Jira Tracker (`/api/v1/jira/*`).
- `services/identity-service/` — 15-Role RBAC, ABAC, JWT/Refresh Token Rotation, TOTP MFA, SHA-256 Hash-Chained `AuditLog` (`identity` schema).
- `services/hospital-core-service/` — Hospital Topology, Departments, Staff/Payroll, Doctors, MPI Patients, OPD Appointments & Queue (`hospital_core` schema).
- `services/clinical-emr-service/` — Encounters, Immutable Signed SOAP Notes + Addenda, Vitals, Prescriptions, Nursing/Compounder Tasks, 500+ Bed IPD Lifecycle, Emergency, OT, ICU (`clinical` schema).
- `services/diagnostics-pharmacy-service/` — LIS Lab Orders/Critical Alerts, RIS/PACS DICOM Metadata, FEFO Pharmacy Dispensing, Inventory Batches, Blood Bank (`diagnostics_pharmacy` schema).
- `services/operations-billing-service/` — Append-Only Invoices, Idempotent Payments, Insurance Claims, Ambulances, Biomedical Assets, Housekeeping, S3 KMS Documents (`operations_billing` schema).
- `packages/shared/` — Shared Auth Guards, gRPC Protobuf (`hospital.proto`), Kafka Outbox Engine, Redis/BullMQ Engine, Real-Time Hub, OpenTelemetry/Prometheus Registry, Jira Sync Engine.
- `frontend/` — React 18 + TypeScript + Tailwind CSS SPA with all 13 Role Portals.
- `database/` — PostgreSQL initialization (`01-init-schemas-and-roles.sql`), baseline DDL & PL/pgSQL immutability triggers (`001_baseline_multi_schema_ddl.sql`), synthetic hospital seed script (`seed-all.ts`).
- `monitoring/` — Prometheus, Alertmanager, and Grafana 10-Domain Dashboard provisioning.
- `infrastructure/` — AWS Multi-AZ Terraform (`terraform/`), Kubernetes manifests (`k8s/`), and Helm chart (`helm/hos-chart/`).
- `.github/workflows/ci-cd.yml` — 14-step GitHub Actions CI/CD pipeline.
- `tests/` — Automated Unit, Integration, and End-to-End verification suites.

---

## 3. Clinical & Business Rule Safeguards (Section 2 Compliance)
- **Synthetic Data Only:** All seed scripts (`database/seeds/seed-all.ts`) and tests use strictly synthetic patient records (`Rule 13 & Rule 26`).
- **Clinical Note Immutability:** Signed SOAP notes cannot be modified or deleted in either application code or PostgreSQL (`trg_prevent_signed_clinical_note_mutation`, `Rule 28`).
- **Financial Ledger Integrity:** Finalized invoices are append-only and payments enforce `Idempotency-Key` deduplication (`Rule 18 & Rule 27`).
- **Configurable Clinical Policy Thresholds:** Reference ranges for critical lab alerts and FEFO expiry windows are parameterized in database metadata rather than hardcoded clinical assumptions.

