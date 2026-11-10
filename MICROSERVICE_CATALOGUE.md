# BLOCK 01 — Complete Microservice Catalogue (`MICROSERVICE_CATALOGUE.md`)

This document catalogues all **38 required services**, detailing their responsibilities, database schema ownership, Prisma models, REST/gRPC APIs, Kafka events published and consumed, dependencies, authentication/authorization rules, deployment configurations, health checks, and observability metrics.

---

## Global Standards Applied to All 38 Services

- **Authentication:** Bearer JWT (`RS256`/`HS256` access token) validated at API Gateway and verified via Guard in each service + `X-Internal-Service-Token` for S2S calls.
- **Health Checks:** `GET /health/live` (process liveness) and `GET /health/ready` (verifies PostgreSQL schema connection, Redis ping, and Kafka producer/consumer readiness).
- **Logging & Metrics:** Structured JSON logs (`pino`/`winston`) with `correlationId`, `service`, `hospitalId`, `actorId` (zero PHI). Prometheus metrics at `GET /metrics` (`http_request_duration_seconds`, `hos_outbox_pending_total`, `hos_kafka_events_processed_total`).
- **Outbox & Idempotency:** Every schema includes `OutboxEvent` and `ProcessedEvent` tables.

---

## CLUSTER 1: EDGE & REAL-TIME GATEWAY (`api-gateway` — Port `3000`)

### 1. API Gateway / BFF Service
- **Responsibility:** Unified edge entry point for all 13 frontend role portals, JWT verification, rate limiting, request routing, response aggregation (BFF), and WebSocket/SSE real-time event broadcasting.
- **Database Ownership:** Stateless (uses Redis db `0` for rate-limiting and WebSocket room state).
- **Prisma Schema:** None (stateless gateway).
- **APIs:**
  - `ALL /api/v1/*` (proxied/aggregated to domain services)
  - `GET /api/v1/dashboard/summary` (role-tailored BFF aggregation)
  - `WS /ws/hospital-events` (real-time OPD queue, bed status, lab result alerts)
- **Events Published:** None directly.
- **Events Consumed:** `hospital.appointment.*`, `hospital.bed.*`, `hospital.lab.result.ready`, `hospital.prescription.created`, `hospital.payment.completed` (for WebSocket push).
- **Dependencies:** Redis, Kafka, downstream services (`3001`–`3005`).
- **Authn/Authz:** Enforces JWT authentication and rate limits (`100 req/min` auth, `1000 req/min` API).

---

## CLUSTER 2: IDENTITY, ACCESS & AUDIT (`identity-service` — Port `3001`, gRPC `50051`, Schema: `identity`)

### 2. Identity and Authentication Service
- **Responsibility:** User registration, credential management, Argon2/bcrypt password hashing, login/logout, refresh token rotation & revocation, MFA (TOTP) setup/verification, password reset tokens, and S2S token issuance.
- **Database Ownership:** `identity` schema (`User`, `RefreshToken`, `MfaSecret`, `PasswordResetToken`, `LoginSession`).
- **APIs:**
  - `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/mfa/setup`, `POST /api/v1/auth/mfa/verify`
  - `POST /api/v1/auth/password/forgot`, `POST /api/v1/auth/password/reset`
  - `gRPC IdentityService.ValidateToken`
- **Events Published:** `hospital.identity.user.created`, `hospital.identity.user.locked`, `hospital.identity.login.succeeded`, `hospital.identity.login.failed`.
- **Events Consumed:** `hospital.employee.created` (auto-provisions staff account).
- **Authn/Authz:** Public for `/login`, `/refresh`, `/password/forgot`; Authenticated for `/logout`, `/mfa/*`.

### 3. Authorization Service
- **Responsibility:** Role-Based Access Control (RBAC) for all 15 hospital roles, fine-grained permission matrix (`resource:action:scope`), department/ward resource-level ABAC evaluation, and role assignment auditing.
- **Database Ownership:** `identity` schema (`Role`, `Permission`, `RolePermission`, `UserRole`, `ResourcePolicy`).
- **APIs:**
  - `GET /api/v1/rbac/roles`, `POST /api/v1/rbac/roles`, `POST /api/v1/rbac/assign`
  - `POST /api/v1/rbac/evaluate`
  - `gRPC AuthorizationService.CheckPermission`
