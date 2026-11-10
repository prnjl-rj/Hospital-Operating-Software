# BLOCK 04 — API Documentation (`API_DOCUMENTATION.md`)

## 1. Interactive OpenAPI / Swagger Endpoint

When the API Gateway is running, full interactive OpenAPI 3.0 documentation is served at:
- **Swagger UI:** `http://localhost:4000/api/docs`
- **Unified Gateway Base URL:** `http://localhost:4000/api/v1`

---

## 2. Core REST & S2S API Catalogue

### 2.1 Identity, Authentication, RBAC & Audit (`identity-service` / `:4001`)
| Method | Path | Required Permission / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | `@Public()` | Authenticates user, checks TOTP MFA, creates session & refresh token |
| `POST` | `/api/v1/auth/refresh` | `@Public()` | Rotates refresh token & detects token-family replay attacks |
| `POST` | `/api/v1/auth/logout` | Authenticated | Terminates active session and revokes refresh token |
| `POST` | `/api/v1/auth/mfa/setup` | Authenticated | Generates RFC 6238 TOTP secret |
| `POST` | `/api/v1/auth/mfa/verify` | Authenticated | Verifies 6-digit TOTP code and enables MFA |
| `POST` | `/api/v1/auth/password/forgot` | `@Public()` | Issues single-use password reset token |
| `POST` | `/api/v1/auth/password/reset` | `@Public()` | Resets password and revokes all active refresh tokens |
| `POST` | `/api/v1/rbac/assign` | `SUPER_ADMIN`, `HOSPITAL_ADMIN` | Assigns role + department/ward ABAC scope |
| `GET` | `/api/v1/audit/logs` | `audit:read` | Paginated hash-chained compliance audit trail |
| `GET` | `/api/v1/audit/verify-integrity/:hospitalId` | `audit:read` | Verifies cryptographic SHA-256 chain across all audit logs |

