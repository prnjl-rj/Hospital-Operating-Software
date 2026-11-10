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
  InternalS2S,
  JwtAuthGuard,
  Public,
  RbacPermissionsGuard,
  RequirePermissions,
} from '../../../packages/shared/src/auth/guards';
import {
  CreateAppointmentDto,
  HospitalCoreService,
  RegisterPatientDto,
} from './hospital-core.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class HospitalCoreController {
  constructor(@Inject(HospitalCoreService) private readonly coreService: HospitalCoreService) {}

  @Public()
  @Get('health/live')
  liveness() {
    return { status: 'UP', service: 'hospital-core-service', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    await this.coreService.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'READY',
      service: 'hospital-core-service',
      databaseSchema: 'hospital_core',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('hospitals/:hospitalId/topology')
  async getTopology(@Param('hospitalId') hospitalId: string) {
    return this.coreService.getHospitalTopology(hospitalId);
  }

  @RequirePermissions('department:manage')
  @Post('departments')
  async createDepartment(@Body() dto: any) {
    return this.coreService.createDepartment(dto);
  }

  @RequirePermissions('employee:manage')
  @Post('employees')
  async createEmployee(@Body() dto: any) {
    return this.coreService.createEmployee(dto);
  }

  @Get('employees')
  async listEmployees(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
  ) {
    return this.coreService.listEmployees(req.user.hospitalId, Number(page), Number(limit));
  }

  @RequirePermissions('hr:payroll:run')
  @Post('hr/payroll/run')
  async runPayroll(@Req() req: any, @Body() body: { monthYear: string }) {
    return this.coreService.runMonthlyPayroll(req.user.hospitalId, body.monthYear, req.user.sub);
  }

  @Get('doctors')
  async listDoctors(@Req() req: any, @Query('departmentId') departmentId?: string) {
    return this.coreService.listDoctors(req.user.hospitalId, departmentId);
  }

  @RequirePermissions('patient:write')
  @Post('patients')
  async registerPatient(
    @Req() req: any,
    @Body() dto: RegisterPatientDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.coreService.registerPatient(
      { ...dto, hospitalId: dto.hospitalId || req.user.hospitalId },
      req.user.sub,
      correlationId,
    );
  }

  @RequirePermissions('patient:read')
  @Get('patients')
  async listPatients(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
  ) {
    return this.coreService.listPatients(req.user.hospitalId, search, Number(page), Number(limit));
  }

  @RequirePermissions('appointment:manage')
  @Post('appointments')
  async createAppointment(
    @Req() req: any,
    @Body() dto: CreateAppointmentDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.coreService.createAppointment(
      { ...dto, hospitalId: dto.hospitalId || req.user.hospitalId },
      req.user.sub,
      correlationId,
    );
  }

  @RequirePermissions('appointment:manage')
  @Post('appointments/:id/cancel')
  async cancelAppointment(
    @Param('id') id: string,
    @Body() body: { cancellationReason: string },
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.coreService.cancelAppointment(id, body.cancellationReason, correlationId);
  }

  @RequirePermissions('opd:queue:manage')
  @Post('opd/check-in')
  async checkInOpd(
    @Body() body: { appointmentId: string; priority?: string },
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.coreService.checkInOpdAppointment(body.appointmentId, body.priority, correlationId);
  }

  @Get('opd/queue')
  async getOpdQueue(@Req() req: any, @Query('doctorId') doctorId?: string) {
    return this.coreService.getOpdQueue(req.user.hospitalId, doctorId);
  }

  @InternalS2S()
  @Post('internal/verify-clinical-context')
  async verifyClinicalContext(
    @Body() body: { hospitalId: string; patientId: string; doctorId: string },
  ) {
    return this.coreService.verifyClinicalContext(body);
  }
}