- **Events Published:** `hospital.authz.role.assigned`, `hospital.authz.policy.updated`.
- **Events Consumed:** None.
- **Authn/Authz:** `SUPER_ADMIN`, `HOSPITAL_ADMIN`.

### 36. Audit Service
- **Responsibility:** Tamper-evident, append-only compliance audit trail recording all security events, clinical record views/signatures, prescription modifications, and financial adjustments with hash chaining.
- **Database Ownership:** `identity` schema (`AuditLog`, `AccessAuditTrail`).
- **APIs:**
  - `GET /api/v1/audit/logs` (paginated, filterable by actor, entity, date range, correlationId)
  - `GET /api/v1/audit/verify-integrity`
- **Events Published:** `hospital.security.anomaly.detected`.
- **Events Consumed:** Consumes `hospital.*` wildcard audit topics from all services.
- **Authn/Authz:** `SUPER_ADMIN`, `AUDITOR`, `HOSPITAL_ADMIN` (read-only; no DELETE/UPDATE API exists).

---

## CLUSTER 3: HOSPITAL CORE, WORKFORCE & OUTPATIENT (`hospital-core-service` — Port `3002`, gRPC `50052`, Schema: `hospital_core`)

### 4. Hospital Configuration Service
- **Responsibility:** Manages hospital branches, buildings, floors, departments, specialties, clinical units, tariff master lists, and operational hours.
- **Database Ownership:** `hospital_core` schema (`Hospital`, `Building`, `Floor`, `Department`, `Specialty`, `SystemSetting`).
- **APIs:** `GET/POST/PATCH /api/v1/hospitals`, `GET/POST/PATCH /api/v1/departments`, `GET/POST /api/v1/buildings`, `GET/POST /api/v1/floors`.
- **Events Published:** `hospital.config.department.created`, `hospital.config.updated`.
- **Events Consumed:** None.
- **Authn/Authz:** Read: All staff; Write: `SUPER_ADMIN`, `HOSPITAL_ADMIN`.

### 5. Employee / Workforce Service
- **Responsibility:** Staff directory for nurses, compounders, technicians, pharmacists, receptionists, and support staff; shift rosters and department assignments.
- **Database Ownership:** `hospital_core` schema (`Employee`, `ShiftRoster`, `StaffAssignment`).
- **APIs:** `GET/POST/PATCH /api/v1/employees`, `GET/POST /api/v1/rosters`.
- **Events Published:** `hospital.employee.created`, `hospital.employee.shift.updated`.
- **Events Consumed:** None.
- **Authn/Authz:** `HR`, `HOSPITAL_ADMIN`, `DEPARTMENT_ADMIN`.

### 6. Doctor Management Service
- **Responsibility:** Doctor onboarding, medical license registration numbers, specialty mappings, consultation fees, and weekly OPD slot templates.
- **Database Ownership:** `hospital_core` schema (`DoctorProfile`, `DoctorScheduleTemplate`, `DoctorLeave`).
- **APIs:** `GET/POST/PATCH /api/v1/doctors`, `GET/POST /api/v1/doctors/:id/schedule`.
- **Events Published:** `hospital.doctor.onboarded`, `hospital.doctor.schedule.updated`.
- **Events Consumed:** `hospital.employee.created`.
- **Authn/Authz:** Read: All authenticated; Write: `HOSPITAL_ADMIN`, `DEPARTMENT_ADMIN`, `HR`.

### 7. Patient Management Service
- **Responsibility:** Master Patient Index (MPI), unique UHID/MRN generation (`HOS-YYYY-NNNNNN`), demographics, emergency contacts, allergy/blood-group flags, and duplicate detection.
- **Database Ownership:** `hospital_core` schema (`Patient`, `PatientIdentifier`, `PatientEmergencyContact`, `PatientConsent`).
- **APIs:** `GET/POST/PATCH /api/v1/patients`, `GET /api/v1/patients/search`, `gRPC PatientService.GetPatientById`.
- **Events Published:** `hospital.patient.registered`, `hospital.patient.updated`.
- **Events Consumed:** None.
- **Authn/Authz:** `RECEPTIONIST`, `DOCTOR`, `NURSE`, `BILLING_STAFF`, `HOSPITAL_ADMIN`.

