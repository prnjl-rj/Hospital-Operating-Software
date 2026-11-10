import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createGatewayApp } from '../../services/api-gateway/src/main';
import { IdentityService } from '../../services/identity-service/src/identity.service';
import { HospitalCoreService } from '../../services/hospital-core-service/src/hospital-core.service';
import { ClinicalEmrService } from '../../services/clinical-emr-service/src/clinical-emr.service';
import { DiagnosticsPharmacyService } from '../../services/diagnostics-pharmacy-service/src/diagnostics-pharmacy.service';
import { OperationsBillingService } from '../../services/operations-billing-service/src/operations-billing.service';

describe('BLOCK 04 — Core Backend Microservices & API Gateway Live Integration Suite', () => {
  let app: INestApplication;
  let identityService: IdentityService;
  let coreService: HospitalCoreService;
  let clinicalService: ClinicalEmrService;
  let diagService: DiagnosticsPharmacyService;
  let opsService: OperationsBillingService;
  let doctorToken: string;
  let receptionistToken: string;

  beforeAll(async () => {
    app = await createGatewayApp();
    await app.init();
    identityService = app.get(IdentityService);
    coreService = app.get(HospitalCoreService);
    clinicalService = app.get(ClinicalEmrService);
    diagService = app.get(DiagnosticsPharmacyService);
    opsService = app.get(OperationsBillingService);

    const docAuth = await identityService.login({
      emailOrUsername: 'dr.arjun@hos.local',
      password: 'Hospital@2026!',
    });
    doctorToken = docAuth.accessToken;

    const recepAuth = await identityService.login({
      emailOrUsername: 'reception@hos.local',
      password: 'Hospital@2026!',
    });
    receptionistToken = recepAuth.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a synthetic patient, books an appointment, prevents double-booking, and checks into OPD queue', async () => {
    const patient = await coreService.registerPatient(
      {
        hospitalId: 'hosp-main-001',
        firstName: 'Rohan',
        lastName: 'Desai (Synthetic)',
        dateOfBirth: '1990-08-20',
        gender: 'MALE',
        bloodGroup: 'B+',
        phone: `+91-98${Math.floor(10000000 + Math.random() * 89999999)}`,
        email: 'rohan.synthetic@example.org',
        addressLine: '42 Synthetic Residency',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        emergencyContactName: 'Sneha Desai',
        emergencyContactPhone: '+91-9800000099',
      },
      'usr-recep-01',
    );
    expect(patient.mrn).toMatch(/^HOS-2026-\d{6}$/);
    expect(patient.isSyntheticTestRecord).toBe(true);

    const slotStart = new Date(Date.now() + Math.floor(Math.random() * 10000000) + 3600000).toISOString();
    const slotEnd = new Date(new Date(slotStart).getTime() + 15 * 60 * 1000).toISOString();

    const appt = await coreService.createAppointment(
      {
        hospitalId: 'hosp-main-001',
        patientId: patient.id,
        doctorId: 'doc-cardio-01',
        departmentId: 'dept-cardio',
        scheduledStart: slotStart,
        scheduledEnd: slotEnd,
        reasonForVisit: 'Exertional chest discomfort evaluation',
      },
      'usr-recep-01',
    );
    expect(appt.appointmentNumber).toMatch(/^APT-2026-\d{6}$/);

    // Verify double-booking at the exact same slot is rejected with 409 Conflict
    await expect(
      coreService.createAppointment(
        {
          hospitalId: 'hosp-main-001',
          patientId: patient.id,
          doctorId: 'doc-cardio-01',
          departmentId: 'dept-cardio',
          scheduledStart: slotStart,
          scheduledEnd: slotEnd,
          reasonForVisit: 'Duplicate booking test',
        },
        'usr-recep-01',
      ),
    ).rejects.toThrow(/DOCTOR_SLOT_ALREADY_BOOKED/);

    // Check in to OPD Queue
    const opdToken = await coreService.checkInOpdAppointment(appt.id, 'URGENT');
    expect(opdToken.status).toBe('WAITING_VITALS');
    expect(opdToken.tokenNumber).toBeGreaterThanOrEqual(1);
  });

  it('creates an Encounter, signs an immutable Clinical Note, blocks illegal mutation via DB trigger, and appends an Addendum', async () => {
    const contextCheck = await coreService.verifyClinicalContext({
      hospitalId: 'hosp-main-001',
      patientId: 'pat-synth-001',
      doctorId: 'doc-cardio-01',
    });
    expect(contextCheck.valid).toBe(true);

    const encounter = await clinicalService.createEncounter({
      hospitalId: 'hosp-main-001',
      patientRefId: 'pat-synth-001',
      patientMrn: contextCheck.patientMrn!,
      doctorRefId: 'doc-cardio-01',
      departmentRefId: 'dept-cardio',
      encounterType: 'OPD',
    });
    expect(encounter.encounterNumber).toMatch(/^ENC-2026-\d{6}$/);

    // Record Vitals
    const vitals = await clinicalService.recordVitalSigns({
      encounterId: encounter.id,
      patientRefId: 'pat-synth-001',
      recordedByUserId: 'usr-nurse-01',
      recordedByRole: 'NURSE',
      systolicBpMmHg: 128,
      diastolicBpMmHg: 82,
      heartRateBpm: 76,
      spo2Percent: 99,
      temperatureCelsius: 36.8,
    });
    expect(vitals.systolicBpMmHg).toBe(128);

    // Draft and Sign Clinical SOAP Note
    const draft = await clinicalService.createClinicalNoteDraft({
      hospitalId: 'hosp-main-001',
      encounterId: encounter.id,
      patientRefId: 'pat-synth-001',
      authorDoctorId: 'doc-cardio-01',
      chiefComplaint: 'Mild palpitations for 2 days',
      historyOfPresentIllness: 'No syncope, normal baseline ECG',
      assessmentAndPlan: 'Order CBC, prescribe Amoxicillin 500mg, routine follow-up',
    });

    const signed = await clinicalService.signClinicalNote(draft.id, 'doc-cardio-01');
    expect(signed.isImmutable).toBe(true);
    expect(signed.contentHash).toHaveLength(64);

    // Attempt to overwrite a signed clinical note directly in PostgreSQL -> Trigger must block with MEDICO_LEGAL_VIOLATION!
    await expect(
      clinicalService.prisma.clinicalNote.update({
        where: { id: signed.id },
        data: { assessmentAndPlan: 'Tampered clinical plan' },
      }),
    ).rejects.toThrow(/MEDICO_LEGAL_VIOLATION/);

    // Valid amendment via ClinicalNoteAddendum succeeds
    const addendum = await clinicalService.addClinicalNoteAddendum({
      clinicalNoteId: signed.id,
      authorUserId: 'doc-cardio-01',
      reason: 'Added family history clarification',
      addendumText: 'Patient reports no family history of premature CAD.',
    });
    expect(addendum.contentHash).toHaveLength(64);
  });

  it('executes E-Prescription -> FEFO Pharmacy Dispensing, Lab Order -> Result Ready, and IPD Bed Allocation -> Discharge', async () => {
    const encounter = await clinicalService.createEncounter({
      hospitalId: 'hosp-main-001',
      patientRefId: 'pat-synth-001',
      patientMrn: 'HOS-2026-000001',
      doctorRefId: 'doc-cardio-01',
      departmentRefId: 'dept-cardio',
      encounterType: 'IPD',
    });

    // 1. Prescription + automatic Compounder Task
    const rx = await clinicalService.createAndSignPrescription({
      hospitalId: 'hosp-main-001',
      encounterId: encounter.id,
      patientRefId: 'pat-synth-001',
      doctorRefId: 'doc-cardio-01',
      items: [
        {
          medicationCode: 'MED-AMOX-500',
          medicationName: 'Amoxicillin Trihydrate 500mg',
          dosageStrength: '500mg',
          route: 'IM',
          frequency: 'BID',
          durationDays: 5,
          quantityPrescribed: 10,
          requiresCompounder: true,
        },
      ],
    });
    expect(rx.prescriptionNumber).toMatch(/^RX-2026-\d{6}$/);

    // 2. Pharmacy Dispensing with FEFO Inventory Batch Deduction
    const dispenseOrder = await diagService.createDispenseOrderFromPrescription({
      hospitalId: 'hosp-main-001',
      prescriptionRefId: rx.id,
      patientRefId: 'pat-synth-001',
      doctorRefId: 'doc-cardio-01',
      items: [
        {
          medicationCode: 'MED-AMOX-500',
          medicationName: 'Amoxicillin Trihydrate 500mg',
          quantityRequested: 10,
        },
      ],
    });

    const dispensed = await diagService.dispenseMedicationOrderFefo(
      dispenseOrder.id,
      'usr-pharmacist-01',
    );
    expect(dispensed.status).toBe('DISPENSED');
    expect(dispensed.items[0].batchNumber).toBe('BATCH-2026-AX01');
    expect(dispensed.items[0].quantityDispensed).toBe(10);

    // 3. Laboratory Order -> Specimen Collection -> Result Verification
    const labOrder = await diagService.createLabOrder({
      hospitalId: 'hosp-main-001',
      encounterRefId: encounter.id,
      patientRefId: 'pat-synth-001',
      orderingDoctorId: 'doc-cardio-01',
      testCode: 'LAB-CBC-01',
      priority: 'STAT_URGENT',
    });
    const collected = await diagService.collectLabSpecimen(labOrder.id);
    expect(collected.status).toBe('SAMPLE_COLLECTED');
    expect(collected.specimenBarcode).toMatch(/^SPEC-/);

    const resultReady = await diagService.submitAndVerifyLabResult(labOrder.id, {
      enteredByTechId: 'usr-lab-01',
      verifiedByDoctorId: 'doc-cardio-01',
      parameters: [
        {
          parameterName: 'Hemoglobin',
          observedValue: '14.6',
          unit: 'g/dL',
          referenceRange: '13.0 - 17.0',
          abnormalFlag: 'NORMAL',
        },
      ],
    });
    expect(resultReady.status).toBe('RESULT_READY');

    // 4. IPD Admission & Bed Allocation -> Discharge -> Bed Cleaning Transition
    const availableBed = await clinicalService.prisma.bed.findFirst({
      where: { hospitalId: 'hosp-main-001', status: 'AVAILABLE' },
    });
    expect(availableBed).not.toBeNull();

    const admission = await clinicalService.admitInpatientAndAllocateBed({
      hospitalId: 'hosp-main-001',
      encounterId: encounter.id,
      patientRefId: 'pat-synth-001',
      attendingDoctorId: 'doc-cardio-01',
      wardId: availableBed!.wardId,
      bedId: availableBed!.id,
      admissionReason: 'Inpatient observation & IV therapy',
      allocatedByUserId: 'usr-nurse-01',
    });
    expect(admission.status).toBe('ADMITTED');

    const occupiedBed = await clinicalService.prisma.bed.findUnique({
      where: { id: availableBed!.id },
    });
    expect(occupiedBed!.status).toBe('OCCUPIED');

    const discharged = await clinicalService.dischargeInpatient(admission.id, {
      authorDoctorId: 'doc-cardio-01',
      courseInHospital: 'Uneventful recovery over 24 hours',
      conditionAtDischarge: 'Hemodynamically stable',
      dischargeMedications: 'Continue oral medications for 5 days',
      followUpInstructions: 'Review in Cardiology OPD in 7 days',
    });
    expect(discharged.admission.status).toBe('DISCHARGED');

    const cleaningBed = await clinicalService.prisma.bed.findUnique({
      where: { id: availableBed!.id },
    });
    expect(cleaningBed!.status).toBe('CLEANING');
  });

  it('processes Billing Invoices, enforces Idempotent Payments, and serves API Gateway BFF endpoints', async () => {
    const invoice = await opsService.createOrAppendInvoiceCharge({
      hospitalId: 'hosp-main-001',
      patientRefId: 'pat-synth-001',
      sourceService: 'APPOINTMENT',
      sourceRefId: 'appt-ref-001',
      description: 'Cardiology Super-Specialty Consultation',
      quantity: 1,
      unitPriceMinor: 100000,
    });
    expect(invoice.totalAmountMinor).toBe(BigInt(105000)); // 1000.00 + 5% tax

    const finalized = await opsService.finalizeInvoice(invoice.id, 'usr-billing-01');
    expect(finalized.status).toBe('FINALIZED');

    const idemKey = `idem-pay-${Date.now()}`;
    const firstPay = await opsService.processPaymentIdempotent({
      hospitalId: 'hosp-main-001',
      invoiceId: invoice.id,
      patientRefId: 'pat-synth-001',
      idempotencyKey: idemKey,
      amountMinor: 105000,
      paymentMethod: 'UPI',
      collectedByUserId: 'usr-billing-01',
    });
    expect(firstPay.idempotentReplay).toBe(false);
    expect(firstPay.payment.status).toBe('COMPLETED');

    // Duplicate payment submission with same idempotencyKey must NOT double charge!
    const duplicatePay = await opsService.processPaymentIdempotent({
      hospitalId: 'hosp-main-001',
      invoiceId: invoice.id,
      patientRefId: 'pat-synth-001',
      idempotencyKey: idemKey,
      amountMinor: 105000,
      paymentMethod: 'UPI',
      collectedByUserId: 'usr-billing-01',
    });
    expect(duplicatePay.idempotentReplay).toBe(true);
    expect(duplicatePay.payment.id).toBe(firstPay.payment.id);

    // Verify API Gateway HTTP endpoints via Supertest
    const healthRes = await request(app.getHttpServer()).get('/api/v1/gateway/health').expect(200);
    expect(healthRes.body.status).toBe('HEALTHY');

    const overviewRes = await request(app.getHttpServer())
      .get('/api/v1/dashboard/overview')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(overviewRes.body.hospital.code).toBe('HOS-MAIN-001');
    expect(overviewRes.body.metrics.totalBeds).toBeGreaterThanOrEqual(15);

    // Verify RBAC enforcement over HTTP: Receptionist cannot sign a clinical note (403 Forbidden)
    await request(app.getHttpServer())
      .post('/api/v1/emr/notes/non-existent/sign')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .expect(403);
  });
});

