import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  Public,
  RbacPermissionsGuard,
  RequirePermissions,
} from '../../../packages/shared/src/auth/guards';
import { ClinicalEmrService } from './clinical-emr.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class ClinicalEmrController {
  constructor(@Inject(ClinicalEmrService) private readonly clinicalService: ClinicalEmrService) {}

  @Public()
  @Get('health/live')
  liveness() {
    return { status: 'UP', service: 'clinical-emr-service', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    await this.clinicalService.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'READY',
      service: 'clinical-emr-service',
      databaseSchema: 'clinical',
      timestamp: new Date().toISOString(),
    };
  }

  @RequirePermissions('encounter:write')
  @Post('encounters')
  async createEncounter(
    @Req() req: any,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.clinicalService.createEncounter(
      { ...dto, hospitalId: dto.hospitalId || req.user.hospitalId },
      correlationId,
    );
  }

  @Get('encounters')
  async listEncounters(@Req() req: any, @Query('patientRefId') patientRefId?: string) {
    return this.clinicalService.prisma.encounter.findMany({
      where: {
        hospitalId: req.user.hospitalId,
        ...(patientRefId ? { patientRefId } : {}),
      },
      include: {
        clinicalNotes: { include: { addendums: true } },
        vitalSigns: true,
        prescriptions: { include: { items: true } },
        admission: true,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  @RequirePermissions('clinical:note:write')
  @Post('emr/notes')
  async createNoteDraft(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.createClinicalNoteDraft({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
      authorDoctorId: dto.authorDoctorId || req.user.sub,
    });
  }

  @RequirePermissions('clinical:note:sign')
  @Post('emr/notes/:id/sign')
  async signNote(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.clinicalService.signClinicalNote(id, req.user.sub, correlationId);
  }

  @RequirePermissions('clinical:note:write')
  @Post('emr/notes/:id/addendum')
  async addAddendum(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string; addendumText: string }) {
    return this.clinicalService.addClinicalNoteAddendum({
      clinicalNoteId: id,
      authorUserId: req.user.sub,
      reason: body.reason,
      addendumText: body.addendumText,
    });
  }

  @RequirePermissions('clinical:vitals:write')
  @Post('emr/vitals')
  async recordVitals(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.recordVitalSigns({
      ...dto,
      recordedByUserId: req.user.sub,
      recordedByRole: req.user.roles[0] || 'NURSE',
    });
  }

  @RequirePermissions('prescription:sign')
  @Post('prescriptions')
  async createPrescription(
    @Req() req: any,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.clinicalService.createAndSignPrescription(
      { ...dto, hospitalId: dto.hospitalId || req.user.hospitalId },
      correlationId,
    );
  }

  @Get('beds')
  async listBeds(
    @Req() req: any,
    @Query('wardId') wardId?: string,
    @Query('status') status?: string,
  ) {
    return this.clinicalService.listBeds(req.user.hospitalId, wardId, status);
  }

  @RequirePermissions('ipd:admission:write')
  @Post('ipd/admissions')
  async admitInpatient(
    @Req() req: any,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.clinicalService.admitInpatientAndAllocateBed(
      {
        ...dto,
        hospitalId: dto.hospitalId || req.user.hospitalId,
        allocatedByUserId: req.user.sub,
      },
      correlationId,
    );
  }

  @RequirePermissions('nursing:mar:write')
  @Post('nursing/mar')
  async recordMar(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.recordMedicationAdministration({
      ...dto,
      administeredById: req.user.sub,
    });
  }

  @Get('nursing/tasks')
  async listNursingTasks(@Req() req: any) {
    return this.clinicalService.prisma.nursingTask.findMany({
      where: { hospitalId: req.user.hospitalId },
      orderBy: { dueAt: 'asc' },
    });
  }

  @Get('compounder/tasks')
  async listCompounderTasks(@Req() req: any) {
    return this.clinicalService.prisma.compounderTask.findMany({
      where: { hospitalId: req.user.hospitalId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @RequirePermissions('compounder:task:manage')
  @Patch('compounder/tasks/:id/complete')
  async completeCompounderTask(@Req() req: any, @Param('id') id: string) {
    return this.clinicalService.prisma.compounderTask.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        performedByUserId: req.user.sub,
        completedAt: new Date(),
      },
    });
  }

  @RequirePermissions('ipd:discharge:sign')
  @Post('ipd/admissions/:id/discharge')
  async dischargeInpatient(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.clinicalService.dischargeInpatient(
      id,
      { ...dto, authorDoctorId: dto.authorDoctorId || req.user.sub },
      correlationId,
    );
  }

  @Post('emergency/cases')
  async createEmergencyCase(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.registerEmergencyCase({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
    });
  }

  @RequirePermissions('ot:schedule:write')
  @Post('ot/schedules')
  async scheduleSurgery(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.scheduleOtSurgery({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
    });
  }

  @RequirePermissions('icu:flowsheet:write')
  @Post('icu/flowsheets')
  async recordIcuFlowsheet(@Req() req: any, @Body() dto: any) {
    return this.clinicalService.recordIcuFlowsheet({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
      recordedByNurseId: req.user.sub,
    });
  }
}
