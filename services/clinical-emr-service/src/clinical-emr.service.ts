import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient as ClinicalPrismaClient } from '../../../node_modules/.prisma/clinical-client';

@Injectable()
export class ClinicalEmrService implements OnModuleDestroy {
  public readonly prisma: ClinicalPrismaClient;

  constructor(prismaClient?: ClinicalPrismaClient) {
    this.prisma = prismaClient ?? new ClinicalPrismaClient();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // ===========================================================================
  // 1. Encounter Service (Service 10)
  // ===========================================================================
  async createEncounter(
    dto: {
      hospitalId: string;
      patientRefId: string;
      patientMrn: string;
      doctorRefId: string;
      departmentRefId: string;
      appointmentRefId?: string;
      encounterType: 'OPD' | 'IPD' | 'EMERGENCY' | 'ICU';
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const count = await this.prisma.encounter.count({ where: { hospitalId: dto.hospitalId } });
    const encounterNumber = `ENC-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const encounter = await tx.encounter.create({
        data: {
          hospitalId: dto.hospitalId,
          encounterNumber,
          patientRefId: dto.patientRefId,
          patientMrn: dto.patientMrn,
          doctorRefId: dto.doctorRefId,
          departmentRefId: dto.departmentRefId,
          appointmentRefId: dto.appointmentRefId ?? null,
          encounterType: dto.encounterType,
          status: 'IN_PROGRESS',
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.encounter.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientRefId,
          payload: {
            encounterId: encounter.id,
            encounterNumber: encounter.encounterNumber,
            patientId: dto.patientRefId,
            doctorId: dto.doctorRefId,
            departmentId: dto.departmentRefId,
            appointmentId: dto.appointmentRefId ?? null,
            encounterType: dto.encounterType,
          },
        },
      });

      return encounter;
    });
  }

  // ===========================================================================
  // 2. Clinical / EMR Service (Service 11) — Immutable Signed Notes & Addendums
  // ===========================================================================
  async createClinicalNoteDraft(dto: {
    hospitalId: string;
    encounterId: string;
    patientRefId: string;
    authorDoctorId: string;
    chiefComplaint: string;
    historyOfPresentIllness: string;
    physicalExamFindings?: string;
    assessmentAndPlan: string;
  }) {
    return this.prisma.clinicalNote.create({
      data: {
        hospitalId: dto.hospitalId,
        encounterId: dto.encounterId,
        patientRefId: dto.patientRefId,
        authorDoctorId: dto.authorDoctorId,
        chiefComplaint: dto.chiefComplaint,
        historyOfPresentIllness: dto.historyOfPresentIllness,
        physicalExamFindings: dto.physicalExamFindings,
        assessmentAndPlan: dto.assessmentAndPlan,
        status: 'DRAFT',
        isImmutable: false,
      },
    });
  }

  async signClinicalNote(noteId: string, signingDoctorId: string, correlationId = `corr-${randomUUID()}`) {
    const note = await this.prisma.clinicalNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('CLINICAL_NOTE_NOT_FOUND');
    if (note.isImmutable || note.status === 'SIGNED') {
      throw new ConflictException('CLINICAL_NOTE_ALREADY_SIGNED_AND_IMMUTABLE');
    }

    const contentHash = this.sha256(
      JSON.stringify({
        id: note.id,
        encounterId: note.encounterId,
        chiefComplaint: note.chiefComplaint,
        historyOfPresentIllness: note.historyOfPresentIllness,
        assessmentAndPlan: note.assessmentAndPlan,
        signedBy: signingDoctorId,
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const signed = await tx.clinicalNote.update({
        where: { id: noteId },
        data: {
          status: 'SIGNED',
          isImmutable: true,
          contentHash,
          signedAt: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.clinical.note.signed',
          correlationId,
          hospitalId: note.hospitalId,
          partitionKey: note.patientRefId,
          payload: {
            clinicalNoteId: signed.id,
            encounterId: signed.encounterId,
            patientId: signed.patientRefId,
            contentHash,
          },
        },
      });

      return signed;
    });
  }

  async addClinicalNoteAddendum(dto: {
    clinicalNoteId: string;
    authorUserId: string;
    reason: string;
    addendumText: string;
  }) {
    const note = await this.prisma.clinicalNote.findUnique({ where: { id: dto.clinicalNoteId } });
    if (!note) throw new NotFoundException('CLINICAL_NOTE_NOT_FOUND');
    if (!note.isImmutable) {
      throw new BadRequestException('ADDENDUM_ONLY_REQUIRED_FOR_SIGNED_NOTES');
    }

    const contentHash = this.sha256(
      `${note.contentHash}|${dto.authorUserId}|${dto.reason}|${dto.addendumText}`,
    );

    return this.prisma.clinicalNoteAddendum.create({
      data: {
        clinicalNoteId: dto.clinicalNoteId,
        authorUserId: dto.authorUserId,
        reason: dto.reason,
        addendumText: dto.addendumText,
        contentHash,
      },
    });
  }

  async recordVitalSigns(dto: {
    encounterId: string;
    patientRefId: string;
    recordedByUserId: string;
    recordedByRole: string;
    systolicBpMmHg?: number;
    diastolicBpMmHg?: number;
    heartRateBpm?: number;
    respiratoryRateRpm?: number;
    temperatureCelsius?: number;
    spo2Percent?: number;
    weightKg?: number;
    heightCm?: number;
    bloodGlucoseMgDl?: number;
  }) {
    return this.prisma.vitalSignRecord.create({ data: dto });
  }

  // ===========================================================================
  // 3. Prescription Service (Service 12) + Nursing/Compounder Task Fan-out
  // ===========================================================================
  async createAndSignPrescription(
    dto: {
      hospitalId: string;
      encounterId: string;
      patientRefId: string;
      doctorRefId: string;
      notes?: string;
      items: Array<{
        medicationCode: string;
        medicationName: string;
        dosageStrength: string;
        route: string;
        frequency: string;
        durationDays: number;
        quantityPrescribed: number;
        instructions?: string;
        requiresCompounder?: boolean;
      }>;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('PRESCRIPTION_REQUIRES_AT_LEAST_ONE_ITEM');
    }
    const count = await this.prisma.prescription.count({ where: { hospitalId: dto.hospitalId } });
    const prescriptionNumber = `RX-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const rx = await tx.prescription.create({
        data: {
          hospitalId: dto.hospitalId,
          prescriptionNumber,
          encounterId: dto.encounterId,
          patientRefId: dto.patientRefId,
          doctorRefId: dto.doctorRefId,
          status: 'SIGNED',
          notes: dto.notes,
          isImmutable: true,
          items: {
            create: dto.items.map((item) => ({
              medicationCode: item.medicationCode,
              medicationName: item.medicationName,
              dosageStrength: item.dosageStrength,
              route: item.route,
              frequency: item.frequency,
              durationDays: item.durationDays,
              quantityPrescribed: item.quantityPrescribed,
              instructions: item.instructions,
              requiresCompounder: item.requiresCompounder ?? false,
            })),
          },
        },
        include: { items: true },
      });

      // Automatically queue Compounder tasks for items requiring injection/dressing (Service 14)
      for (const item of rx.items) {
        if (item.requiresCompounder || item.route === 'IM' || item.route === 'IV') {
          await tx.compounderTask.create({
            data: {
              hospitalId: dto.hospitalId,
              patientRefId: dto.patientRefId,
              prescriptionRefId: rx.id,
              procedureType: item.route === 'IM' || item.route === 'IV' ? 'INJECTION' : 'WOUND_DRESSING',
              instructions: `${item.medicationName} ${item.dosageStrength} (${item.route}) - ${item.frequency}`,
              status: 'QUEUED',
            },
          });
        }
      }

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.prescription.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientRefId,
          payload: {
            prescriptionId: rx.id,
            prescriptionNumber: rx.prescriptionNumber,
            encounterId: rx.encounterId,
            patientId: rx.patientRefId,
            doctorId: rx.doctorRefId,
            items: rx.items.map((i) => ({
              medicationCode: i.medicationCode,
              medicationName: i.medicationName,
              quantityPrescribed: i.quantityPrescribed,
            })),
          },
        },
      });

