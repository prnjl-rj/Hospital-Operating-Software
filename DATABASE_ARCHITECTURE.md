# BLOCK 02 — Database Architecture (`DATABASE_ARCHITECTURE.md`)

## 1. Multi-Schema Ownership & Strict Isolation Matrix

In accordance with **Non-Negotiable Engineering Rules 15 & 16** (*"Do not allow one microservice to access another microservice's database directly"* and *"Every microservice must own its data and migrations"*), the PostgreSQL 16 database (`hos_db`) is partitioned into **5 isolated schemas**, each owned by a dedicated PostgreSQL role and managed by its own independent Prisma schema and generated client:

| Microservice Runtime | PostgreSQL Schema | Dedicated DB Role | Generated Prisma Client Path | Core Domain Entities Owned |
|---|---|---|---|---|
| `identity-service` | `identity` | `hos_identity_user` | `node_modules/.prisma/identity-client` | `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshToken`, `PasswordResetToken`, `LoginSession`, `AuditLog`, `OutboxEvent`, `ProcessedEvent` |
| `hospital-core-service` | `hospital_core` | `hos_core_user` | `node_modules/.prisma/hospital-core-client` | `Hospital`, `Building`, `Floor`, `Department`, `Employee`, `ShiftRoster`, `DoctorProfile`, `DoctorScheduleTemplate`, `Patient`, `PatientIdentifier`, `PatientEmergencyContact`, `Appointment`, `OpdQueueToken`, `AttendanceRecord`, `LeaveRequest`, `PayrollRun`, `Payslip`, `OutboxEvent`, `ProcessedEvent` |
| `clinical-emr-service` | `clinical` | `hos_clinical_user` | `node_modules/.prisma/clinical-client` | `Encounter`, `ClinicalNote`, `ClinicalNoteAddendum`, `VitalSignRecord`, `DiagnosisRecord`, `PatientAllergy`, `Prescription`, `PrescriptionItem`, `Ward`, `Bed`, `Admission`, `BedAllocationHistory`, `InpatientRoundNote`, `DischargeSummary`, `NursingTask`, `MedicationAdministrationRecord`, `CompounderTask`, `EmergencyCase`, `SurgerySchedule`, `IcuFlowsheetRecord`, `OutboxEvent`, `ProcessedEvent` |
| `diagnostics-pharmacy-service` | `diagnostics_pharmacy` | `hos_diag_user` | `node_modules/.prisma/diagnostics-pharmacy-client` | `MedicationCatalog`, `InventoryBatch`, `PharmacyDispenseOrder`, `PharmacyDispenseItem`, `Vendor`, `PurchaseOrder`, `LabTestCatalog`, `LabOrder`, `LabResult`, `RadiologyOrder`, `RadiologyReport`, `DicomStudyReference`, `BloodUnit`, `OutboxEvent`, `ProcessedEvent` |
| `operations-billing-service` | `operations_billing` | `hos_ops_user` | `node_modules/.prisma/operations-billing-client` | `Invoice`, `InvoiceLineItem`, `PaymentTransaction`, `InsuranceClaim`, `Ambulance`, `MedicalAsset`, `HousekeepingTask`, `NotificationRecord`, `DocumentRecord`, `DailyHospitalMetricSnapshot`, `OutboxEvent`, `ProcessedEvent` |

---

## 2. Entity-Relationship (ER) Diagrams by Schema

### 2.1 `identity` Schema
```mermaid
erDiagram
    User ||--o{ UserRole : "assigned"
    Role ||--o{ UserRole : "grants"
    Role ||--o{ RolePermission : "contains"
    Permission ||--o{ RolePermission : "mapped_to"
    User ||--o{ RefreshToken : "rotates"
    User ||--o{ LoginSession : "tracks"
    User ||--o{ AuditLog : "actor"
```