### 8. Appointment Service
- **Responsibility:** Slot availability calculation, appointment booking, rescheduling, cancellation, walk-in registration, and double-booking prevention via unique slot constraints.
- **Database Ownership:** `hospital_core` schema (`Appointment`, `AppointmentSlot`).
- **APIs:** `GET/POST /api/v1/appointments`, `PATCH /api/v1/appointments/:id/status`, `POST /api/v1/appointments/:id/cancel`.
- **Events Published:** `hospital.appointment.created`, `hospital.appointment.cancelled`, `hospital.appointment.checked_in`.
- **Events Consumed:** `hospital.doctor.schedule.updated`.
- **Authn/Authz:** `RECEPTIONIST`, `DOCTOR`, `NURSE`, `PATIENT`.

### 9. OPD Service
- **Responsibility:** Outpatient check-in, live token generation, doctor room queue management, vital pre-screening handoff, and consultation completion tracking.
- **Database Ownership:** `hospital_core` schema (`OpdQueueToken`, `OpdSession`).
- **APIs:** `GET /api/v1/opd/queue`, `POST /api/v1/opd/check-in`, `PATCH /api/v1/opd/queue/:id/call-next`, `PATCH /api/v1/opd/queue/:id/complete`.
- **Events Published:** `hospital.opd.token.updated`, `hospital.opd.consultation.started`.
- **Events Consumed:** `hospital.appointment.checked_in`, `hospital.encounter.created`.
- **Authn/Authz:** `RECEPTIONIST`, `NURSE`, `COMPOUNDER`, `DOCTOR`.

### 30. HR and Payroll Service
- **Responsibility:** Employee attendance logs, leave approvals, salary structure, monthly payroll runs, and statutory deduction records.
- **Database Ownership:** `hospital_core` schema (`AttendanceRecord`, `LeaveRequest`, `PayrollRun`, `Payslip`).
- **APIs:** `GET/POST /api/v1/hr/attendance`, `GET/POST /api/v1/hr/leaves`, `POST /api/v1/hr/payroll/run`.
- **Events Published:** `hospital.hr.payroll.completed`, `hospital.hr.leave.approved`.
- **Events Consumed:** `hospital.employee.created`.
- **Authn/Authz:** `HR`, `ACCOUNTANT`, `HOSPITAL_ADMIN`.

---

## CLUSTER 4: CLINICAL, EMR & INPATIENT CARE (`clinical-emr-service` — Port `3003`, gRPC `50053`, Schema: `clinical`)

### 10. Encounter Service
- **Responsibility:** Lifecycle management of patient visits across OPD, IPD, Emergency, and Telemedicine (`PLANNED -> IN_PROGRESS -> COMPLETED -> SIGNED`).
- **Database Ownership:** `clinical` schema (`Encounter`, `EncounterParticipant`).
- **APIs:** `GET/POST /api/v1/encounters`, `PATCH /api/v1/encounters/:id/close`.
- **Events Published:** `hospital.encounter.created`, `hospital.encounter.closed`.
- **Events Consumed:** `hospital.appointment.checked_in`.
- **Authn/Authz:** `DOCTOR`, `NURSE`, `RECEPTIONIST`.

### 11. Clinical / EMR Service
- **Responsibility:** Structured SOAP notes, chief complaints, ICD-10 diagnosis coding, allergies, vitals history, immutable clinical signature enforcement, and addendum records.
- **Database Ownership:** `clinical` schema (`ClinicalNote`, `ClinicalNoteAddendum`, `VitalSignRecord`, `DiagnosisRecord`, `PatientAllergy`).
- **APIs:** `GET/POST /api/v1/emr/notes`, `POST /api/v1/emr/notes/:id/sign`, `POST /api/v1/emr/notes/:id/addendum`, `GET/POST /api/v1/emr/vitals`.
- **Events Published:** `hospital.clinical.note.signed`, `hospital.clinical.vitals.recorded`.
- **Events Consumed:** `hospital.encounter.created`, `hospital.lab.result.ready`.
- **Authn/Authz:** Write/Sign notes: `DOCTOR`; Record vitals: `DOCTOR`, `NURSE`, `COMPOUNDER`.

