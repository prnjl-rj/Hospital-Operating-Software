import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
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
  Roles,
} from '../../../packages/shared/src/auth/guards';
import { AssignRoleDto, IdentityService, LoginDto } from './identity.service';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RbacPermissionsGuard)
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identityService: IdentityService) {}

  @Public()
  @Get('health/live')
  liveness() {
    return { status: 'UP', service: 'identity-service', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    await this.identityService.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'READY',
      service: 'identity-service',
      databaseSchema: 'identity',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Post('auth/login')
  async login(@Body() dto: LoginDto, @Headers('x-correlation-id') correlationId?: string) {
    return this.identityService.login({ ...dto, correlationId });
  }

  @Public()
  @Post('auth/refresh')
  async refresh(
    @Body() body: { refreshToken: string },
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.identityService.refreshAccessToken(body.refreshToken, correlationId);
  }

  @Post('auth/logout')
  async logout(@Req() req: any, @Body() body: { refreshToken?: string }) {
    return this.identityService.logout(req.user.sub, req.user.sessionId, body?.refreshToken);
  }

  @Post('auth/mfa/setup')
  async setupMfa(@Req() req: any) {
    return this.identityService.initiateMfaSetup(req.user.sub);
  }

  @Post('auth/mfa/verify')
  async verifyMfa(@Req() req: any, @Body() body: { totpCode: string }) {
    return this.identityService.verifyAndEnableMfa(req.user.sub, body.totpCode);
  }

  @Public()
  @Post('auth/password/forgot')
  async forgotPassword(@Body() body: { email: string }) {
    return this.identityService.requestPasswordReset(body.email);
  }

  @Public()
  @Post('auth/password/reset')
  async resetPassword(@Body() body: { resetToken: string; newPassword: string }) {
    return this.identityService.confirmPasswordReset(body.resetToken, body.newPassword);
  }

  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Post('rbac/assign')
  async assignRole(@Req() req: any, @Body() dto: AssignRoleDto) {
    return this.identityService.assignRole(req.user.sub, dto);
  }

  @Get('rbac/roles')
  async listRoles() {
    return this.identityService.prisma.role.findMany({ orderBy: { code: 'asc' } });
  }

  @InternalS2S()
  @Post('internal/auth/evaluate')
  async evaluateS2S(
    @Body()
    body: {
      token: string;
      requiredPermission: string;
      hospitalId?: string;
      departmentId?: string;
    },
  ) {
    const user = this.identityService.validateAccessToken(body.token);
    return this.identityService.evaluateAccess(user, body.requiredPermission, {
      hospitalId: body.hospitalId,
      departmentId: body.departmentId,
    });
  }

  @RequirePermissions('audit:read')
  @Get('audit/logs')
  async getAuditLogs(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(Number(limit) || 50, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.identityService.prisma.auditLog.findMany({
        where: { hospitalId: req.user.hospitalId },
        orderBy: { occurredAt: 'desc' },
        skip,
        take,
      }),
      this.identityService.prisma.auditLog.count({
        where: { hospitalId: req.user.hospitalId },
      }),
    ]);
    return { items, total, page: Number(page) || 1, limit: take };
  }

  @RequirePermissions('audit:read')
  @Get('audit/verify-integrity/:hospitalId')
  async verifyAuditIntegrity(@Param('hospitalId') hospitalId: string) {
    return this.identityService.verifyAuditChainIntegrity(hospitalId);
  }
}
