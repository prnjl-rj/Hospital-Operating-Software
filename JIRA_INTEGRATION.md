# HOSPITAL OPERATING SOFTWARE (HOS) — JIRA INTEGRATION & PROJECT MANAGEMENT (`JIRA_INTEGRATION.md`)

## 1. Live Atlassian Jira Cloud Integration (`prnjlrjwork.atlassian.net`)
The Hospital Operating Software is directly integrated with **Atlassian Jira Cloud** (`https://prnjlrjwork.atlassian.net`) via the **Atlassian Teamwork Graph CLI (`twg`)** and [`JiraProjectTrackerEngine`](file:///c:/Users/Pranjal/OneDrive/Desktop/Emerald%20Windows/My_Projects/HOS%20-%20Antigravity/packages/shared/src/jira/jira-sync.ts).

- **Live Jira Space (Project):** `HOS` — **Hospital Operating Software** (`id: 10002`, `https://prnjlrjwork.atlassian.net/jira/software/projects/HOS/boards`)
- **Live Jira Dashboard:** **HOS — Hospital Operating Software Dashboard** (`id: 10001`, `https://prnjlrjwork.atlassian.net/jira/dashboards/10001`)
- **Local API Gateway Endpoints:**
  - `GET /api/v1/jira/dashboard`
  - `POST /api/v1/jira/sync` (`monitoring/jira-project-state.json`)

---

## 2. Live Provisioned Workstreams on `prnjlrjwork.atlassian.net` (`HOS-1` – `HOS-15`)

| Jira Key | Workstream / Epic Summary | Live Jira Status | URL |
|---|---|---|---|
| **HOS-1** | `[EPIC-01] Architecture — 38 Hospital Services & 6 NestJS Runtime Clusters` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-1` |
| **HOS-2** | `[EPIC-02] Database — PostgreSQL 16 5-Schema Isolation, Prisma & Immutability Triggers` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-2` |
| **HOS-3** | `[EPIC-03] Identity and RBAC — 15 Hospital Roles, ABAC, JWT Rotation, TOTP MFA & Audit Chain` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-3` |
| **HOS-4** | `[EPIC-04] Backend Microservices — API Gateway BFF, Swagger & gRPC/REST Services` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-4` |
| **HOS-5** | `[EPIC-05] Clinical Workflows — OPD Queue, Immutable SOAP Notes, 500+ Bed IPD, ICU, ER & OT` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-5` |
| **HOS-6** | `[EPIC-06] Diagnostics, Pharmacy and Inventory — LIS Barcoding, Critical Alerts, RIS/PACS & FEFO` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-6` |
| **HOS-7** | `[EPIC-07] Billing, Payments and Insurance — Append-Only Ledger & Idempotency-Key Payments` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-7` |
| **HOS-8** | `[EPIC-08] Frontend Dashboards — React 18, TypeScript, Tailwind & 13 Role Portals` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-8` |
| **HOS-9** | `[EPIC-09] Docker and Local Dev — Multi-Stage Dockerfiles & 7-Container Compose Stack` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-9` |
| **HOS-10** | `[EPIC-10] Kafka Event Architecture — KRaft 3.8, 10 Topics + 10 DLQ Topics & Outbox Relay` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-10` |
| **HOS-11** | `[EPIC-11] Redis Caching, Queues, S3 KMS Documents & 6-Channel Real-Time SSE Hub` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-11` |
| **HOS-12** | `[EPIC-12] AWS and Terraform — Multi-AZ VPC, KMS, ECR, RDS, MSK, ElastiCache, S3 & WAFv2` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-12` |
| **HOS-13** | `[EPIC-13] Kubernetes and CI/CD — EKS Manifests, Helm Chart & 14-Step GitHub Actions Pipeline` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-13` |
| **HOS-14** | `[EPIC-14] Prometheus and Grafana Monitoring — PHI-Free Metrics, 5 Alert Rules & 10 Dashboards` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-14` |
| **HOS-15** | `[EPIC-15] Security, QA and Documentation — 8 Test Suites (24/24 Passing) & 25 Guides` | **Done** (`10006`) | `https://prnjlrjwork.atlassian.net/browse/HOS-15` |

---

## 3. Useful `twg` Commands for Ongoing Jira Management
```powershell
# Query all HOS workitems
& "$env:LOCALAPPDATA\Programs\twg\bin\twg.exe" jira workitem query --jql "project = HOS ORDER BY key ASC"

# Inspect a specific HOS workitem
& "$env:LOCALAPPDATA\Programs\twg\bin\twg.exe" jira workitem get HOS-1
```