### 12. Prescription Service
- **Responsibility:** Structured e-prescriptions (medication, strength, route, frequency, duration, quantity, instructions), digital signature by doctor, and transmission to Pharmacy & Compounder queues.
- **Database Ownership:** `clinical` schema (`Prescription`, `PrescriptionItem`).
- **APIs:** `GET/POST /api/v1/prescriptions`, `POST /api/v1/prescriptions/:id/sign`.
- **Events Published:** `hospital.prescription.created`.
- **Events Consumed:** `hospital.pharmacy.dispensed`.
- **Authn/Authz:** Create/Sign: `DOCTOR`; Read: `DOCTOR`, `NURSE`, `COMPOUNDER`, `PHARMACIST`.

### 13. Nursing Service
- **Responsibility:** Ward nursing assessments, Medication Administration Records (MAR), intake/output charting, shift handover notes, and nursing care plans.
- **Database Ownership:** `clinical` schema (`NursingTask`, `MedicationAdministrationRecord`, `ShiftHandover`).
- **APIs:** `GET/POST /api/v1/nursing/tasks`, `POST /api/v1/nursing/mar`, `GET/POST /api/v1/nursing/handovers`.
- **Events Published:** `hospital.nursing.mar.recorded`, `hospital.nursing.task.completed`.
- **Events Consumed:** `hospital.prescription.created`, `hospital.bed.allocated`.
- **Authn/Authz:** `NURSE`, `DOCTOR`.

### 14. Compounder Service
- **Responsibility:** Outpatient dressing, minor procedure assistance, injection administration queues, vitals pre-check, and local dispensary stock verification.
- **Database Ownership:** `clinical` schema (`CompounderTask`, `MinorProcedureLog`).
- **APIs:** `GET/POST /api/v1/compounder/tasks`, `PATCH /api/v1/compounder/tasks/:id/complete`.
- **Events Published:** `hospital.compounder.task.completed`.
- **Events Consumed:** `hospital.prescription.created`, `hospital.opd.token.updated`.
- **Authn/Authz:** `COMPOUNDER`, `NURSE`, `DOCTOR`.

### 15. IPD Service
- **Responsibility:** Inpatient admission orders, attending doctor rounds, inter-ward transfer requests, discharge summaries, and final clinical clearance for discharge.
- **Database Ownership:** `clinical` schema (`Admission`, `InpatientRoundNote`, `DischargeSummary`).
- **APIs:** `GET/POST /api/v1/ipd/admissions`, `POST /api/v1/ipd/admissions/:id/rounds`, `POST /api/v1/ipd/admissions/:id/discharge`.
- **Events Published:** `hospital.ipd.admitted`, `hospital.patient.discharged`.
- **Events Consumed:** `hospital.bed.allocated`, `hospital.payment.completed`.
- **Authn/Authz:** `DOCTOR`, `NURSE`, `HOSPITAL_ADMIN`, `RECEPTIONIST`.

### 16. Bed Management Service
- **Responsibility:** Real-time census of 500+ beds across wards/rooms (General, Semi-Private, Private, ICU, NICU, ER, Isolation), bed reservation, allocation, transfer, and housekeeping turnaround status (`AVAILABLE`, `OCCUPIED`, `RESERVED`, `CLEANING`, `MAINTENANCE`).
- **Database Ownership:** `clinical` schema (`Ward`, `Room`, `Bed`, `BedAllocationHistory`).
- **APIs:** `GET /api/v1/beds`, `POST /api/v1/beds/:id/allocate`, `POST /api/v1/beds/:id/release`, `PATCH /api/v1/beds/:id/status`.
- **Events Published:** `hospital.bed.allocated`, `hospital.bed.released`, `hospital.bed.cleaning.requested`.
- **Events Consumed:** `hospital.patient.discharged`, `hospital.facility.cleaning.completed`.
- **Authn/Authz:** `NURSE`, `RECEPTIONIST`, `HOSPITAL_ADMIN`, `DOCTOR`.

