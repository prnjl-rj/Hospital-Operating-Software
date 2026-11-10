import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  Public,
  RbacPermissionsGuard,
} from '../../../packages/shared/src/auth/guards';
import { globalRealtimeHub } from '../../../packages/shared/src/realtime/realtime-hub';
import { globalObservability } from '../../../packages/shared/src/observability/telemetry';
import { globalJiraTracker } from '../../../packages/shared/src/jira/jira-sync';
import { IdentityService } from '../../identity-service/src/identity.service';
import { HospitalCoreService } from '../../hospital-core-service/src/hospital-core.service';
import { ClinicalEmrService } from '../../clinical-emr-service/src/clinical-emr.service';
import { DiagnosticsPharmacyService } from '../../diagnostics-pharmacy-service/src/diagnostics-pharmacy.service';
import { OperationsBillingService } from '../../operations-billing-service/src/operations-billing.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class ApiGatewayController {
  constructor(
    @Inject(IdentityService) private readonly identityService: IdentityService,
    @Inject(HospitalCoreService) private readonly coreService: HospitalCoreService,
    @Inject(ClinicalEmrService) private readonly clinicalService: ClinicalEmrService,
    @Inject(DiagnosticsPharmacyService) private readonly diagService: DiagnosticsPharmacyService,
    @Inject(OperationsBillingService) private readonly opsService: OperationsBillingService,
  ) {}

  @Public()
  @Get('gateway/health')
  async gatewayHealth() {
    const [idOk, coreOk, clinOk, diagOk, opsOk] = await Promise.all([
      this.identityService.prisma.$queryRaw`SELECT 1`.then(() => 'UP').catch(() => 'DOWN'),
      this.coreService.prisma.$queryRaw`SELECT 1`.then(() => 'UP').catch(() => 'DOWN'),
      this.clinicalService.prisma.$queryRaw`SELECT 1`.then(() => 'UP').catch(() => 'DOWN'),
      this.diagService.prisma.$queryRaw`SELECT 1`.then(() => 'UP').catch(() => 'DOWN'),
      this.opsService.prisma.$queryRaw`SELECT 1`.then(() => 'UP').catch(() => 'DOWN'),
    ]);

    return {
      status: [idOk, coreOk, clinOk, diagOk, opsOk].every((s) => s === 'UP') ? 'HEALTHY' : 'DEGRADED',
      gateway: 'api-gateway-bff',
      schemas: {
        identity: idOk,
        hospital_core: coreOk,
        clinical: clinOk,
        diagnostics_pharmacy: diagOk,
        operations_billing: opsOk,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Unified Role-Tailored BFF Dashboard Aggregation across all 5 isolated service domains
  @Get('dashboard/overview')
  async getDashboardOverview(@Req() req: any) {
    const hospitalId = req.user.hospitalId;

    const [
      hospital,
      patientsCount,
      doctors,
      opdQueue,
      beds,
      admissions,
      nursingTasks,
      compounderTasks,
      labOrders,
      radiologyOrders,
      pharmacyOrders,
      inventoryBatches,
      bloodUnits,
      invoices,
      kpis,
      auditLogs,
    ] = await Promise.all([
      this.coreService.getHospitalTopology(hospitalId),
      this.coreService.prisma.patient.count({ where: { hospitalId } }),
      this.coreService.listDoctors(hospitalId),
      this.coreService.getOpdQueue(hospitalId),
      this.clinicalService.listBeds(hospitalId),
      this.clinicalService.prisma.admission.findMany({
        where: { hospitalId },
        orderBy: { admittedAt: 'desc' },
        take: 20,
      }),
      this.clinicalService.prisma.nursingTask.findMany({
        where: { hospitalId },
        orderBy: { dueAt: 'asc' },
        take: 20,
      }),
      this.clinicalService.prisma.compounderTask.findMany({
        where: { hospitalId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.diagService.prisma.labOrder.findMany({
        where: { hospitalId },
        include: { results: true },
        orderBy: { orderedAt: 'desc' },
        take: 20,
      }),
      this.diagService.prisma.radiologyOrder.findMany({
        where: { hospitalId },
        include: { dicomStudy: true, report: true },
        orderBy: { orderedAt: 'desc' },
        take: 20,
      }),
      this.diagService.prisma.pharmacyDispenseOrder.findMany({
        where: { hospitalId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.diagService.prisma.inventoryBatch.findMany({
        where: { hospitalId },
        include: { medication: true },
        orderBy: { expiryDate: 'asc' },
      }),
      this.diagService.prisma.bloodUnit.findMany({ where: { hospitalId } }),
      this.opsService.prisma.invoice.findMany({
        where: { hospitalId },
        include: { lineItems: true, payments: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.opsService.getExecutiveKpis(hospitalId),
      this.identityService.prisma.auditLog.findMany({
        where: { hospitalId },
        orderBy: { occurredAt: 'desc' },
        take: 15,
      }),
    ]);

    return {
      user: req.user,
      hospital,
      metrics: {
        patientsCount,
        doctorsCount: doctors.length,
        opdQueueCount: opdQueue.length,
        totalBeds: beds.length,
        occupiedBeds: beds.filter((b) => b.status === 'OCCUPIED').length,
        availableBeds: beds.filter((b) => b.status === 'AVAILABLE').length,
        cleaningBeds: beds.filter((b) => b.status === 'CLEANING').length,
        activeAdmissions: admissions.filter((a) => a.status === 'ADMITTED').length,
        pendingLabOrders: labOrders.filter((l) => l.status !== 'RESULT_READY').length,
        pendingPharmacyOrders: pharmacyOrders.filter((p) => p.status === 'PENDING_DISPENSE').length,
        ...kpis,
      },
      doctors,
      opdQueue,
      beds,
      admissions,
      nursingTasks,
      compounderTasks,
      labOrders,
      radiologyOrders,
      pharmacyOrders,
      inventoryBatches,
      bloodUnits,
      invoices,
      auditLogs,
    };
  }

  @Get('realtime/recent')
  async getRecentRealtimeEvents(@Req() req: any) {
    return {
      hospitalId: req.user.hospitalId,
      role: req.user.role,
      events: globalRealtimeHub.getRecentEvents(req.user.hospitalId, req.user.role, 30),
    };
  }

  @Post('realtime/publish')
  async publishRealtimeEvent(@Req() req: any, @Body() dto: any) {
    return globalRealtimeHub.publish({
      eventId: dto.eventId || `rt-${Date.now()}`,
      channel: dto.channel || 'ADMIN_SYSTEM_NOTIFICATION',
      hospitalId: dto.hospitalId || req.user.hospitalId,
      departmentId: dto.departmentId,
      targetRoles: dto.targetRoles,
      severity: dto.severity || 'INFO',
      correlationId: dto.correlationId,
      payload: dto.payload || {},
    });
  }

  @Get('realtime/stream')
  async streamRealtimeEvents(@Req() req: any, @Res() res: any) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const initial = {
      type: 'CONNECTED',
      hospitalId: req.user.hospitalId,
      role: req.user.role,
      connectedAt: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    const unsubscribe = globalRealtimeHub.subscribeForUser(
      { hospitalId: req.user.hospitalId, role: req.user.role },
      (event) => {
        res.write(`event: ${event.channel}\ndata: ${JSON.stringify(event)}\n\n`);
      },
    );

    req.on?.('close', () => {
      unsubscribe();
    });
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async prometheusMetrics() {
    const [corePending, clinPending, diagPending, opsPending] = await Promise.all([
      this.coreService.prisma.outboxEvent.count({ where: { status: 'PENDING' } }).catch(() => 0),
      this.clinicalService.prisma.outboxEvent.count({ where: { status: 'PENDING' } }).catch(() => 0),
      this.diagService.prisma.outboxEvent.count({ where: { status: 'PENDING' } }).catch(() => 0),
      this.opsService.prisma.outboxEvent.count({ where: { status: 'PENDING' } }).catch(() => 0),
    ]);

    globalObservability.outboxPendingEventsGauge.set({ schema: 'hospital_core' }, corePending);
    globalObservability.outboxPendingEventsGauge.set({ schema: 'clinical' }, clinPending);
    globalObservability.outboxPendingEventsGauge.set({ schema: 'diagnostics_pharmacy' }, diagPending);
    globalObservability.outboxPendingEventsGauge.set({ schema: 'operations_billing' }, opsPending);

    return globalObservability.registry.metrics();
  }

  @Get('jira/dashboard')
  async getJiraDashboard() {
    return globalJiraTracker.getDashboardSummary();
  }

  @Post('jira/sync')
  async syncJiraProject() {
    return globalJiraTracker.syncAndExportManifest();
  }
}
