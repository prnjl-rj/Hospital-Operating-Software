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
import { OperationsBillingService } from './operations-billing.service';
import { DocumentS3Service } from './document-s3.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class OperationsBillingController {
  constructor(
    @Inject(OperationsBillingService) private readonly opsService: OperationsBillingService,
    @Inject(DocumentS3Service) private readonly documentS3Service: DocumentS3Service,
  ) {}

  @Public()
  @Get('health/live')
  liveness() {
    return {
      status: 'UP',
      service: 'operations-billing-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    await this.opsService.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'READY',
      service: 'operations-billing-service',
      databaseSchema: 'operations_billing',
      timestamp: new Date().toISOString(),
    };
  }

  @RequirePermissions('billing:invoice:write')
  @Post('billing/invoices/charge')
  async appendInvoiceCharge(@Req() req: any, @Body() dto: any) {
    return this.opsService.createOrAppendInvoiceCharge({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
    });
  }

  @Get('billing/invoices')
  async listInvoices(@Req() req: any) {
    return this.opsService.prisma.invoice.findMany({
      where: { hospitalId: req.user.hospitalId },
      include: { lineItems: true, payments: true, insuranceClaims: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @RequirePermissions('billing:invoice:finalize')
  @Post('billing/invoices/:id/finalize')
  async finalizeInvoice(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.opsService.finalizeInvoice(id, req.user.sub, correlationId);
  }

  @RequirePermissions('payment:collect')
  @Post('payments')
  async collectPayment(
    @Req() req: any,
    @Body() dto: any,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.opsService.processPaymentIdempotent(
      {
        ...dto,
        hospitalId: dto.hospitalId || req.user.hospitalId,
        idempotencyKey: dto.idempotencyKey || idempotencyKeyHeader,
        collectedByUserId: req.user.sub,
      },
      correlationId,
    );
  }

  @RequirePermissions('insurance:claim:manage')
  @Post('insurance/claims')
  async submitClaim(@Req() req: any, @Body() dto: any) {
    return this.opsService.submitInsuranceClaim({
      ...dto,
      hospitalId: dto.hospitalId || req.user.hospitalId,
    });
  }

  @Get('ambulances')
  async listAmbulances(@Req() req: any) {
    return this.opsService.prisma.ambulance.findMany({
      where: { hospitalId: req.user.hospitalId },
    });
  }

  @Get('assets')
  async listAssets(@Req() req: any) {
    return this.opsService.prisma.medicalAsset.findMany({
      where: { hospitalId: req.user.hospitalId },
    });
  }

  @Get('facility/housekeeping')
  async listHousekeeping(@Req() req: any) {
    return this.opsService.prisma.housekeepingTask.findMany({
      where: { hospitalId: req.user.hospitalId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('facility/housekeeping/:id/complete')
  async completeHousekeeping(
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.opsService.completeHousekeepingTask(id, correlationId);
  }

  @Get('notifications')
  async listNotifications(@Req() req: any) {
    return this.opsService.prisma.notificationRecord.findMany({
      where: { hospitalId: req.user.hospitalId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @RequirePermissions('analytics:read')
  @Get('analytics/kpis')
  async getKpis(@Req() req: any) {
    return this.opsService.getExecutiveKpis(req.user.hospitalId);
  }

  @Post('documents/presign-upload')
  async presignDocumentUpload(@Req() req: any, @Body() dto: any) {
    return this.documentS3Service.createPresignedUpload({
      hospitalId: dto.hospitalId || req.user.hospitalId,
      patientRefId: dto.patientRefId || dto.patientId,
      encounterRefId: dto.encounterRefId,
      documentCategory: dto.documentCategory || dto.documentType || 'CONSENT_FORM',
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: Number(dto.fileSizeBytes || dto.sizeBytes || 0),
      contentSampleForChecksum: dto.contentSampleForChecksum,
      uploadedByUserId: req.user.sub,
    });
  }

  @Get('documents/:id/presign-download')
  async presignDocumentDownload(@Req() req: any, @Param('id') id: string) {
    return this.documentS3Service.createPresignedDownload({
      documentId: id,
      requesterHospitalId: req.user.hospitalId,
      requesterUserId: req.user.sub,
      requesterRoles: req.user.roles || [req.user.role],
    });
  }

  @Get('documents/patient/:patientId')
  async listPatientDocuments(@Req() req: any, @Param('patientId') patientId: string) {
    return this.documentS3Service.listPatientDocuments(req.user.hospitalId, patientId);
  }
}
