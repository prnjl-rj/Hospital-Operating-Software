# BLOCK 00 — Implementation Gap Analysis (`IMPLEMENTATION_GAP_ANALYSIS.md`)

This document compares the current repository baseline (greenfield directory) against the target requirements for the **500+ Bed Multispecialty Hospital Operating Software (HOS)**.

---

## 1. Functional & Architectural Gap Matrix

| Domain / Requirement | Current State | Target State | Assigned Block |
|---|---|---|---|
| **Target Architecture & 38 Hospital Domains** | Not defined | Cohesive domain-driven microservice boundaries, API contracts, gRPC proto definitions, and Kafka event catalogue covering all 38 required services | **BLOCK 01** |
| **PostgreSQL & Prisma Multi-Schema Ownership** | None (Local PG 16 service running) | Per-service isolated PostgreSQL schemas, Prisma schemas, migrations, transactional outbox tables, processed-event idempotency tables, audit logs, and synthetic seed scripts | **BLOCK 02** |
| **Identity, Authentication & RBAC/ABAC** | None | JWT access + refresh tokens, Argon2/bcrypt hashing, MFA support, 15 hospital roles, permission & resource-level guards, internal S2S authentication, and audit trail | **BLOCK 03** |
| **Core Backend Microservices (NestJS)** | None | NestJS microservices + API Gateway/BFF with Swagger/OpenAPI, DTO validation, gRPC internal links, repositories, pagination, health checks, unit & integration tests | **BLOCK 04** |
| **Frontend Portals (React + Vite + Tailwind + shadcn/ui)** | None | 13 role-based portals (Super Admin, Hospital Admin, Doctor, Nurse, Compounder, Receptionist, Pharmacy, Lab, Radiology, Billing, HR, Inventory, Patient) connected to live backend APIs | **BLOCK 05** |
| **Docker & Local Dev Infrastructure** | None (Docker daemon stopped) | Multi-stage `Dockerfile`s and `docker-compose.yml` orchestrating PostgreSQL, Redis, Kafka (KRaft), Kafka UI, Prometheus, Grafana, Loki, Tempo, and HOS services | **BLOCK 06** |
| **Apache Kafka (KRaft) & Transactional Outbox** | None | KRaft broker setup, shared event-contract library, standardized event envelope, 10+ domain events, Outbox relay publisher, idempotent consumers, retry + DLQ | **BLOCK 07** |
| **Redis & BullMQ Background Jobs** | None | Redis caching, rate limiting, session revocation, distributed locks, and BullMQ queues for notifications, reminders, reports, and document workflows | **BLOCK 08** |
| **AWS S3 & Medical Document Management** | None | Presigned URL upload/download, MIME & size validation, KMS encryption config, metadata ownership, PACS/DICOM integration boundary, and audit logging | **BLOCK 09** |
| **Real-Time Communication (WebSockets / SSE)** | None | Live OPD queue updates, bed availability board, lab critical result alerts, nursing & pharmacy status streams bridged from Kafka | **BLOCK 10** |
| **Testing & Security Hardening** | None | Unit, integration, E2E, contract, failure-recovery tests; Helmet, CORS, rate-limiting, SQLi/XSS protection, secret & dependency scanning | **BLOCK 11** |
| **Observability (Prometheus, Grafana, OpenTelemetry)** | None | `/metrics` endpoints, OpenTelemetry traces, 10 Grafana dashboards, Alertmanager rules for latency, errors, consumer lag, outbox backlog, and DLQ growth | **BLOCK 12** |
| **AWS Cloud Infrastructure (Terraform)** | None | Modular Terraform IaC for VPC, EKS/ECS, RDS PostgreSQL, Amazon MSK, ElastiCache Redis, S3, KMS, Secrets Manager, ALB, WAF, CloudFront, Route 53, Backup | **BLOCK 13** |
| **Kubernetes & Helm Production Deployment** | None | K8s manifests + Helm charts, ConfigMaps, ExternalSecrets, HPA, PDB, NetworkPolicies, readiness/liveness probes, ordered rollout | **BLOCK 14** |
| **CI/CD Pipelines (GitHub Actions)** | None | Lint, typecheck, test, security scan, multi-stage Docker build, Trivy scan, ECR push via OIDC, staging deploy, smoke test, gated production deploy & rollback | **BLOCK 15** |
| **Jira Project Management Integration** | None | Jira REST API / Atlassian integration script & configuration for Epics, Tasks, Subtasks, Sprints, and Dashboards across all 15 engineering workstreams | **BLOCK 16** |
| **End-to-End Clinical & Operational Validation** | None | Verified end-to-end flows: Patient Registration -> OPD -> Lab -> Pharmacy -> IPD/Bed -> Billing/Payment -> Discharge -> Outbox/Kafka -> Monitoring | **BLOCK 17** |

---

## 2. External Credentials, Daemons & Extensions Schedule

In accordance with **Section 5 (Credential and Access Management)**, we will **not** request all credentials upfront. Below is the exact schedule of when external actions or credentials become relevant:

1. **Immediate (For BLOCK 02 / 06 / 07 / 08 Local Infrastructure Verification):**
   - **Docker Desktop:** Please start **Docker Desktop** on your Windows machine so `docker compose up -d` can launch PostgreSQL, Redis, Kafka (KRaft), Prometheus, and Grafana containers.
   - **Local PostgreSQL 16 (Alternative/Immediate for Block 02):** Since `postgresql-x64-16` is already running on `localhost:5432`, if you want us to run Prisma migrations directly against your host PostgreSQL before Docker Desktop starts, provide or configure `DATABASE_URL` in `.env`. (Otherwise, once Docker Desktop is started, we will spin up a dedicated PostgreSQL container automatically!)
2. **At BLOCK 09 & BLOCK 13 (AWS S3 & Cloud Infrastructure):**
   - We will author all S3 code (with local fallback/mock support) and complete Terraform modules first, and only request AWS IAM role/profile credentials if you wish to run `aws s3` / `terraform plan` against a live AWS account.
3. **At BLOCK 16 (Jira Integration):**
   - We will inspect Jira integration options (including the Atlassian Teamwork Graph plugin or Jira REST API token) and ask for your Jira Site URL, Project Key, and API Token at Block 16.

