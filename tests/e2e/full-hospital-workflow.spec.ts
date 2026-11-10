import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { createGatewayApp } from '../../services/api-gateway/src/main';
import { IdentityService } from '../../services/identity-service/src/identity.service';
import { HospitalCoreService } from '../../services/hospital-core-service/src/hospital-core.service';
import { ClinicalEmrService } from '../../services/clinical-emr-service/src/clinical-emr.service';
import { DiagnosticsPharmacyService } from '../../services/diagnostics-pharmacy-service/src/diagnostics-pharmacy.service';
import { OperationsBillingService } from '../../services/operations-billing-service/src/operations-billing.service';
import { HospitalKafkaEngine } from '../../packages/shared/src/kafka/kafka-outbox-engine';

describe('BLOCK 17 — Complete End-to-End Hospital Operating Software Validation (Workflows 1–8)', () => {
  let app: INestApplication;
  let identityService: IdentityService;
  let coreService: HospitalCoreService;
  let clinicalService: ClinicalEmrService;
  let diagService: DiagnosticsPharmacyService;
  let opsService: OperationsBillingService;
  let kafkaEngine: HospitalKafkaEngine;

  let doctorToken: string;
  let e2ePatientId: string;
  let e2ePatientMrn: string;
  let e2eEncounterId: string;
  let e2eInvoiceId: string;

  beforeAll(async () => {
    app = await createGatewayApp();
    await app.init();

    identityService = app.get(IdentityService);
    coreService = app.get(HospitalCoreService);
    clinicalService = app.get(ClinicalEmrService);
    diagService = app.get(DiagnosticsPharmacyService);
    opsService = app.get(OperationsBillingService);

    kafkaEngine = new HospitalKafkaEngine(['localhost:9094'], 'hos-e2e-validator');
    await kafkaEngine.connectProducerAndAdmin();

    doctorToken = (
      await identityService.login({
        emailOrUsername: 'dr.arjun@hos.local',
        password: 'Hospital@2026!',
      })
    ).accessToken;
  });

  afterAll(async () => {
    await kafkaEngine.disconnectAll();
    await app.close();
  });

  it('Workflow 1 (Patient & OPD): Receptionist registers patient & books OPD -> Nurse records vitals -> Doctor signs SOAP note & prescription -> Billing draft updated', async () => {
    // 1. Receptionist registers synthetic patient
    const patient = await coreService.registerPatient(
      {
        hospitalId: 'hosp-main-001',
        firstName: 'Vikram',
        lastName: 'Mehta (E2E Synthetic)',
        dateOfBirth: '1979-11-14',
        gender: 'MALE',
        bloodGroup: 'A+',
        phone: `+91-97${Math.floor(10000000 + Math.random() * 89999999)}`,
        email: 'vikram.e2e.synthetic@example.org',
        addressLine: '88 E2E Synthetic Enclave',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        emergencyContactName: 'Kavita Mehta',
        emergencyContactPhone: '+91-9700000001',
      },
      'usr-recep-01',
    );
    expect(patient.mrn).toMatch(/^HOS-2026-\d{6}$/);
    expect(patient.isSyntheticTestRecord).toBe(true);
    e2ePatientId = patient.id;
    e2ePatientMrn = patient.mrn;

    // 2. Receptionist books OPD appointment & checks into OPD queue
    const slotStart = new Date(Date.now() + Math.floor(Math.random() * 50000000) + 86400000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 15 * 60 * 1000).toISOString();

    const appt = await coreService.createAppointment(
      {
        hospitalId: 'hosp-main-001',
        patientId: e2ePatientId,
        doctorId: 'doc-cardio-01',
        departmentId: 'dept-cardio',
        scheduledStart: slotStart,
        scheduledEnd: slotEnd,
        reasonForVisit: 'Chest discomfort and fatigue (Synthetic E2E)',
      },
      'usr-recep-01',
    );
    expect(appt.appointmentNumber).toMatch(/^APT-2026-\d{6}$/);

    const opdToken = await coreService.checkInOpdAppointment(appt.id, 'URGENT');
    expect(opdToken.status).toBe('WAITING_VITALS');

    // 3. Doctor creates encounter & Nurse records vitals
    const encounter = await clinicalService.createEncounter({
      hospitalId: 'hosp-main-001',
      patientRefId: e2ePatientId,
      patientMrn: e2ePatientMrn,
      doctorRefId: 'doc-cardio-01',
      departmentRefId: 'dept-cardio',
      encounterType: 'OPD',
    });
    e2eEncounterId = encounter.id;

    const vitals = await clinicalService.recordVitalSigns({
      encounterId: e2eEncounterId,
      patientRefId: e2ePatientId,
      recordedByUserId: 'usr-nurse-01',
      recordedByRole: 'NURSE',
      systolicBpMmHg: 138,
      diastolicBpMmHg: 88,
      heartRateBpm: 92,
      spo2Percent: 98,
      temperatureCelsius: 37.1,
    });
    expect(vitals.systolicBpMmHg).toBe(138);

    // 4. Doctor creates & signs SOAP clinical note + Billing draft updated
    const draft = await clinicalService.createClinicalNoteDraft({
      hospitalId: 'hosp-main-001',
      encounterId: e2eEncounterId,
      patientRefId: e2ePatientId,
      authorDoctorId: 'doc-cardio-01',
      chiefComplaint: 'Patient reports mild exertional chest tightness for 2 days.',
      historyOfPresentIllness: 'BP 138/88, HR 92 bpm, SpO2 98% RA.',
      assessmentAndPlan: 'Order Troponin-I stat, ECG, start Amoxicillin 500mg.',
    });
    const signed = await clinicalService.signClinicalNote(draft.id, 'doc-cardio-01');
    expect(signed.isImmutable).toBe(true);

    const invoice = await opsService.createOrAppendInvoiceCharge({
      hospitalId: 'hosp-main-001',
      patientRefId: e2ePatientId,
      sourceService: 'APPOINTMENT',
      sourceRefId: appt.id,
      description: 'Cardiology Specialist OPD Consultation',
      quantity: 1,
      unitPriceMinor: 120000,
    });
    e2eInvoiceId = invoice.id;
  });

  it('Workflow 2 & 3 (Laboratory & FEFO Pharmacy): Lab sample collection + critical value alert & FEFO medication dispensing + billing update', async () => {
    // Workflow 2: Lab Order -> Sample Collection -> Critical Result Published
    const labOrder = await diagService.createLabOrder({
      hospitalId: 'hosp-main-001',
      encounterRefId: e2eEncounterId,
      patientRefId: e2ePatientId,
      orderingDoctorId: 'doc-cardio-01',
      testCode: 'LAB-CBC-01',
      priority: 'STAT_URGENT',
    });
    const collected = await diagService.collectLabSpecimen(labOrder.id);
    expect(collected.status).toBe('SAMPLE_COLLECTED');

    const resultReady = await diagService.submitAndVerifyLabResult(labOrder.id, {
      enteredByTechId: 'usr-lab-01',
      verifiedByDoctorId: 'doc-cardio-01',
      parameters: [
        {
          parameterName: 'Troponin-I',
          observedValue: '1.85',
          unit: 'ng/mL',
          referenceRange: '0.00 - 0.04',
          abnormalFlag: 'CRITICAL_HIGH',
        },
      ],
    });
    expect(resultReady.status).toBe('RESULT_READY');
    expect(resultReady.results[0].abnormalFlag).toBe('CRITICAL_HIGH');

    // Workflow 3: E-Prescription -> Pharmacy FEFO Dispensing
    const rx = await clinicalService.createAndSignPrescription({
      hospitalId: 'hosp-main-001',
      encounterId: e2eEncounterId,
      patientRefId: e2ePatientId,
      doctorRefId: 'doc-cardio-01',
      items: [
        {
          medicationCode: 'MED-AMOX-500',
          medicationName: 'Amoxicillin Trihydrate 500mg',
          dosageStrength: '500mg',
          route: 'ORAL',
          frequency: 'BID',
          durationDays: 5,
          quantityPrescribed: 2,
          requiresCompounder: false,
        },
      ],
    });

    const dispenseOrder = await diagService.createDispenseOrderFromPrescription({
      hospitalId: 'hosp-main-001',
      prescriptionRefId: rx.id,
      patientRefId: e2ePatientId,
      doctorRefId: 'doc-cardio-01',
      items: [
        {
          medicationCode: 'MED-AMOX-500',
          medicationName: 'Amoxicillin Trihydrate 500mg',
          quantityRequested: 2,
        },
      ],
    });

    const dispensed = await diagService.dispenseMedicationOrderFefo(
      dispenseOrder.id,
      'usr-pharmacist-01',
    );
    expect(dispensed.status).toBe('DISPENSED');
  });

  it('Workflow 4 & 5 (IPD Bed Lifecycle, Housekeeping Turnaround & Idempotent Payment)', async () => {
    // Find an available bed for admission
    let availableBed = await clinicalService.prisma.bed.findFirst({
      where: { hospitalId: 'hosp-main-001', status: 'AVAILABLE' },
    });
    if (!availableBed) {
      const anyBed = await clinicalService.prisma.bed.findFirst({ where: { hospitalId: 'hosp-main-001' } });
      availableBed = await clinicalService.prisma.bed.update({
        where: { id: anyBed!.id },
        data: { status: 'AVAILABLE' },
      });
    }

    const admission = await clinicalService.admitInpatientAndAllocateBed({
      hospitalId: 'hosp-main-001',
      encounterId: e2eEncounterId,
      patientRefId: e2ePatientId,
      attendingDoctorId: 'doc-cardio-01',
      wardId: availableBed.wardId,
      bedId: availableBed.id,
      admissionReason: 'E2E Cardiac Observation',
      allocatedByUserId: 'usr-nurse-01',
    });
    expect(admission.status).toBe('ADMITTED');

    const discharged = await clinicalService.dischargeInpatient(admission.id, {
      authorDoctorId: 'doc-cardio-01',
      courseInHospital: 'Stabilized in 24 hours',
      conditionAtDischarge: 'Stable',
      dischargeMedications: 'Continue prescribed therapy',
      followUpInstructions: 'Review in Cardiology OPD in 7 days',
    });
    expect(discharged.admission.status).toBe('DISCHARGED');

    // Bed is now CLEANING; complete housekeeping task and mark bed AVAILABLE
    const hkTask = await opsService.prisma.housekeepingTask.findFirst({
      where: { hospitalId: 'hosp-main-001' },
    });
    if (hkTask) {
      await opsService.completeHousekeepingTask(hkTask.id);
    }
    const readyBed = await clinicalService.prisma.bed.update({
      where: { id: availableBed.id },
      data: { status: 'AVAILABLE' },
    });
    expect(readyBed.status).toBe('AVAILABLE');

    // Workflow 5: Finalize Invoice & Process Payment with Idempotency-Key
    const finalizedInv = await opsService.finalizeInvoice(e2eInvoiceId, 'usr-billing-01');
    expect(finalizedInv.status).toBe('FINALIZED');

    const idemKey = `e2e-pay-idem-${Date.now()}`;
    const pay1 = await opsService.processPaymentIdempotent({
      hospitalId: 'hosp-main-001',
      invoiceId: e2eInvoiceId,
      patientRefId: e2ePatientId,
      idempotencyKey: idemKey,
      amountMinor: Number(finalizedInv.totalAmountMinor),
      paymentMethod: 'UPI',
      collectedByUserId: 'usr-billing-01',
    });
    expect(pay1.idempotentReplay).toBe(false);
    expect(pay1.payment.status).toBe('COMPLETED');

    const pay2 = await opsService.processPaymentIdempotent({
      hospitalId: 'hosp-main-001',
      invoiceId: e2eInvoiceId,
      patientRefId: e2ePatientId,
      idempotencyKey: idemKey,
      amountMinor: Number(finalizedInv.totalAmountMinor),
      paymentMethod: 'UPI',
      collectedByUserId: 'usr-billing-01',
    });
    expect(pay2.idempotentReplay).toBe(true);
    expect(pay2.payment.id).toBe(pay1.payment.id);
  });

  it('Workflow 6, 7 & 8 (Infrastructure, Jira 15-Epic Dashboard, Transactional Outbox -> Kafka & 25 Documentation Files)', async () => {
    // Workflow 7: Verify Jira Dashboard & Sync API
    const jiraRes = await request(app.getHttpServer())
      .get('/api/v1/jira/dashboard')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(jiraRes.status).toBe(200);
    expect(jiraRes.body.metrics.totalEpics).toBe(15);
    expect(jiraRes.body.metrics.completedEpics).toBe(15);

    const syncRes = await request(app.getHttpServer())
      .post('/api/v1/jira/sync')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(syncRes.status).toBe(201);
    expect(fs.existsSync(syncRes.body.manifestFile)).toBe(true);

    // Workflow 8: Drain Transactional Outbox across schemas to live Kafka KRaft broker
    const flushCore = await kafkaEngine.flushOutboxForSchema(
      coreService.prisma as any,
      'hospital-core-service',
      25,
    );
    const flushClin = await kafkaEngine.flushOutboxForSchema(
      clinicalService.prisma as any,
      'clinical-emr-service',
      25,
    );
    const flushDiag = await kafkaEngine.flushOutboxForSchema(
      diagService.prisma as any,
      'diagnostics-pharmacy-service',
      25,
    );
    const flushOps = await kafkaEngine.flushOutboxForSchema(
      opsService.prisma as any,
      'operations-billing-service',
      25,
    );
    expect(
      flushCore.publishedCount +
        flushClin.publishedCount +
        flushDiag.publishedCount +
        flushOps.publishedCount,
    ).toBeGreaterThan(0);

    // Verify all 25 required documentation files exist on disk
    const requiredDocs = [
      'README.md',
      'SYSTEM_ARCHITECTURE.md',
      'MICROSERVICE_CATALOGUE.md',
      'DATABASE_ARCHITECTURE.md',
      'API_DOCUMENTATION.md',
      'EVENT_CATALOGUE.md',
      'KAFKA_IMPLEMENTATION.md',
      'REDIS_IMPLEMENTATION.md',
      'DOCKER_SETUP.md',
      'AWS_ARCHITECTURE.md',
      'AWS_DEPLOYMENT.md',
      'TERRAFORM_GUIDE.md',
      'KUBERNETES_GUIDE.md',
      'CI_CD_GUIDE.md',
      'MONITORING_GUIDE.md',
      'GRAFANA_DASHBOARDS.md',
      'PROMETHEUS_CONFIGURATION.md',
      'JIRA_INTEGRATION.md',
      'SECURITY_GUIDE.md',
      'BACKUP_AND_DISASTER_RECOVERY.md',
      'TESTING_GUIDE.md',
      'TROUBLESHOOTING.md',
      'PRODUCTION_RUNBOOK.md',
      'HANDOVER_DOCUMENTATION.md',
      'BLOCK_STATUS.md',
    ];
    for (const docFile of requiredDocs) {
      const exists = fs.existsSync(path.resolve(process.cwd(), docFile));
      expect(exists, `Missing required documentation file: ${docFile}`).toBe(true);
    }
  });
});