### 17. Emergency Service
- **Responsibility:** Emergency department (ER) rapid registration (including unknown/trauma patients), triage categorization (`RED`, `YELLOW`, `GREEN`, `BLACK`), trauma bay assignment, and stabilization tracking.
- **Database Ownership:** `clinical` schema (`EmergencyCase`, `TriageAssessment`).
- **APIs:** `GET/POST /api/v1/emergency/cases`, `PATCH /api/v1/emergency/cases/:id/triage`.
- **Events Published:** `hospital.emergency.case.registered`, `hospital.emergency.critical.alert`.
- **Events Consumed:** None.
- **Authn/Authz:** `DOCTOR`, `NURSE`, `RECEPTIONIST`.

### 18. OT (Operation Theatre) Service
- **Responsibility:** OT room scheduling, surgical team assignment (Surgeon, Anesthetist, Scrub Nurse), pre-op checklist verification, anesthesia log, and post-op recovery notes.
- **Database Ownership:** `clinical` schema (`OperationTheatre`, `SurgerySchedule`, `SurgicalChecklist`).
- **APIs:** `GET/POST /api/v1/ot/schedules`, `PATCH /api/v1/ot/schedules/:id/status`.
- **Events Published:** `hospital.ot.surgery.scheduled`, `hospital.ot.surgery.completed`.
- **Events Consumed:** `hospital.ipd.admitted`.
- **Authn/Authz:** `DOCTOR`, `NURSE`, `HOSPITAL_ADMIN`.

### 19. ICU Service
- **Responsibility:** Intensive Care Unit hourly flow-sheets, ventilator/monitor parameter tracking, invasive line logs, and critical care scoring records.
- **Database Ownership:** `clinical` schema (`IcuAdmission`, `IcuFlowsheetRecord`).
- **APIs:** `GET/POST /api/v1/icu/flowsheets`.
- **Events Published:** `hospital.icu.status.updated`.
- **Events Consumed:** `hospital.bed.allocated`.
- **Authn/Authz:** `DOCTOR`, `NURSE`.

---

## CLUSTER 5: DIAGNOSTICS, PHARMACY & SUPPLY CHAIN (`diagnostics-pharmacy-service` — Port `3004`, gRPC `50054`, Schema: `diagnostics_pharmacy`)

### 20. Pharmacy Service
- **Responsibility:** Outpatient & inpatient medication dispensing, batch & expiry verification, controlled substance logging, and substitute/return handling.
- **Database Ownership:** `diagnostics_pharmacy` schema (`MedicationCatalog`, `PharmacyDispenseOrder`, `PharmacyDispenseItem`).
- **APIs:** `GET /api/v1/pharmacy/orders`, `POST /api/v1/pharmacy/orders/:id/dispense`, `GET/POST /api/v1/pharmacy/catalog`.
- **Events Published:** `hospital.pharmacy.dispensed`, `hospital.pharmacy.stock.low`.
- **Events Consumed:** `hospital.prescription.created`.
- **Authn/Authz:** `PHARMACIST`, `COMPOUNDER`, `HOSPITAL_ADMIN`.

### 21. Inventory Service
- **Responsibility:** Multi-store stock ledger (Central Store, Pharmacy Store, OT Store, Ward Sub-stores), FEFO (First-Expiry-First-Out) batch tracking, stock transfers, and reorder threshold monitoring.
- **Database Ownership:** `diagnostics_pharmacy` schema (`InventoryItem`, `InventoryBatch`, `StockMovement`, `StoreLocation`).
- **APIs:** `GET/POST /api/v1/inventory/items`, `GET/POST /api/v1/inventory/batches`, `POST /api/v1/inventory/movements`.
- **Events Published:** `hospital.inventory.stock.updated`, `hospital.inventory.reorder.triggered`.
- **Events Consumed:** `hospital.pharmacy.dispensed`, `hospital.procurement.grn.completed`.
- **Authn/Authz:** `INVENTORY_MANAGER`, `PHARMACIST`, `HOSPITAL_ADMIN`.

