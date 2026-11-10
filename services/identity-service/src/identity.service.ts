import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  HospitalRoleCode,
  PrismaClient as IdentityPrismaClient,
} from '../../../node_modules/.prisma/identity-client';
import {
  HospitalRole,
  JwtUserPayload,
  computeAuditIntegrityHash,
  generateMfaSecret,
  generateTotpCode,
  hasPermission,
  hashPasswordSecure,
  resolvePermissionsForRoles,
  signJwtToken,
  verifyJwtToken,
  verifyPasswordSecure,
  verifyTotpCode,
} from '../../../packages/shared/src/auth/security.utils';

export interface LoginDto {
  emailOrUsername: string;
  password: string;
  totpCode?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface AssignRoleDto {
  targetUserId: string;
  roleCode: HospitalRole;
  hospitalId: string;
  departmentScope?: string;
  wardScope?: string;
}

@Injectable()
export class IdentityService implements OnModuleDestroy {
  public readonly prisma: IdentityPrismaClient;
  private readonly accessSecret: string;

  constructor(prismaClient?: IdentityPrismaClient) {
    this.prisma = prismaClient ?? new IdentityPrismaClient();
    this.accessSecret =
      process.env.JWT_ACCESS_SECRET || 'hos_dev_jwt_access_secret_key_2026_enterprise_safe';
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // ===========================================================================
  // 1. Append-Only Hash-Chained Audit Logger (Service 36)
  // ===========================================================================
  async appendAuditLog(params: {
    hospitalId: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    serviceName: string;
    action: string;
    resourceType: string;
    resourceId: string;
    correlationId: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  }) {
    const latest = await this.prisma.auditLog.findFirst({
      where: { hospitalId: params.hospitalId },
      orderBy: { occurredAt: 'desc' },
    });
    const previousHash = latest?.integrityHash ?? 'GENESIS';
    const nonce = randomUUID();
    const canonicalPayload = JSON.stringify({
      hospitalId: params.hospitalId,
      actorUserId: params.actorUserId ?? null,
      serviceName: params.serviceName,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      correlationId: params.correlationId,
      nonce,
    });
    const integrityHash = computeAuditIntegrityHash(previousHash, canonicalPayload);

    return this.prisma.auditLog.create({
      data: {
        hospitalId: params.hospitalId,
        actorUserId: params.actorUserId ?? null,
        actorRole: params.actorRole ?? null,
        serviceName: params.serviceName,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        correlationId: params.correlationId,
        ipAddress: params.ipAddress,
        metadataJson: { ...(params.metadata ?? {}), _nonce: nonce },
        previousHash,
        integrityHash,
      },
    });
  }

  async verifyAuditChainIntegrity(hospitalId: string): Promise<{
    valid: boolean;
    checkedCount: number;
  }> {
    const logs = await this.prisma.auditLog.findMany({
      where: { hospitalId },
      orderBy: { occurredAt: 'asc' },
    });
    for (let i = 1; i < logs.length; i++) {
      if (logs[i].previousHash !== logs[i - 1].integrityHash) {
        return { valid: false, checkedCount: i + 1 };
      }
    }
    return { valid: true, checkedCount: logs.length };
  }

  // ===========================================================================
  // 2. Secure Login with Lockout, MFA, Session, Refresh Token & Outbox (Service 2)
  // ===========================================================================
  async login(dto: LoginDto) {
    const correlationId = dto.correlationId || `corr-${randomUUID()}`;
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.emailOrUsername }, { username: dto.emailOrUsername }],
        deletedAt: null,
      },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (user.status === 'LOCKED' && user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('ACCOUNT_TEMPORARILY_LOCKED');
    }

    const passwordValid = verifyPasswordSecure(dto.password, user.passwordHash);
    if (!passwordValid) {
      const nextAttempts = user.failedLoginAttempts + 1;
      const shouldLock = nextAttempts >= 5;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          status: shouldLock ? 'LOCKED' : user.status,
          lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      await this.appendAuditLog({
        hospitalId: user.hospitalId,
        actorUserId: user.id,
        serviceName: 'identity-service',
        action: shouldLock ? 'AUTH_USER_LOCKED' : 'AUTH_LOGIN_FAILED',
        resourceType: 'User',
        resourceId: user.id,
        correlationId,
        ipAddress: dto.ipAddress,
        metadata: { failedLoginAttempts: nextAttempts },
      });
      await this.prisma.outboxEvent.create({
        data: {
          eventType: 'hospital.identity.login.failed',
          correlationId,
          hospitalId: user.hospitalId,
          partitionKey: user.id,
          payload: { userId: user.id, locked: shouldLock },
        },
      });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      if (!dto.totpCode || !verifyTotpCode(user.mfaSecretEncrypted, dto.totpCode)) {
        throw new UnauthorizedException('MFA_CODE_REQUIRED_OR_INVALID');
      }
    }