### 2.2 `hospital_core` Schema
```mermaid
erDiagram
    Hospital ||--o{ Building : "has"
    Building ||--o{ Floor : "contains"
    Hospital ||--o{ Department : "operates"
    Department ||--o{ Employee : "employs"
    Department ||--o{ DoctorProfile : "affiliates"
    DoctorProfile ||--o{ DoctorScheduleTemplate : "schedules"
    Hospital ||--o{ Patient : "registers"
    Patient ||--o{ PatientIdentifier : "identifies"
    Patient ||--o{ PatientEmergencyContact : "contacts"
    Patient ||--o{ Appointment : "books"
    DoctorProfile ||--o{ Appointment : "attends"
    Appointment ||--o| OpdQueueToken : "generates"
    Employee ||--o{ ShiftRoster : "rostered"
    Employee ||--o{ AttendanceRecord : "logs"
    PayrollRun ||--o{ Payslip : "disburses"
```

### 2.3 `clinical` Schema
```mermaid
erDiagram
    Encounter ||--o{ ClinicalNote : "documents"
    ClinicalNote ||--o{ ClinicalNoteAddendum : "amended_by"
    Encounter ||--o{ VitalSignRecord : "records"
    Encounter ||--o{ DiagnosisRecord : "codes"
    Encounter ||--o{ Prescription : "orders"
    Prescription ||--o{ PrescriptionItem : "line_items"
    Encounter ||--o| Admission : "admits"
    Ward ||--o{ Bed : "houses"
    Bed ||--o{ BedAllocationHistory : "tracks"
    Admission ||--o{ InpatientRoundNote : "rounds"
    Admission ||--o| DischargeSummary : "summarizes"
    Admission ||--o{ NursingTask : "assigns"
    Admission ||--o{ MedicationAdministrationRecord : "administers"
```

### 2.4 `diagnostics_pharmacy` Schema
```mermaid
erDiagram
    MedicationCatalog ||--o{ InventoryBatch : "stocked_in"
    PharmacyDispenseOrder ||--o{ PharmacyDispenseItem : "dispenses"
    Vendor ||--o{ PurchaseOrder : "supplies"
    LabOrder ||--o{ LabResult : "produces"
    RadiologyOrder ||--o| RadiologyReport : "reported_in"
    RadiologyOrder ||--o| DicomStudyReference : "links_pacs"
```

### 2.5 `operations_billing` Schema
```mermaid
erDiagram
    Invoice ||--o{ InvoiceLineItem : "accrues"
    Invoice ||--o{ PaymentTransaction : "settled_by"
    Invoice ||--o{ InsuranceClaim : "claimed_via"
```

---

## 3. Clinical & Financial Integrity Constraints

1. **Double-Booking Prevention:** `Appointment` enforces `@@unique([doctorId, scheduledStart])` and `OpdQueueToken` enforces `@@unique([doctorId, queueDate, tokenNumber])`.
2. **Idempotent Financial Payments:** `PaymentTransaction` enforces `@unique` on `idempotencyKey` and `receiptNumber`, and stores all monetary values as integer `BigInt` minor units (`paise`/`cents`) to eliminate IEEE-754 floating-point rounding bugs.
3. **Immutable Signed Clinical Records:** `ClinicalNote` includes `isImmutable`, `contentHash` (SHA-256), and `signedAt`. Database trigger `clinical.prevent_signed_clinical_note_mutation()` blocks any `UPDATE` or `DELETE` once `isImmutable = true`. Amendments must be inserted into `ClinicalNoteAddendum`.
4. **Tamper-Evident Audit Chain:** `identity.AuditLog` chains each entry via `previousHash` and `integrityHash` (SHA-256) and is protected by `identity.prevent_audit_log_mutation()`.

---

## 4. Soft-Delete & Data Retention Rules

- **Soft Delete (`deletedAt`):** Applied to `User` and `Patient` records so historical references remain intact. Clinical notes, prescriptions, audit logs, invoices, and payments **never** support deletion (neither hard nor soft); financial reversals use explicit `RefundRecord` / credit line items.
- **Data Retention Policy:**
  - `ClinicalNote`, `Prescription`, `DischargeSummary`, `LabResult`, `RadiologyReport`, `DocumentRecord`: Minimum **7 years** (or pediatric maturity + 7 years per medical record retention standards).
  - `AuditLog`: **10 years** (hot in PostgreSQL for 1 year, archived to AWS S3 Object Lock Glacier Deep Archive thereafter).
  - `OutboxEvent` (`PUBLISHED`) & `ProcessedEvent`: Retained for **30 days** for replay/debugging, then pruned via scheduled BullMQ maintenance job.