### 2.2 Hospital Core, Workforce, Patients, Appointments, OPD & HR (`hospital-core-service` / `:4002`)
| Method | Path | Required Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/hospitals/:hospitalId/topology` | Authenticated | Returns hospital buildings, floors, and active departments |
| `POST` | `/api/v1/departments` | `department:manage` | Creates a hospital department and emits Outbox event |
| `GET/POST` | `/api/v1/employees` | `employee:manage` | Lists or registers hospital employees |
| `POST` | `/api/v1/hr/payroll/run` | `hr:payroll:run` | Executes monthly payroll run and generates payslips |
| `GET` | `/api/v1/doctors` | Authenticated | Lists doctors and OPD schedule templates |
| `GET/POST` | `/api/v1/patients` | `patient:read` / `patient:write` | Searches or registers synthetic patients with auto-MRN |
| `POST` | `/api/v1/appointments` | `appointment:manage` | Books appointment with slot conflict protection (`409 Conflict`) |
| `POST` | `/api/v1/appointments/:id/cancel` | `appointment:manage` | Cancels appointment and emits `hospital.appointment.cancelled` |
| `POST` | `/api/v1/opd/check-in` | `opd:queue:manage` | Checks in patient and assigns live OPD queue token |
| `GET` | `/api/v1/opd/queue` | Authenticated | Returns live OPD queue tokens |
| `POST` | `/api/v1/internal/verify-clinical-context` | `@InternalS2S()` | Synchronous S2S verification of Patient & Doctor IDs |

### 2.3 Clinical, EMR, Prescriptions, Nursing, Compounder, IPD, Beds, ER, OT & ICU (`clinical-emr-service` / `:4003`)
| Method | Path | Required Permission | Description |
|---|---|---|---|
| `GET/POST` | `/api/v1/encounters` | `encounter:write` | Lists or creates OPD/IPD/ER/ICU clinical encounters |
| `POST` | `/api/v1/emr/notes` | `clinical:note:write` | Creates a draft SOAP clinical note |
| `POST` | `/api/v1/emr/notes/:id/sign` | `clinical:note:sign` | Cryptographically signs note (`SHA-256`) and locks as immutable |
| `POST` | `/api/v1/emr/notes/:id/addendum` | `clinical:note:write` | Appends a medico-legal addendum to a signed clinical note |
| `POST` | `/api/v1/emr/vitals` | `clinical:vitals:write` | Records patient vital signs (BP, HR, SpO2, Temp, Weight) |
| `POST` | `/api/v1/prescriptions` | `prescription:sign` | Creates signed e-prescription, queues Compounder tasks & emits event |
| `GET` | `/api/v1/beds` | Authenticated | Real-time bed census filterable by ward and status |
| `POST` | `/api/v1/ipd/admissions` | `ipd:admission:write` | Admits inpatient, allocates bed (`OCCUPIED`), creates Nursing task |
| `POST` | `/api/v1/ipd/admissions/:id/discharge` | `ipd:discharge:sign` | Signs discharge summary, transitions bed to `CLEANING`, emits event |
| `POST` | `/api/v1/nursing/mar` | `nursing:mar:write` | Logs Medication Administration Record (MAR) |
| `PATCH` | `/api/v1/compounder/tasks/:id/complete` | `compounder:task:manage` | Marks compounder injection/dressing procedure completed |
| `POST` | `/api/v1/emergency/cases` | Authenticated | Registers Emergency Department triage case (`RED`/`YELLOW`/`GREEN`) |
| `POST` | `/api/v1/ot/schedules` | `ot:schedule:write` | Schedules Operation Theatre surgical procedure |
| `POST` | `/api/v1/icu/flowsheets` | `icu:flowsheet:write` | Records ICU ventilator & critical care parameters |

### 2.4 Diagnostics (Lab, Radiology, PACS, Blood Bank) & Pharmacy/Inventory (`diagnostics-pharmacy-service` / `:4004`)
| Method | Path | Required Permission | Description |
|---|---|---|---|
| `GET/POST` | `/api/v1/lab/orders` | `lab:order:write` | Lists or creates laboratory diagnostic orders |
| `PATCH` | `/api/v1/lab/orders/:id/collect-sample` | `lab:specimen:collect` | Generates specimen barcode (`SPEC-...`) and marks collected |
| `POST` | `/api/v1/lab/orders/:id/results` | `lab:result:write` | Enters & verifies lab results and emits `hospital.lab.result.ready` |
| `GET/POST` | `/api/v1/pharmacy/orders` | Authenticated | Lists or creates pharmacy dispense worklist orders |
| `POST` | `/api/v1/pharmacy/orders/:id/dispense` | `pharmacy:order:dispense` | Dispenses medication using **FEFO** batch deduction & reorder check |
| `GET` | `/api/v1/inventory/batches` | Authenticated | Lists FEFO medication batches sorted by expiry date |
| `GET/POST` | `/api/v1/radiology/orders` | `radiology:order:write` | Creates imaging order + PACS DICOM Study UID & WADO-RS link |
| `GET` | `/api/v1/blood-bank/units` | Authenticated | Lists blood bank component inventory by ABO/Rh group |

### 2.5 Revenue Cycle, Insurance, Operations, Facility, Notifications & Analytics (`operations-billing-service` / `:4005`)
| Method | Path | Required Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/billing/invoices/charge` | `billing:invoice:write` | Appends folio charge line item and recalculates tax/balance |
| `POST` | `/api/v1/billing/invoices/:id/finalize` | `billing:invoice:finalize` | Finalizes invoice and emits `hospital.billing.invoice.finalized` |
| `POST` | `/api/v1/payments` | `payment:collect` | Processes idempotent payment (`Idempotency-Key` header required) |
| `POST` | `/api/v1/insurance/claims` | `insurance:claim:manage` | Submits TPA cashless pre-auth / claim |
| `GET/PATCH` | `/api/v1/facility/housekeeping` | Authenticated | Lists or completes terminal bed-cleaning turnaround tasks |
| `GET` | `/api/v1/analytics/kpis` | `analytics:read` | Executive financial & operational KPI summary |
| `GET` | `/api/v1/dashboard/overview` | Authenticated (BFF) | Aggregated multi-service state for all 13 frontend role portals |

