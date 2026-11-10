import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  Public,
  RbacPermissionsGuard,
  RequirePermissions,
} from '../../../packages/shared/src/auth/guards';
import { DiagnosticsPharmacyService } from './diagnostics-pharmacy.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class DiagnosticsPharmacyController {
  constructor(@Inject(DiagnosticsPharmacyService) private readonly diagService: DiagnosticsPharmacyService) {}

  @Public()
  @Get('health/live')
  liveness() {
    return {
      status: 'UP',
      service: 'diagnostics-pharmacy-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    await this.diagService.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'READY',
      service: 'diagnostics-pharmacy-service',
      databaseSchema: 'diagnostics_pharmacy',
      timestamp: new Date().toISOString(),
    };
  }

  @RequirePermissions('lab:order:write')
  @Post('lab/orders')
  async createLabOrder(
    @Req() req: any,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.diagService.createLabOrder(
      {
        ...dto,
        hospitalId: dto.hospitalId || req.user.hospitalId,
        orderingDoctorId: dto.orderingDoctorId || req.user.sub,
      },
      correlationId,
    );
  }

  @Get('lab/orders')
  async listLabOrders(@Req() req: any) {
    return this.diagService.prisma.labOrder.findMany({
      where: { hospitalId: req.user.hospitalId },
      include: { results: true },
      orderBy: { orderedAt: 'desc' },
    });
  }

  @RequirePermissions('lab:specimen:collect')
  @Patch('lab/orders/:id/collect-sample')
  async collectSample(@Param('id') id: string) {
    return this.diagService.collectLabSpecimen(id);
  }

  @RequirePermissions('lab:result:write')
  @Post('lab/orders/:id/results')
  async submitLabResult(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.diagService.submitAndVerifyLabResult(
      id,
      { ...dto, enteredByTechId: dto.enteredByTechId || req.user.sub },
      correlationId,
    );
  }

  @Get('pharmacy/orders')
  async listPharmacyOrders(@Req() req: any) {
    return this.diagService.prisma.pharmacyDispenseOrder.findMany({
      where: { hospitalId: req.user.hospitalId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('pharmacy/orders')
  async createPharmacyOrder(@Req() req: any, @Body() dto: any) {
    return this.diagService.createDispenseOrderFromPrescription({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
    });
  }

  @RequirePermissions('pharmacy:order:dispense')
  @Post('pharmacy/orders/:id/dispense')
  async dispenseOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.diagService.dispenseMedicationOrderFefo(id, req.user.sub, correlationId);
  }

  @Get('inventory/batches')
  async listInventoryBatches(@Req() req: any) {
    return this.diagService.prisma.inventoryBatch.findMany({
      where: { hospitalId: req.user.hospitalId },
      include: { medication: true },
      orderBy: { expiryDate: 'asc' },
    });
  }

  @RequirePermissions('radiology:order:write')
  @Post('radiology/orders')
  async createRadiologyOrder(
    @Req() req: any,
    @Body() dto: any,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.diagService.createRadiologyOrder(
      {
        ...dto,
        hospitalId: dto.hospitalId || req.user.hospitalId,
        orderingDoctorId: dto.orderingDoctorId || req.user.sub,
      },
      correlationId,
    );
  }

  @Get('radiology/orders')
  async listRadiologyOrders(@Req() req: any) {
    return this.diagService.prisma.radiologyOrder.findMany({
      where: { hospitalId: req.user.hospitalId },
      include: { report: true, dicomStudy: true },
      orderBy: { orderedAt: 'desc' },
    });
  }

  @Get('blood-bank/units')
  async listBloodUnits(@Req() req: any) {
    return this.diagService.prisma.bloodUnit.findMany({
      where: { hospitalId: req.user.hospitalId },
      orderBy: { expiryDate: 'asc' },
    });
  }
}
