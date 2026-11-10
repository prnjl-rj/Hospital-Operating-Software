import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient as HospitalCorePrismaClient } from '../../../node_modules/.prisma/hospital-core-client';

export interface RegisterPatientDto {
  hospitalId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup?: string;
  phone: string;
  email?: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  abhaHealthId?: string;
}

export interface CreateAppointmentDto {
  hospitalId: string;
  patientId: string;
  doctorId: string;
  departmentId: string;
  scheduledStart: string;
  scheduledEnd: string;
  visitType?: string;
  reasonForVisit: string;
}

@Injectable()
export class HospitalCoreService implements OnModuleDestroy {
  public readonly prisma: HospitalCorePrismaClient;

  constructor(prismaClient?: HospitalCorePrismaClient) {
    this.prisma = prismaClient ?? new HospitalCorePrismaClient();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // ===========================================================================
  // 1. Hospital & Department Configuration (Service 4)
  // ===========================================================================
  async getHospitalTopology(hospitalId: string) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        buildings: { include: { floors: true } },
        departments: { where: { isActive: true }, orderBy: { code: 'asc' } },
      },
    });
    if (!hospital) throw new NotFoundException('HOSPITAL_NOT_FOUND');
    return hospital;
  }

  async createDepartment(dto: {
    hospitalId: string;
    code: string;
    name: string;
    specialtyCategory: string;
    isEmergencyUnit?: boolean;
  }) {
    const correlationId = `dept-${randomUUID()}`;
    return this.prisma.$transaction(async (tx) => {
      const dept = await tx.department.create({
        data: {
          hospitalId: dto.hospitalId,
          code: dto.code,
          name: dto.name,
          specialtyCategory: dto.specialtyCategory,
          isEmergencyUnit: dto.isEmergencyUnit ?? false,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.config.department.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dept.id,
          payload: { departmentId: dept.id, code: dept.code, name: dept.name },
        },
      });
      return dept;
    });
  }

  // ===========================================================================
  // 2. Employee, Workforce & Shift Rosters (Service 5) & HR/Payroll (Service 30)
  // ===========================================================================
  async createEmployee(dto: {
    hospitalId: string;
    departmentId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    designation: string;
    baseSalaryMinor: number;
  }) {
    const count = await this.prisma.employee.count({ where: { hospitalId: dto.hospitalId } });
    const employeeCode = `EMP-2026-${String(count + 1).padStart(4, '0')}`;
    const correlationId = `emp-${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          hospitalId: dto.hospitalId,
          departmentId: dto.departmentId,
          employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          designation: dto.designation,
          joiningDate: new Date(),
          baseSalaryMinor: BigInt(dto.baseSalaryMinor),
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.employee.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: emp.id,
          payload: {
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            designation: emp.designation,
            departmentId: emp.departmentId,
          },
        },
      });
      return emp;
    });
  }

  async listEmployees(hospitalId: string, page = 1, limit = 25) {
    const take = Math.min(limit, 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where: { hospitalId },
        include: { department: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.employee.count({ where: { hospitalId } }),
    ]);
    return { items, total, page, limit: take };
  }

  async runMonthlyPayroll(hospitalId: string, monthYear: string, processedById: string) {
    const employees = await this.prisma.employee.findMany({
      where: { hospitalId, status: 'ACTIVE' },
    });
    const totalPayoutMinor = employees.reduce(
      (acc, e) => acc + (e.baseSalaryMinor - e.baseSalaryMinor / BigInt(10)),
      BigInt(0),
    );
    const correlationId = `payroll-${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.upsert({
        where: { monthYear },
        update: {
          totalEmployees: employees.length,
          totalPayoutMinor,
          processedById,
          processedAt: new Date(),
        },
        create: {
          hospitalId,
          monthYear,
          totalEmployees: employees.length,
          totalPayoutMinor,
          processedById,
        },
      });

      for (const emp of employees) {
        const gross = emp.baseSalaryMinor;
        const deductions = gross / BigInt(10);
        const net = gross - deductions;
        await tx.payslip.upsert({
          where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: emp.id } },
          update: { grossSalaryMinor: gross, deductionsMinor: deductions, netSalaryMinor: net },
          create: {
            payrollRunId: run.id,
            employeeId: emp.id,
            grossSalaryMinor: gross,
            deductionsMinor: deductions,
            netSalaryMinor: net,
          },
        });
      }

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.hr.payroll.completed',
          correlationId,
          hospitalId,
          partitionKey: run.id,
          payload: {
            payrollRunId: run.id,
            monthYear,
            totalEmployees: employees.length,
            totalPayoutMinor: totalPayoutMinor.toString(),
          },
        },
      });

      return run;
    });
  }

  // ===========================================================================
  // 3. Doctor Management (Service 6)
  // ===========================================================================
  async listDoctors(hospitalId: string, departmentId?: string) {
    return this.prisma.doctorProfile.findMany({
      where: {
        hospitalId,
        ...(departmentId ? { departmentId } : {}),
      },
      include: { department: true, scheduleTemplates: true },
      orderBy: { fullName: 'asc' },
    });
  }

  // ===========================================================================
  // 4. Master Patient Index & Registration (Service 7)
  // ===========================================================================
  async registerPatient(dto: RegisterPatientDto, registeredByUserId: string, correlationId = `corr-${randomUUID()}`) {
    const count = await this.prisma.patient.count({ where: { hospitalId: dto.hospitalId } });
    const mrn = `HOS-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          hospitalId: dto.hospitalId,
          mrn,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          bloodGroup: dto.bloodGroup,
          phone: dto.phone,
          email: dto.email,
          addressLine: dto.addressLine,
          city: dto.city,
          state: dto.state,
          postalCode: dto.postalCode,
          isSyntheticTestRecord: true,
          registeredByUserId,
          ...(dto.emergencyContactName && dto.emergencyContactPhone
            ? {
                emergencyContacts: {
                  create: {
                    contactName: dto.emergencyContactName,
                    phone: dto.emergencyContactPhone,
                    relationship: dto.emergencyContactRelation || 'FAMILY',
                  },
                },
              }
            : {}),
          ...(dto.abhaHealthId
            ? {
                identifiers: {
                  create: {
                    identifierType: 'ABHA_HEALTH_ID',
                    identifierValue: dto.abhaHealthId,
                    verified: true,
                  },
                },
              }
            : {}),
        },
        include: { emergencyContacts: true, identifiers: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.patient.registered',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: patient.id,
          payload: {
            patientId: patient.id,
            mrn: patient.mrn,
            registeredByUserId,
          },
        },
      });

      return patient;
    });
  }

  async listPatients(hospitalId: string, search?: string, page = 1, limit = 25) {
    const take = Math.min(limit, 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = {
      hospitalId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { mrn: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        include: { emergencyContacts: true, identifiers: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.patient.count({ where }),
    ]);
    return { items, total, page, limit: take };
  }

  // ===========================================================================
  // 5. Appointment Booking & Double-Booking Prevention (Service 8) & OPD Queue (Service 9)
  // ===========================================================================
  async createAppointment(dto: CreateAppointmentDto, bookedByUserId: string, correlationId = `corr-${randomUUID()}`) {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);

    const existingConflict = await this.prisma.appointment.findUnique({
      where: {
        doctorId_scheduledStart: {
          doctorId: dto.doctorId,
          scheduledStart,
        },
      },
    });
    if (existingConflict && existingConflict.status !== 'CANCELLED') {
      throw new ConflictException('DOCTOR_SLOT_ALREADY_BOOKED');
    }

    const count = await this.prisma.appointment.count({ where: { hospitalId: dto.hospitalId } });
    const appointmentNumber = `APT-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          hospitalId: dto.hospitalId,
          appointmentNumber,
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          departmentId: dto.departmentId,
          scheduledStart,
          scheduledEnd,
          visitType: dto.visitType || 'OPD_CONSULTATION',
          reasonForVisit: dto.reasonForVisit,
          bookedByUserId,
        },
        include: { patient: true, doctor: true, department: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.appointment.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientId,
          payload: {
            appointmentId: appointment.id,
            appointmentNumber: appointment.appointmentNumber,
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            departmentId: dto.departmentId,
            consultationFeeMinor: appointment.doctor.consultationFeeMinor.toString(),
            scheduledStart: scheduledStart.toISOString(),
          },
        },
      });

      return appointment;
    });
  }

  async cancelAppointment(appointmentId: string, cancellationReason: string, correlationId = `corr-${randomUUID()}`) {
    return this.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED', cancellationReason },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.appointment.cancelled',
          correlationId,
          hospitalId: appt.hospitalId,
          partitionKey: appt.patientId,
          payload: {
            appointmentId: appt.id,
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            cancellationReason,
          },
        },
      });

      return appt;
    });
  }

  async checkInOpdAppointment(appointmentId: string, priority = 'NORMAL', correlationId = `corr-${randomUUID()}`) {
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) throw new NotFoundException('APPOINTMENT_NOT_FOUND');
    if (appt.status === 'CANCELLED') throw new BadRequestException('CANNOT_CHECK_IN_CANCELLED_APPOINTMENT');

    const queueDate = new Date(appt.scheduledStart.toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const existingTokens = await this.prisma.opdQueueToken.count({
      where: { doctorId: appt.doctorId, queueDate },
    });
    const tokenNumber = existingTokens + 1;

    return this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CHECKED_IN' },
      });

      const token = await tx.opdQueueToken.upsert({
        where: { appointmentId },
        update: { status: 'WAITING_VITALS', priority },
        create: {
          hospitalId: appt.hospitalId,
          appointmentId,
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          tokenNumber,
          queueDate,
          priority,
          status: 'WAITING_VITALS',
        },
        include: { patient: true, doctor: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.opd.token.updated',
          correlationId,
          hospitalId: appt.hospitalId,
          partitionKey: appt.patientId,
          payload: {
            opdTokenId: token.id,
            tokenNumber: token.tokenNumber,
            appointmentId,
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            status: token.status,
          },
        },
      });

      return token;
    });
  }

  async getOpdQueue(hospitalId: string, doctorId?: string) {
    return this.prisma.opdQueueToken.findMany({
      where: {
        hospitalId,
        ...(doctorId ? { doctorId } : {}),
      },
      include: { patient: true, doctor: true, appointment: true },
      orderBy: [{ queueDate: 'desc' }, { tokenNumber: 'asc' }],
    });
  }

  // ===========================================================================
  // 6. Synchronous S2S / gRPC Clinical Context Verification
  // ===========================================================================
  async verifyClinicalContext(params: {
    hospitalId: string;
    patientId: string;
    doctorId: string;
  }) {
    const [patient, doctor] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: params.patientId, hospitalId: params.hospitalId, deletedAt: null },
      }),
      this.prisma.doctorProfile.findFirst({
        where: { id: params.doctorId, hospitalId: params.hospitalId },
      }),
    ]);

    if (!patient) {
      return { valid: false, errorReason: 'PATIENT_NOT_FOUND_IN_HOSPITAL' };
    }
    if (!doctor) {
      return { valid: false, errorReason: 'DOCTOR_NOT_FOUND_IN_HOSPITAL' };
    }

    return {
      valid: true,
      patientMrn: patient.mrn,
      patientFullName: `${patient.firstName} ${patient.lastName}`,
      doctorFullName: doctor.fullName,
      departmentId: doctor.departmentId,
    };
  }
}