      return rx;
    });
  }

  // ===========================================================================
  // 4. Bed Management (Service 16) & IPD Admissions/Rounds/Discharge (Service 15)
  // ===========================================================================
  async listBeds(hospitalId: string, wardId?: string, status?: string) {
    return this.prisma.bed.findMany({
      where: {
        hospitalId,
        ...(wardId ? { wardId } : {}),
        ...(status ? { status } : {}),
      },
      include: { ward: true },
      orderBy: { bedNumber: 'asc' },
    });
  }

  async admitInpatientAndAllocateBed(
    dto: {
      hospitalId: string;
      encounterId: string;
      patientRefId: string;
      attendingDoctorId: string;
      wardId: string;
      bedId: string;
      admissionReason: string;
      allocatedByUserId: string;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const bed = await this.prisma.bed.findUnique({
      where: { id: dto.bedId },
      include: { ward: true },
    });
    if (!bed) throw new NotFoundException('BED_NOT_FOUND');
    if (bed.status !== 'AVAILABLE') {
      throw new ConflictException(`BED_NOT_AVAILABLE_CURRENT_STATUS_${bed.status}`);
    }

    const count = await this.prisma.admission.count({ where: { hospitalId: dto.hospitalId } });
    const admissionNumber = `IPD-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const admission = await tx.admission.create({
        data: {
          hospitalId: dto.hospitalId,
          admissionNumber,
          encounterId: dto.encounterId,
          patientRefId: dto.patientRefId,
          attendingDoctorId: dto.attendingDoctorId,
          wardId: dto.wardId,
          bedId: dto.bedId,
          admissionReason: dto.admissionReason,
          status: 'ADMITTED',
        },
      });

      await tx.bed.update({
        where: { id: dto.bedId },
        data: {
          status: 'OCCUPIED',
          currentPatientId: dto.patientRefId,
          currentAdmissionId: admission.id,
        },
      });

      await tx.bedAllocationHistory.create({
        data: {
          bedId: dto.bedId,
          admissionId: admission.id,
          patientRefId: dto.patientRefId,
          allocatedBy: dto.allocatedByUserId,
        },
      });

      // Schedule initial Nursing Assessment Task (Service 13)
      await tx.nursingTask.create({
        data: {
          hospitalId: dto.hospitalId,
          admissionId: admission.id,
          patientRefId: dto.patientRefId,
          taskType: 'VITAL_CHECK',
          description: `Initial IPD admission vitals & nursing assessment for Bed ${bed.bedNumber}`,
          dueAt: new Date(Date.now() + 30 * 60 * 1000),
          status: 'PENDING',
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.bed.allocated',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.bedId,
          payload: {
            admissionId: admission.id,
            admissionNumber: admission.admissionNumber,
            bedId: bed.id,
            bedNumber: bed.bedNumber,
            wardId: bed.wardId,
            dailyTariffMinor: bed.ward.dailyTariffMinor.toString(),
            patientId: dto.patientRefId,
            encounterId: dto.encounterId,
          },
        },
      });

      return admission;
    });
  }

  async recordMedicationAdministration(dto: {
    admissionId: string;
    prescriptionRefId: string;
    patientRefId: string;
    medicationName: string;
    doseAdministered: string;
    route: string;
    administeredById: string;
    patientResponse?: string;
  }) {
    return this.prisma.medicationAdministrationRecord.create({ data: dto });
  }

  async dischargeInpatient(
    admissionId: string,
    dto: {
      authorDoctorId: string;
      courseInHospital: string;
      conditionAtDischarge: string;
      dischargeMedications: string;
      followUpInstructions: string;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundException('ADMISSION_NOT_FOUND');
    if (admission.status === 'DISCHARGED') {
      throw new ConflictException('PATIENT_ALREADY_DISCHARGED');
    }

    const bed = await this.prisma.bed.findUnique({ where: { id: admission.bedId } });

    return this.prisma.$transaction(async (tx) => {
      const summary = await tx.dischargeSummary.create({
        data: {
          admissionId,
          patientRefId: admission.patientRefId,
          authorDoctorId: dto.authorDoctorId,
          courseInHospital: dto.courseInHospital,
          conditionAtDischarge: dto.conditionAtDischarge,
          dischargeMedications: dto.dischargeMedications,
          followUpInstructions: dto.followUpInstructions,
        },
      });

      const updatedAdmission = await tx.admission.update({
        where: { id: admissionId },
        data: {
          status: 'DISCHARGED',
          dischargedAt: new Date(),
        },
      });

      // Transition Bed to CLEANING for Housekeeping turnaround
      await tx.bed.update({
        where: { id: admission.bedId },
        data: {
          status: 'CLEANING',
          currentPatientId: null,
          currentAdmissionId: null,
        },
      });

      await tx.bedAllocationHistory.updateMany({
        where: { admissionId, releasedAt: null },
        data: { releasedAt: new Date() },
      });

      await tx.encounter.update({
        where: { id: admission.encounterId },
        data: {
          status: 'COMPLETED',
          endedAt: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.patient.discharged',
          correlationId,
          hospitalId: admission.hospitalId,
          partitionKey: admission.patientRefId,
          payload: {
            admissionId: admission.id,
            admissionNumber: admission.admissionNumber,
            patientId: admission.patientRefId,
            bedId: admission.bedId,
            bedNumber: bed?.bedNumber ?? 'UNKNOWN',
            wardId: admission.wardId,
            dischargeSummaryId: summary.id,
          },
        },
      });

      return { admission: updatedAdmission, summary };
    });
  }

  // ===========================================================================
  // 5. Emergency Triage (Service 17), OT Schedule (Service 18), ICU Flowsheet (Service 19)
  // ===========================================================================
  async registerEmergencyCase(dto: {
    hospitalId: string;
    patientRefId?: string;
    unknownPatientAlias?: string;
    triageCategory: 'RED_IMMEDIATE' | 'YELLOW_URGENT' | 'GREEN_NON_URGENT' | 'BLACK_DECEASED';
    chiefComplaint: string;
    traumaBayNumber?: string;
    attendingDoctorId?: string;
  }) {
    const count = await this.prisma.emergencyCase.count({ where: { hospitalId: dto.hospitalId } });
    const erNumber = `ER-2026-${String(count + 1).padStart(5, '0')}`;
    return this.prisma.emergencyCase.create({
      data: {
        hospitalId: dto.hospitalId,
        erNumber,
        patientRefId: dto.patientRefId,
        unknownPatientAlias: dto.unknownPatientAlias,
        triageCategory: dto.triageCategory,
        chiefComplaint: dto.chiefComplaint,
        traumaBayNumber: dto.traumaBayNumber,
        attendingDoctorId: dto.attendingDoctorId,
      },
    });
  }

  async scheduleOtSurgery(dto: {
    hospitalId: string;
    otRoomCode: string;
    patientRefId: string;
    admissionRefId?: string;
    leadSurgeonId: string;
    anesthetistId: string;
    procedureName: string;
    scheduledStart: string;
    scheduledEnd: string;
  }) {
    return this.prisma.surgerySchedule.create({
      data: {
        hospitalId: dto.hospitalId,
        otRoomCode: dto.otRoomCode,
        patientRefId: dto.patientRefId,
        admissionRefId: dto.admissionRefId,
        leadSurgeonId: dto.leadSurgeonId,
        anesthetistId: dto.anesthetistId,
        procedureName: dto.procedureName,
        scheduledStart: new Date(dto.scheduledStart),
        scheduledEnd: new Date(dto.scheduledEnd),
      },
    });
  }

  async recordIcuFlowsheet(dto: {
    hospitalId: string;
    admissionRefId: string;
    patientRefId: string;
    bedNumber: string;
    ventilatorMode?: string;
    fio2Percent?: number;
    peepCmH2O?: number;
    glasgowComaScale: number;
    urineOutputMlHr?: number;
    recordedByNurseId: string;
  }) {
    return this.prisma.icuFlowsheetRecord.create({ data: dto });
  }
}