    const roles = user.userRoles.map((ur) => ur.role.code as HospitalRole);
    const permissions = resolvePermissionsForRoles(roles);
    const departmentScope = user.userRoles.find((ur) => ur.departmentScope)?.departmentScope ?? null;
    const wardScope = user.userRoles.find((ur) => ur.wardScope)?.wardScope ?? null;

    const session = await this.prisma.loginSession.create({
      data: {
        userId: user.id,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        active: true,
      },
    });

    const rawRefreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.sha256(rawRefreshToken);
    const familyId = randomUUID();

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        familyId,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        status: 'ACTIVE',
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const accessToken = signJwtToken(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        hospitalId: user.hospitalId,
        roles,
        permissions,
        departmentScope,
        wardScope,
        sessionId: session.id,
      },
      this.accessSecret,
      900,
    );

    await this.appendAuditLog({
      hospitalId: user.hospitalId,
      actorUserId: user.id,
      actorRole: roles[0] ?? 'USER',
      serviceName: 'identity-service',
      action: 'AUTH_LOGIN_SUCCEEDED',
      resourceType: 'LoginSession',
      resourceId: session.id,
      correlationId,
      ipAddress: dto.ipAddress,
    });

    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'hospital.identity.login.succeeded',
        correlationId,
        hospitalId: user.hospitalId,
        partitionKey: user.id,
        payload: {
          userId: user.id,
          sessionId: session.id,
          roles,
        },
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        hospitalId: user.hospitalId,
        roles,
        permissions,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  // ===========================================================================
  // 3. Refresh Token Rotation & Replay Detection
  // ===========================================================================
  async refreshAccessToken(rawRefreshToken: string, correlationId = `corr-${randomUUID()}`) {
    const tokenHash = this.sha256(rawRefreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // Replay attack detection: if a rotated/revoked token is presented again, revoke the entire family!
    if (storedToken.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.loginSession.updateMany({
        where: { userId: storedToken.userId, active: true },
        data: { active: false, terminatedAt: new Date() },
      });
      await this.appendAuditLog({
        hospitalId: storedToken.user.hospitalId,
        actorUserId: storedToken.userId,
        serviceName: 'identity-service',
        action: 'AUTH_REFRESH_TOKEN_REPLAY_DETECTED',
        resourceType: 'RefreshTokenFamily',
        resourceId: storedToken.familyId,
        correlationId,
      });
      throw new UnauthorizedException('REFRESH_TOKEN_REPLAY_DETECTED_FAMILY_REVOKED');
    }

    if (storedToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('REFRESH_TOKEN_EXPIRED');
    }

    const nextRawRefresh = randomBytes(48).toString('base64url');
    const nextHash = this.sha256(nextRawRefresh);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenHash: nextHash,
        },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: storedToken.userId,
          tokenHash: nextHash,
          familyId: storedToken.familyId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    const roles = storedToken.user.userRoles.map((ur) => ur.role.code as HospitalRole);
    const permissions = resolvePermissionsForRoles(roles);

    const accessToken = signJwtToken(
      {
        sub: storedToken.user.id,
        email: storedToken.user.email,
        username: storedToken.user.username,
        fullName: storedToken.user.fullName,
        hospitalId: storedToken.user.hospitalId,
        roles,
        permissions,
        sessionId: `refreshed-${storedToken.familyId}`,
      },
      this.accessSecret,
      900,
    );

    return {
      accessToken,
      refreshToken: nextRawRefresh,
      expiresIn: 900,
    };
  }

  // ===========================================================================
  // 4. Logout & Session Termination
  // ===========================================================================
  async logout(userId: string, sessionId: string, rawRefreshToken?: string) {
    await this.prisma.loginSession.updateMany({
      where: { id: sessionId, userId },
      data: { active: false, terminatedAt: new Date() },
    });

    if (rawRefreshToken) {
      const hash = this.sha256(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hash, userId },
        data: { revokedAt: new Date() },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.appendAuditLog({
        hospitalId: user.hospitalId,
        actorUserId: userId,
        serviceName: 'identity-service',
        action: 'AUTH_LOGOUT',
        resourceType: 'LoginSession',
        resourceId: sessionId,
        correlationId: `logout-${randomUUID()}`,
      });
    }
    return { loggedOut: true };
  }

  // ===========================================================================
  // 5. MFA Enrollment & Verification (TOTP)
  // ===========================================================================
  async initiateMfaSetup(userId: string) {
    const secretHex = generateMfaSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: secretHex, mfaEnabled: false },
    });
    return {
      secretHex,
      currentTotpPreviewForTest: generateTotpCode(secretHex),
    };
  }

  async verifyAndEnableMfa(userId: string, totpCode: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecretEncrypted) {
      throw new BadRequestException('MFA_NOT_INITIATED');
    }
    if (!verifyTotpCode(user.mfaSecretEncrypted, totpCode)) {
      throw new UnauthorizedException('INVALID_TOTP_CODE');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
    await this.appendAuditLog({
      hospitalId: user.hospitalId,
      actorUserId: userId,
      serviceName: 'identity-service',
      action: 'AUTH_MFA_ENABLED',
      resourceType: 'User',
      resourceId: userId,
      correlationId: `mfa-${randomUUID()}`,
    });
    return { mfaEnabled: true };
  }

  // ===========================================================================
  // 6. Password Reset Flow
  // ===========================================================================
  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { resetRequested: true };
    }
    const rawResetToken = randomBytes(32).toString('hex');
    const tokenHash = this.sha256(rawResetToken);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    return { resetRequested: true, resetToken: rawResetToken };
  }

  async confirmPasswordReset(rawResetToken: string, newPlainPassword: string) {
    if (newPlainPassword.length < 10) {
      throw new BadRequestException('PASSWORD_TOO_SHORT_MIN_10_CHARS');
    }
    const tokenHash = this.sha256(rawResetToken);
    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!resetRecord || resetRecord.usedAt !== null || resetRecord.expiresAt <= new Date()) {
      throw new UnauthorizedException('INVALID_OR_EXPIRED_RESET_TOKEN');
    }

    const newHash = hashPasswordSecure(newPlainPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data: {
          passwordHash: newHash,
          failedLoginAttempts: 0,
          status: 'ACTIVE',
          lockedUntil: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.appendAuditLog({
      hospitalId: resetRecord.user.hospitalId,
      actorUserId: resetRecord.userId,
      serviceName: 'identity-service',
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      resourceType: 'User',
      resourceId: resetRecord.userId,
      correlationId: `pwdreset-${randomUUID()}`,
    });

    return { passwordReset: true };
  }

  // ===========================================================================
  // 7. RBAC & Resource-Level Authorization Service (Service 3)
  // ===========================================================================
  async assignRole(actorUserId: string, dto: AssignRoleDto) {
    const role = await this.prisma.role.findUnique({
      where: { code: dto.roleCode as HospitalRoleCode },
    });
    if (!role) {
      throw new BadRequestException(`UNKNOWN_ROLE_CODE: ${dto.roleCode}`);
    }

    const assignment = await this.prisma.userRole.upsert({
      where: {
        userId_roleId_hospitalId: {
          userId: dto.targetUserId,
          roleId: role.id,
          hospitalId: dto.hospitalId,
        },
      },
      update: {
        departmentScope: dto.departmentScope ?? null,
        wardScope: dto.wardScope ?? null,
        assignedBy: actorUserId,
      },
      create: {
        userId: dto.targetUserId,
        roleId: role.id,
        hospitalId: dto.hospitalId,
        departmentScope: dto.departmentScope ?? null,
        wardScope: dto.wardScope ?? null,
        assignedBy: actorUserId,
      },
    });

    const correlationId = `rbac-${randomUUID()}`;
    await this.appendAuditLog({
      hospitalId: dto.hospitalId,
      actorUserId,
      serviceName: 'identity-service',
      action: 'RBAC_ROLE_ASSIGNED',
      resourceType: 'UserRole',
      resourceId: assignment.id,
      correlationId,
      metadata: { targetUserId: dto.targetUserId, roleCode: dto.roleCode },
    });

    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'hospital.authz.role.assigned',
        correlationId,
        hospitalId: dto.hospitalId,
        partitionKey: dto.targetUserId,
        payload: {
          targetUserId: dto.targetUserId,
          roleCode: dto.roleCode,
          departmentScope: dto.departmentScope ?? null,
        },
      },
    });

    return assignment;
  }

  evaluateAccess(
    user: JwtUserPayload,
    requiredPermission: string,
    resourceContext?: { hospitalId?: string; departmentId?: string },
  ): { allowed: boolean; reason?: string } {
    if (user.roles.includes('SUPER_ADMIN')) {
      return { allowed: true };
    }
    if (
      resourceContext?.hospitalId &&
      resourceContext.hospitalId !== user.hospitalId
    ) {
      return { allowed: false, reason: 'CROSS_HOSPITAL_TENANT_DENIED' };
    }
    if (
      user.departmentScope &&
      resourceContext?.departmentId &&
      user.departmentScope !== resourceContext.departmentId
    ) {
      return { allowed: false, reason: 'DEPARTMENT_SCOPE_MISMATCH' };
    }
    if (!hasPermission(user.permissions, requiredPermission)) {
      return { allowed: false, reason: `MISSING_PERMISSION:${requiredPermission}` };
    }
    return { allowed: true };
  }

  validateAccessToken(token: string): JwtUserPayload {
    return verifyJwtToken(token, this.accessSecret);
  }
}