### 22. Procurement Service
- **Responsibility:** Vendor master, purchase requisitions, Purchase Orders (PO), Goods Receipt Notes (GRN), and vendor invoice matching.
- **Database Ownership:** `diagnostics_pharmacy` schema (`Vendor`, `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceiptNote`).
- **APIs:** `GET/POST /api/v1/procurement/vendors`, `GET/POST /api/v1/procurement/purchase-orders`, `POST /api/v1/procurement/grn`.
- **Events Published:** `hospital.procurement.po.created`, `hospital.procurement.grn.completed`.
- **Events Consumed:** `hospital.inventory.reorder.triggered`.
- **Authn/Authz:** `INVENTORY_MANAGER`, `ACCOUNTANT`, `HOSPITAL_ADMIN`.

### 23. Laboratory Service
- **Responsibility:** Lab test catalog, sample collection barcoding (`ORDERED -> SAMPLE_COLLECTED -> IN_ANALYZER -> VERIFIED -> RELEASED`), technician result entry, pathologist verification, and critical value flagging.
- **Database Ownership:** `diagnostics_pharmacy` schema (`LabTestCatalog`, `LabOrder`, `LabSpecimen`, `LabResult`).
- **APIs:** `GET/POST /api/v1/lab/orders`, `PATCH /api/v1/lab/orders/:id/collect-sample`, `POST /api/v1/lab/orders/:id/results`.
- **Events Published:** `hospital.lab.order.created`, `hospital.lab.result.ready`.
- **Events Consumed:** `hospital.encounter.created`.
- **Authn/Authz:** Order: `DOCTOR`; Process/Result: `LAB_TECHNICIAN`; Read: `DOCTOR`, `NURSE`, `PATIENT`.

### 24. Radiology Service
- **Responsibility:** Modality worklist (X-Ray, CT, MRI, Ultrasound), imaging order tracking, radiologist diagnostic report authoring, and addendum management.
- **Database Ownership:** `diagnostics_pharmacy` schema (`RadiologyModality`, `RadiologyOrder`, `RadiologyReport`).
- **APIs:** `GET/POST /api/v1/radiology/orders`, `POST /api/v1/radiology/orders/:id/report`.
- **Events Published:** `hospital.radiology.order.created`, `hospital.radiology.report.ready`.
- **Events Consumed:** `hospital.encounter.created`.
- **Authn/Authz:** Order: `DOCTOR`; Perform/Report: `RADIOLOGY_TECHNICIAN`, `DOCTOR`.

### 25. PACS Integration Service
- **Responsibility:** Manages DICOM Study/Series/Instance UID metadata references, Orthanc/DICOMweb WADO-RS viewer link generation, and modality worklist synchronization (never stores raw multi-GB DICOM blobs directly in PostgreSQL).
- **Database Ownership:** `diagnostics_pharmacy` schema (`DicomStudyReference`, `DicomSeriesReference`).
- **APIs:** `GET /api/v1/pacs/studies/:studyUid`, `POST /api/v1/pacs/webhook/study-received`.
- **Events Published:** `hospital.pacs.study.available`.
- **Events Consumed:** `hospital.radiology.order.created`.
- **Authn/Authz:** `DOCTOR`, `RADIOLOGY_TECHNICIAN`.

### 29. Blood Bank Service
- **Responsibility:** Blood donor registry, blood bag component inventory (`PRBC`, `FFP`, `Platelets`, `Whole Blood`) by ABO/Rh group, cross-matching requests, and transfusion reaction logging.
- **Database Ownership:** `diagnostics_pharmacy` schema (`BloodDonor`, `BloodUnit`, `CrossMatchRequest`).
- **APIs:** `GET/POST /api/v1/blood-bank/units`, `POST /api/v1/blood-bank/cross-match`.
- **Events Published:** `hospital.bloodbank.unit.issued`, `hospital.bloodbank.stock.critical`.
- **Events Consumed:** `hospital.ot.surgery.scheduled`, `hospital.emergency.case.registered`.
- **Authn/Authz:** `LAB_TECHNICIAN`, `DOCTOR`, `NURSE`.

