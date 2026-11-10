import { createHash, scryptSync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

import { PrismaClient as IdentityPrismaClient } from '../../node_modules/.prisma/identity-client';
import { PrismaClient as HospitalCorePrismaClient } from '../../node_modules/.prisma/hospital-core-client';
import { PrismaClient as ClinicalPrismaClient } from '../../node_modules/.prisma/clinical-client';
import { PrismaClient as DiagnosticsPrismaClient } from '../../node_modules/.prisma/diagnostics-pharmacy-client';
import { PrismaClient as OperationsPrismaClient } from '../../node_modules/.prisma/operations-billing-client';

function hashPassword(password: string): string {
  const salt = 'hos_deterministic_seed_salt_2026';
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function runHospitalSeed() {
  const identityDb = new IdentityPrismaClient();
  const coreDb = new HospitalCorePrismaClient();
  const clinicalDb = new ClinicalPrismaClient();
  const diagDb = new DiagnosticsPrismaClient();
  const opsDb = new OperationsPrismaClient();

  console.log('[Seed] Starting synthetic data seed across 5 isolated PostgreSQL schemas...');

  try {
    // =========================================================================
    // 1. HOSPITAL CORE SCHEMA: Hospital, Buildings, Floors, Departments, Staff, Doctors, Synthetic Patients
    // =========================================================================
    const hospital = await coreDb.hospital.upsert({
      where: { code: 'HOS-MAIN-001' },
      update: {},
      create: {
        id: 'hosp-main-001',
        code: 'HOS-MAIN-001',
        name: 'Emerald Multispecialty Hospital & Research Centre (Synthetic Dev)',
        registrationNumber: 'REG-MH-2026-500PLUS',
        accreditationLevel: 'NABH-JCI-Enterprise',
        totalBedCapacity: 550,
        addressLine: 'Plot 14, Health City Tech Corridor',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        postalCode: '400001',
        contactPhone: '+91-22-55550100',
        emergencyPhone: '+91-22-55550108',
      },
    });

    const towerA = await coreDb.building.upsert({
      where: { hospitalId_code: { hospitalId: hospital.id, code: 'BLD-TOWER-A' } },
      update: {},
      create: {
        id: 'bld-tower-a',
        hospitalId: hospital.id,
        code: 'BLD-TOWER-A',
        name: 'Tower A — Main Outpatient, Diagnostics & Surgical Block',
        floorsCount: 8,
      },
    });

    const deptSpecs = [
      { id: 'dept-cardio', code: 'DEPT-CARDIO', name: 'Cardiology & Interventional Cath Lab', cat: 'SUPER_SPECIALTY', er: false },
      { id: 'dept-emerg', code: 'DEPT-EMERG', name: 'Emergency & Trauma Medicine', cat: 'CRITICAL_CARE', er: true },
      { id: 'dept-genmed', code: 'DEPT-GENMED', name: 'Internal & General Medicine', cat: 'CLINICAL', er: false },
      { id: 'dept-ortho', code: 'DEPT-ORTHO', name: 'Orthopedics & Joint Replacement', cat: 'SURGICAL', er: false },
      { id: 'dept-icu', code: 'DEPT-ICU', name: 'Multidisciplinary Intensive Care (ICU)', cat: 'CRITICAL_CARE', er: true },
      { id: 'dept-path', code: 'DEPT-PATH', name: 'Central Clinical Laboratory & Pathology', cat: 'DIAGNOSTIC', er: false },
      { id: 'dept-rad', code: 'DEPT-RAD', name: 'Radiology & Advanced Imaging (PACS)', cat: 'DIAGNOSTIC', er: false },
      { id: 'dept-pharm', code: 'DEPT-PHARM', name: 'Hospital Pharmacy & Central Stores', cat: 'SUPPORT', er: false },
    ];

    for (const d of deptSpecs) {
      await coreDb.department.upsert({
        where: { hospitalId_code: { hospitalId: hospital.id, code: d.code } },
        update: {},
        create: {
          id: d.id,
          hospitalId: hospital.id,
          code: d.code,
          name: d.name,
          specialtyCategory: d.cat,
          isEmergencyUnit: d.er,
        },
      });
    }

    // =========================================================================
    // 2. IDENTITY SCHEMA: All 15 Hospital Roles, Permissions & Synthetic Role Users
    // =========================================================================
    const roleDefinitions = [
      { code: 'SUPER_ADMIN', name: 'Super Administrator', desc: 'Multi-branch enterprise governance' },
      { code: 'HOSPITAL_ADMIN', name: 'Hospital Administrator', desc: '500+ bed hospital operations administrator' },
      { code: 'DEPARTMENT_ADMIN', name: 'Department Administrator', desc: 'Departmental roster and OPD/IPD coordinator' },
      { code: 'DOCTOR', name: 'Consultant Doctor', desc: 'Clinical consultations, EMR signing, prescriptions & orders' },
      { code: 'NURSE', name: 'Registered Nurse', desc: 'Ward nursing care, vitals, MAR medication administration' },
      { code: 'COMPOUNDER', name: 'Compounder / Clinical Assistant', desc: 'OPD dressing, injections, minor procedures & dispensary prep' },
      { code: 'PHARMACIST', name: 'Hospital Pharmacist', desc: 'Medication dispensing, batch/expiry check & stock control' },
      { code: 'LAB_TECHNICIAN', name: 'Laboratory Technician', desc: 'Specimen barcoding, analyzer processing & lab result entry' },
      { code: 'RADIOLOGY_TECHNICIAN', name: 'Radiology Technician', desc: 'Modality imaging execution & PACS study upload' },
      { code: 'RECEPTIONIST', name: 'Front Desk Receptionist', desc: 'Patient registration, appointment booking & OPD token check-in' },
      { code: 'BILLING_STAFF', name: 'Billing Executive', desc: 'Folio invoicing, cashier payments & TPA claims' },
      { code: 'HR', name: 'Human Resources Manager', desc: 'Workforce onboarding, shift rosters, leaves & payroll' },
      { code: 'INVENTORY_MANAGER', name: 'Inventory & Procurement Manager', desc: 'Central store stock, FEFO batches, PO & GRN' },
      { code: 'ACCOUNTANT', name: 'Hospital Accountant', desc: 'Revenue reconciliation, refunds & financial ledger' },
      { code: 'AUDITOR', name: 'Compliance & Clinical Auditor', desc: 'Read-only access to tamper-evident audit logs & reports' },
      { code: 'PATIENT', name: 'Patient Portal User', desc: 'Self-service appointments, prescriptions & lab report access' },
    ] as const;

    const roleMap = new Map<string, string>();
    for (const r of roleDefinitions) {
      const createdRole = await identityDb.role.upsert({
        where: { code: r.code },
        update: {},
        create: {
          code: r.code,
          name: r.name,
          description: r.desc,
        },
      });
      roleMap.set(r.code, createdRole.id);
    }

    const defaultPasswordHash = hashPassword('Hospital@2026!');
    const seedUsers = [
      { id: 'usr-super-admin', email: 'superadmin@hos.local', username: 'superadmin', fullName: 'Dr. Vikram Mehta (Super Admin)', role: 'SUPER_ADMIN' },
      { id: 'usr-hosp-admin', email: 'admin@hos.local', username: 'hospadmin', fullName: 'Ananya Sharma (Hospital Admin)', role: 'HOSPITAL_ADMIN' },
      { id: 'usr-dept-admin', email: 'deptadmin@hos.local', username: 'deptadmin', fullName: 'Rajesh Iyer (Cardiology Dept Admin)', role: 'DEPARTMENT_ADMIN' },
      { id: 'usr-doctor-01', email: 'dr.arjun@hos.local', username: 'dr.arjun', fullName: 'Dr. Arjun Nair (Sr. Cardiologist)', role: 'DOCTOR', doctorRefId: 'doc-cardio-01' },
      { id: 'usr-nurse-01', email: 'nurse.priya@hos.local', username: 'nurse.priya', fullName: 'Sister Priya Thomas (ICU/Ward Nurse)', role: 'NURSE' },
      { id: 'usr-compounder-01', email: 'compounder.ravi@hos.local', username: 'compounder.ravi', fullName: 'Ravi Verma (Sr. Compounder)', role: 'COMPOUNDER' },
      { id: 'usr-pharmacist-01', email: 'pharmacy@hos.local', username: 'pharmacist', fullName: 'Neha Kulkarni (Chief Pharmacist)', role: 'PHARMACIST' },
      { id: 'usr-lab-01', email: 'lab@hos.local', username: 'labtech', fullName: 'Suresh Menon (Lead Lab Tech)', role: 'LAB_TECHNICIAN' },
      { id: 'usr-rad-01', email: 'radiology@hos.local', username: 'radtech', fullName: 'Kiran Deshmukh (Radiology Tech)', role: 'RADIOLOGY_TECHNICIAN' },
      { id: 'usr-recep-01', email: 'reception@hos.local', username: 'reception', fullName: 'Pooja Joshi (OPD Receptionist)', role: 'RECEPTIONIST' },
      { id: 'usr-billing-01', email: 'billing@hos.local', username: 'billing', fullName: 'Amitabh Sen (Billing Executive)', role: 'BILLING_STAFF' },
      { id: 'usr-hr-01', email: 'hr@hos.local', username: 'hrmanager', fullName: 'Kavita Rao (HR Head)', role: 'HR' },
      { id: 'usr-inventory-01', email: 'inventory@hos.local', username: 'inventory', fullName: 'Deepak Gupta (Inventory Manager)', role: 'INVENTORY_MANAGER' },
      { id: 'usr-accountant-01', email: 'accounts@hos.local', username: 'accountant', fullName: 'Sanjay Bansal (Chief Accountant)', role: 'ACCOUNTANT' },
      { id: 'usr-auditor-01', email: 'auditor@hos.local', username: 'auditor', fullName: 'Meera Krishnan (Compliance Auditor)', role: 'AUDITOR' },
    ];

    for (const u of seedUsers) {
      const user = await identityDb.user.upsert({
        where: { email: u.email },
        update: {},
        create: {
          id: u.id,
          hospitalId: hospital.id,
          email: u.email,
          username: u.username,
          passwordHash: defaultPasswordHash,
          fullName: u.fullName,
          doctorRefId: u.doctorRefId ?? null,
          status: 'ACTIVE',
        },
      });
      const roleId = roleMap.get(u.role)!;
      await identityDb.userRole.upsert({
        where: { userId_roleId_hospitalId: { userId: user.id, roleId, hospitalId: hospital.id } },
        update: {},
        create: {
          userId: user.id,
          roleId,
          hospitalId: hospital.id,
        },
      });
    }

    // Seed Doctors & Synthetic Patients in Hospital Core
    await coreDb.doctorProfile.upsert({
      where: { doctorCode: 'DOC-2026-001' },
      update: {},
      create: {
        id: 'doc-cardio-01',
        hospitalId: hospital.id,
        departmentId: 'dept-cardio',
        userRefId: 'usr-doctor-01',
        doctorCode: 'DOC-2026-001',
        fullName: 'Dr. Arjun Nair',
        medicalLicenseNumber: 'MCI-MH-88412',
        specialization: 'Interventional Cardiology',
        qualification: 'MBBS, MD, DM (Cardiology)',
        consultationFeeMinor: BigInt(100000), // 1,000.00 INR
        followupFeeMinor: BigInt(50000),
        roomNumber: 'OPD-104',
      },
    });

    await coreDb.patient.upsert({
      where: { mrn: 'HOS-2026-000001' },
      update: {},
      create: {
        id: 'pat-synth-001',
        hospitalId: hospital.id,
        mrn: 'HOS-2026-000001',
        firstName: 'Aarav',
        lastName: 'Patel (Synthetic)',
        dateOfBirth: new Date('1982-05-14T00:00:00.000Z'),
        gender: 'MALE',
        bloodGroup: 'O+',
        phone: '+91-9000000001',
        email: 'aarav.synthetic@example.org',
        addressLine: '101 Synthetic Test Avenue',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        isSyntheticTestRecord: true,
        registeredByUserId: 'usr-recep-01',
      },
    });

    // =========================================================================
    // 3. CLINICAL SCHEMA: Wards & Beds (General, Private, ICU, ER)
    // =========================================================================
    const wardGen = await clinicalDb.ward.upsert({
      where: { code: 'WARD-GEN-A' },
      update: {},
      create: {
        id: 'ward-gen-a',
        hospitalId: hospital.id,
        code: 'WARD-GEN-A',
        name: 'General Medical Ward A (Floor 3)',
        wardType: 'GENERAL',
        floorRefCode: 'FL-03',
        totalBeds: 60,
        dailyTariffMinor: BigInt(250000),
      },
    });

    const wardIcu = await clinicalDb.ward.upsert({
      where: { code: 'WARD-ICU-01' },
      update: {},
      create: {
        id: 'ward-icu-01',
        hospitalId: hospital.id,
        code: 'WARD-ICU-01',
        name: 'Cardiac & Multidisciplinary ICU (Floor 2)',
        wardType: 'ICU',
        floorRefCode: 'FL-02',
        totalBeds: 30,
        dailyTariffMinor: BigInt(1200000),
      },
    });

    for (let i = 1; i <= 10; i++) {
      const bedNo = `BED-GEN-A-${String(i).padStart(3, '0')}`;
      await clinicalDb.bed.upsert({
        where: { bedNumber: bedNo },
        update: {},
        create: {
          hospitalId: hospital.id,
          wardId: wardGen.id,
          bedNumber: bedNo,
          roomNumber: `RM-30${Math.ceil(i / 2)}`,
          bedType: 'FOWLER',
          hasOxygenSupply: true,
          hasVentilator: false,
          status: 'AVAILABLE',
        },
      });
    }

    for (let i = 1; i <= 5; i++) {
      const bedNo = `BED-ICU-01-${String(i).padStart(3, '0')}`;
      await clinicalDb.bed.upsert({
        where: { bedNumber: bedNo },
        update: {},
        create: {
          hospitalId: hospital.id,
          wardId: wardIcu.id,
          bedNumber: bedNo,
          roomNumber: `ICU-BAY-${i}`,
          bedType: 'ICU_VENTILATOR',
          hasOxygenSupply: true,
          hasVentilator: true,
          status: 'AVAILABLE',
        },
      });
    }

    // =========================================================================
    // 4. DIAGNOSTICS & PHARMACY SCHEMA: Medications, Batches, Lab Catalog, Blood Units
    // =========================================================================
    const medAmox = await diagDb.medicationCatalog.upsert({
      where: { skuCode: 'MED-AMOX-500' },
      update: {},
      create: {
        id: 'med-amox-500',
        hospitalId: hospital.id,
        skuCode: 'MED-AMOX-500',
        genericName: 'Amoxicillin Trihydrate',
        brandName: 'Amoxil-500 Synthetic',
        dosageForm: 'CAPSULE',
        strength: '500mg',
        unitPriceMinor: BigInt(1500),
        reorderLevel: 200,
      },
    });

    await diagDb.inventoryBatch.upsert({
      where: {
        medicationId_batchNumber_storeCode: {
          medicationId: medAmox.id,
          batchNumber: 'BATCH-2026-AX01',
          storeCode: 'CENTRAL_PHARMACY',
        },
      },
      update: {},
      create: {
        hospitalId: hospital.id,
        medicationId: medAmox.id,
        batchNumber: 'BATCH-2026-AX01',
        storeCode: 'CENTRAL_PHARMACY',
        quantityOnHand: 2500,
        expiryDate: new Date('2028-06-30T00:00:00.000Z'),
      },
    });

    await diagDb.labTestCatalog.upsert({
      where: { testCode: 'LAB-CBC-01' },
      update: {},
      create: {
        hospitalId: hospital.id,
        testCode: 'LAB-CBC-01',
        testName: 'Complete Blood Count (CBC) with Differential',
        department: 'HEMATOLOGY',
        sampleType: 'EDTA_BLOOD',
        referenceRange: 'Hb: 13.0-17.0 g/dL, WBC: 4.0-11.0 x10^3/uL',
        unit: 'Panel',
        priceMinor: BigInt(45000),
        turnaroundHours: 2,
      },
    });

    await diagDb.bloodUnit.upsert({
      where: { bagNumber: 'BB-2026-OPOS-001' },
      update: {},
      create: {
        hospitalId: hospital.id,
        bagNumber: 'BB-2026-OPOS-001',
        bloodGroup: 'O+',
        componentType: 'PRBC',
        volumeMl: 350,
        collectionDate: new Date('2026-11-01T00:00:00.000Z'),
        expiryDate: new Date('2026-12-12T00:00:00.000Z'),
        status: 'AVAILABLE',
      },
    });

    // =========================================================================
    // 5. OPERATIONS & BILLING SCHEMA: Ambulances, Medical Assets, Daily Snapshot
    // =========================================================================
    await opsDb.ambulance.upsert({
      where: { vehicleNumber: 'MH-01-AB-1081' },
      update: {},
      create: {
        hospitalId: hospital.id,
        vehicleNumber: 'MH-01-AB-1081',
        ambulanceType: 'ALS_CARDIAC',
        driverName: 'Ramesh Pawar',
        driverPhone: '+91-9000000108',
        paramedicName: 'nikhil K.',
        status: 'AVAILABLE',
      },
    });

    await opsDb.medicalAsset.upsert({
      where: { assetTag: 'AST-VENT-001' },
      update: {},
      create: {
        hospitalId: hospital.id,
        assetTag: 'AST-VENT-001',
        equipmentName: 'Drager Evita V800 ICU Ventilator',
        category: 'VENTILATOR',
        departmentRefCode: 'DEPT-ICU',
        serialNumber: 'SN-DRG-2026-9901',
        status: 'OPERATIONAL',
        nextCalibrationDate: new Date('2027-05-01T00:00:00.000Z'),
      },
    });

    // Genesis Compliance Audit Log
    const genesisPayload = JSON.stringify({ event: 'SYSTEM_SEED_INITIALIZED', hospitalId: hospital.id });
    await identityDb.auditLog.upsert({
      where: { integrityHash: sha256(`GENESIS|${genesisPayload}`) },
      update: {},
      create: {
        hospitalId: hospital.id,
        actorUserId: 'usr-super-admin',
        actorRole: 'SUPER_ADMIN',
        serviceName: 'identity-service',
        action: 'SYSTEM_SEED_INITIALIZED',
        resourceType: 'Hospital',
        resourceId: hospital.id,
        correlationId: 'seed-corr-0001',
        previousHash: 'GENESIS',
        integrityHash: sha256(`GENESIS|${genesisPayload}`),
      },
    });

    console.log('[Seed] Successfully seeded all 5 isolated PostgreSQL schemas with synthetic hospital data.');
  } finally {
    await identityDb.$disconnect();
    await coreDb.$disconnect();
    await clinicalDb.$disconnect();
    await diagDb.$disconnect();
    await opsDb.$disconnect();
  }
}

if (require.main === module) {
  runHospitalSeed().catch((err) => {
    console.error('[Seed] Failed:', err);
    process.exit(1);
  });
}

