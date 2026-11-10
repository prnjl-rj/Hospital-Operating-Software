import { describe, it, expect } from 'vitest';
import { PrismaClient as IdentityPrismaClient, HospitalRoleCode } from '../../node_modules/.prisma/identity-client';
import { PrismaClient as HospitalCorePrismaClient } from '../../node_modules/.prisma/hospital-core-client';
import { PrismaClient as ClinicalPrismaClient } from '../../node_modules/.prisma/clinical-client';
import { PrismaClient as DiagnosticsPrismaClient } from '../../node_modules/.prisma/diagnostics-pharmacy-client';
import { PrismaClient as OperationsPrismaClient } from '../../node_modules/.prisma/operations-billing-client';

describe('BLOCK 02 — Multi-Schema Prisma Client Isolation & Contract Verification', () => {
  it('generates and instantiates all 5 isolated microservice Prisma clients with Outbox & Idempotency models', () => {
    const identityDb = new IdentityPrismaClient();
    const coreDb = new HospitalCorePrismaClient();
    const clinicalDb = new ClinicalPrismaClient();
    const diagDb = new DiagnosticsPrismaClient();
    const opsDb = new OperationsPrismaClient();

    // 1. Identity Schema Ownership
    expect(identityDb.user).toBeDefined();
    expect(identityDb.role).toBeDefined();
    expect(identityDb.permission).toBeDefined();
    expect(identityDb.refreshToken).toBeDefined();
    expect(identityDb.auditLog).toBeDefined();
    expect(identityDb.outboxEvent).toBeDefined();
    expect(identityDb.processedEvent).toBeDefined();

    // Verify all 15 required hospital roles + Patient exist in enum
    expect(Object.keys(HospitalRoleCode)).toEqual(
      expect.arrayContaining([
        'SUPER_ADMIN',
        'HOSPITAL_ADMIN',
        'DEPARTMENT_ADMIN',
        'DOCTOR',
        'NURSE',
        'COMPOUNDER',
        'PHARMACIST',
        'LAB_TECHNICIAN',
        'RADIOLOGY_TECHNICIAN',
        'RECEPTIONIST',
        'BILLING_STAFF',
        'HR',
        'INVENTORY_MANAGER',
        'ACCOUNTANT',
        'AUDITOR',
        'PATIENT',
      ]),
    );

    // 2. Hospital Core Schema Ownership (and verify no cross-schema leakage)
    expect(coreDb.hospital).toBeDefined();
    expect(coreDb.department).toBeDefined();
    expect(coreDb.employee).toBeDefined();
    expect(coreDb.doctorProfile).toBeDefined();
    expect(coreDb.patient).toBeDefined();
    expect(coreDb.appointment).toBeDefined();
    expect(coreDb.opdQueueToken).toBeDefined();
    expect(coreDb.payrollRun).toBeDefined();
    expect(coreDb.outboxEvent).toBeDefined();
    expect(coreDb.processedEvent).toBeDefined();
    expect((coreDb as Record<string, unknown>).clinicalNote).toBeUndefined();

    // 3. Clinical & Inpatient Schema Ownership
    expect(clinicalDb.encounter).toBeDefined();
    expect(clinicalDb.clinicalNote).toBeDefined();
    expect(clinicalDb.clinicalNoteAddendum).toBeDefined();
    expect(clinicalDb.prescription).toBeDefined();
    expect(clinicalDb.ward).toBeDefined();
    expect(clinicalDb.bed).toBeDefined();
    expect(clinicalDb.admission).toBeDefined();
    expect(clinicalDb.nursingTask).toBeDefined();
    expect(clinicalDb.medicationAdministrationRecord).toBeDefined();
    expect(clinicalDb.compounderTask).toBeDefined();
    expect(clinicalDb.emergencyCase).toBeDefined();
    expect(clinicalDb.surgerySchedule).toBeDefined();
    expect(clinicalDb.icuFlowsheetRecord).toBeDefined();
    expect(clinicalDb.outboxEvent).toBeDefined();
    expect(clinicalDb.processedEvent).toBeDefined();
    expect((clinicalDb as Record<string, unknown>).invoice).toBeUndefined();

    // 4. Diagnostics & Pharmacy Schema Ownership
    expect(diagDb.medicationCatalog).toBeDefined();
    expect(diagDb.inventoryBatch).toBeDefined();
    expect(diagDb.pharmacyDispenseOrder).toBeDefined();
    expect(diagDb.labOrder).toBeDefined();
    expect(diagDb.labResult).toBeDefined();
    expect(diagDb.radiologyOrder).toBeDefined();
    expect(diagDb.dicomStudyReference).toBeDefined();
    expect(diagDb.bloodUnit).toBeDefined();
    expect(diagDb.outboxEvent).toBeDefined();
    expect(diagDb.processedEvent).toBeDefined();

    // 5. Operations & Billing Schema Ownership
    expect(opsDb.invoice).toBeDefined();
    expect(opsDb.paymentTransaction).toBeDefined();
    expect(opsDb.insuranceClaim).toBeDefined();
    expect(opsDb.ambulance).toBeDefined();
    expect(opsDb.medicalAsset).toBeDefined();
    expect(opsDb.housekeepingTask).toBeDefined();
    expect(opsDb.notificationRecord).toBeDefined();
    expect(opsDb.documentRecord).toBeDefined();
    expect(opsDb.dailyHospitalMetricSnapshot).toBeDefined();
    expect(opsDb.outboxEvent).toBeDefined();
    expect(opsDb.processedEvent).toBeDefined();
  });
});