---

## CLUSTER 6: REVENUE CYCLE, OPERATIONS, DOCUMENTS & INTEGRATIONS (`operations-billing-service` — Port `3005`, gRPC `50055`, Schema: `operations_billing`)

### 26. Billing Service
- **Responsibility:** Automated folio charge accumulation (OPD consultation, bed day tariffs, lab tests, radiology, pharmacy dispenses, OT procedures), provisional & final invoice generation, credit/debit adjustments (immutable ledger lines).
- **Database Ownership:** `operations_billing` schema (`Invoice`, `InvoiceLineItem`, `ChargeLedger`, `TariffItem`).
- **APIs:** `GET/POST /api/v1/billing/invoices`, `POST /api/v1/billing/invoices/:id/finalize`.
- **Events Published:** `hospital.billing.invoice.generated`, `hospital.billing.invoice.finalized`.
- **Events Consumed:** `hospital.appointment.created`, `hospital.lab.order.created`, `hospital.radiology.order.created`, `hospital.pharmacy.dispensed`, `hospital.bed.allocated`.
- **Authn/Authz:** `BILLING_STAFF`, `ACCOUNTANT`, `HOSPITAL_ADMIN`, `RECEPTIONIST`.

### 27. Payment Service
- **Responsibility:** Idempotent payment processing (Cash, Card, UPI, Bank Transfer, Insurance Settlement), receipt generation, refund workflows, and daily reconciliation.
- **Database Ownership:** `operations_billing` schema (`PaymentTransaction`, `PaymentReceipt`, `RefundRecord`).
- **APIs:** `POST /api/v1/payments` (requires `Idempotency-Key` header), `GET /api/v1/payments/invoice/:invoiceId`.
- **Events Published:** `hospital.payment.completed`, `hospital.payment.refunded`.
- **Events Consumed:** `hospital.billing.invoice.finalized`, `hospital.insurance.claim.settled`.
- **Authn/Authz:** `BILLING_STAFF`, `ACCOUNTANT`, `RECEPTIONIST`.

### 28. Insurance / TPA Service
- **Responsibility:** Patient insurance policy verification, pre-authorization requests, cashless limit tracking, claim submission packages, and TPA settlement reconciliation.
- **Database Ownership:** `operations_billing` schema (`InsuranceProvider`, `PatientInsurancePolicy`, `PreAuthRequest`, `InsuranceClaim`).
- **APIs:** `GET/POST /api/v1/insurance/pre-auth`, `GET/POST /api/v1/insurance/claims`.
- **Events Published:** `hospital.insurance.preauth.approved`, `hospital.insurance.claim.settled`.
- **Events Consumed:** `hospital.ipd.admitted`, `hospital.billing.invoice.finalized`.
- **Authn/Authz:** `BILLING_STAFF`, `ACCOUNTANT`, `HOSPITAL_ADMIN`.

### 31. Ambulance Service
- **Responsibility:** Ambulance fleet registry, driver/paramedic assignment, emergency dispatch logging, GPS status tracking, and pre-hospital handover alerts.
- **Database Ownership:** `operations_billing` schema (`Ambulance`, `AmbulanceDispatch`).
- **APIs:** `GET/POST /api/v1/ambulances`, `POST /api/v1/ambulances/dispatch`.
- **Events Published:** `hospital.ambulance.dispatched`, `hospital.ambulance.arrived`.
- **Events Consumed:** None.
- **Authn/Authz:** `RECEPTIONIST`, `NURSE`, `HOSPITAL_ADMIN`.

### 32. Asset Management Service
- **Responsibility:** Biomedical equipment registry (ventilators, defibrillators, MRI/CT scanners, infusion pumps), preventive maintenance schedules, calibration logs, and breakdown tickets.
- **Database Ownership:** `operations_billing` schema (`MedicalAsset`, `AssetMaintenanceLog`).
- **APIs:** `GET/POST /api/v1/assets`, `POST /api/v1/assets/:id/maintenance`.
- **Events Published:** `hospital.asset.maintenance.due`, `hospital.asset.breakdown.reported`.
- **Events Consumed:** None.
- **Authn/Authz:** `INVENTORY_MANAGER`, `HOSPITAL_ADMIN`.

### 33. Facility Management Service
- **Responsibility:** Housekeeping bed-cleaning turnarounds, biomedical waste management logs, HVAC/oxygen plant pressure alerts, and laundry tracking.
- **Database Ownership:** `operations_billing` schema (`HousekeepingTask`, `BioWasteLog`, `FacilityAlert`).
- **APIs:** `GET/POST /api/v1/facility/housekeeping`, `PATCH /api/v1/facility/housekeeping/:id/complete`.
- **Events Published:** `hospital.facility.cleaning.completed`.
- **Events Consumed:** `hospital.bed.cleaning.requested`, `hospital.patient.discharged`.
- **Authn/Authz:** `HOSPITAL_ADMIN`, `NURSE`.

### 34. Notification Service
- **Responsibility:** Multi-channel notification dispatcher (In-App, Email, SMS) powered by BullMQ worker queues, delivery tracking, template management, and dead-letter retry handling.
- **Database Ownership:** `operations_billing` schema (`NotificationRecord`, `NotificationTemplate`).
- **APIs:** `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`, `POST /api/v1/notifications/send`.
- **Events Published:** `hospital.notification.delivered`, `hospital.notification.failed`.
- **Events Consumed:** `hospital.patient.registered`, `hospital.appointment.created`, `hospital.appointment.cancelled`, `hospital.lab.result.ready`, `hospital.payment.completed`, `hospital.patient.discharged`.
- **Authn/Authz:** Authenticated users (scoped to recipient).

### 35. Document Service (AWS S3)
- **Responsibility:** Secure medical document metadata management, S3 presigned upload/download URL generation, MIME type & file size validation, KMS encryption enforcement, and access audit logging.
- **Database Ownership:** `operations_billing` schema (`DocumentRecord`, `DocumentAccessLog`).
- **APIs:** `POST /api/v1/documents/presign-upload`, `POST /api/v1/documents/:id/confirm`, `GET /api/v1/documents/:id/presign-download`.
- **Events Published:** `hospital.document.uploaded`.
- **Events Consumed:** `hospital.lab.result.ready`, `hospital.patient.discharged`.
- **Authn/Authz:** Owner / Authorized clinical & billing roles.

### 37. Reporting and Analytics Service
- **Responsibility:** Read-optimized operational & executive KPIs (Bed occupancy rate, average OPD wait time, daily revenue collection, department census, lab turnaround time, drug expiry forecast) cached in Redis.
- **Database Ownership:** `operations_billing` schema (`DailyHospitalMetricSnapshot`, `GeneratedReport`).
- **APIs:** `GET /api/v1/analytics/kpis`, `POST /api/v1/analytics/reports/generate`.
- **Events Published:** `hospital.report.generated`.
- **Events Consumed:** Subscribes to domain events to increment real-time counters and daily metric snapshots.
- **Authn/Authz:** `SUPER_ADMIN`, `HOSPITAL_ADMIN`, `ACCOUNTANT`, `AUDITOR`.

### 38. Integration Service
- **Responsibility:** External healthcare interoperability boundary (HL7 v2 / FHIR R4 patient/observation/diagnostic-report adapters, external lab analyzer webhooks, payment gateway webhooks, and Jira webhook synchronization).
- **Database Ownership:** `operations_billing` schema (`ExternalIntegrationEndpoint`, `IntegrationMessageLog`).
- **APIs:** `POST /api/v1/integrations/fhir/Bundle`, `POST /api/v1/integrations/webhooks/:provider`.
- **Events Published:** `hospital.integration.inbound.received`.
- **Events Consumed:** `hospital.patient.registered`, `hospital.lab.result.ready`.
- **Authn/Authz:** `SUPER_ADMIN`, `HOSPITAL_ADMIN`, Webhook HMAC signature verification.

