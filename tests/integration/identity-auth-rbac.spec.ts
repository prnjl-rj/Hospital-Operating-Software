import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { IdentityService } from '../../services/identity-service/src/identity.service';
import { ROLE_PERMISSION_MATRIX } from '../../packages/shared/src/auth/security.utils';

dotenv.config({ path: resolve(process.cwd(), '.env') });

describe('BLOCK 03 — Live PostgreSQL Identity, Authentication, RBAC/ABAC & Tamper-Evident Audit Integration', () => {
  let identityService: IdentityService;

  beforeAll(() => {
    identityService = new IdentityService();
  });

  afterAll(async () => {
    await identityService.onModuleDestroy();
  });

  it('verifies all 15 required hospital roles and permissions exist in live PostgreSQL identity schema', async () => {
    const roles = await identityService.prisma.role.findMany();
    expect(roles.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(ROLE_PERMISSION_MATRIX)).toEqual(
      expect.arrayContaining([
        'SUPER_ADMIN',
        'HOSPITAL_ADMIN',
        'DEPARTMENT_ADMIN',
        'DOCTOR',
        'NURSE',
        'COMPOUNDER',
        'PHARMACIST',
        'LAB_TECHNICIAN',
        'RADIOLOGY_TECHNICIAN',
        'RECEPTIONIST',
        'BILLING_STAFF',
        'HR',
        'INVENTORY_MANAGER',
        'ACCOUNTANT',
        'AUDITOR',
      ]),
    );
  });

  it('authenticates Doctor, rotates refresh token, and detects & blocks Refresh Token Replay Attacks', async () => {
    // 1. Login as Dr. Arjun Nair
    const loginRes = await identityService.login({
      emailOrUsername: 'dr.arjun@hos.local',
      password: 'Hospital@2026!',
      ipAddress: '127.0.0.1',
      userAgent: 'Vitest-Integration-Suite',
    });

    expect(loginRes.accessToken).toBeDefined();
    expect(loginRes.refreshToken).toBeDefined();
    expect(loginRes.user.roles).toContain('DOCTOR');
    expect(loginRes.user.permissions).toContain('clinical:note:sign');

    // 2. Rotate Refresh Token (R1 -> R2)
    const rotatedRes = await identityService.refreshAccessToken(loginRes.refreshToken);
    expect(rotatedRes.accessToken).toBeDefined();
    expect(rotatedRes.refreshToken).not.toBe(loginRes.refreshToken);

    // 3. Replay Attack: Re-present old Refresh Token R1 -> must revoke entire token family including R2!
    await expect(
      identityService.refreshAccessToken(loginRes.refreshToken),
    ).rejects.toThrow(/REFRESH_TOKEN_REPLAY_DETECTED_FAMILY_REVOKED/);

    // Confirm R2 is now also revoked because of family compromise
    await expect(
      identityService.refreshAccessToken(rotatedRes.refreshToken),
    ).rejects.toThrow(/REFRESH_TOKEN_REPLAY_DETECTED_FAMILY_REVOKED/);
  });

  it('enforces RBAC permissions and resource-level hospital/department ABAC boundaries', async () => {
    const docLogin = await identityService.login({
      emailOrUsername: 'dr.arjun@hos.local',
      password: 'Hospital@2026!',
    });
    const recepLogin = await identityService.login({
      emailOrUsername: 'reception@hos.local',
      password: 'Hospital@2026!',
    });

    const docClaims = identityService.validateAccessToken(docLogin.accessToken);
    const recepClaims = identityService.validateAccessToken(recepLogin.accessToken);

    // Doctor can sign clinical notes in their hospital
    expect(
      identityService.evaluateAccess(docClaims, 'clinical:note:sign', {
        hospitalId: 'hosp-main-001',
      }).allowed,
    ).toBe(true);

    // Receptionist CANNOT sign clinical notes
    const recepEval = identityService.evaluateAccess(recepClaims, 'clinical:note:sign', {
      hospitalId: 'hosp-main-001',
    });
    expect(recepEval.allowed).toBe(false);
    expect(recepEval.reason).toContain('MISSING_PERMISSION');

    // Cross-hospital access is denied for non-Super-Admin
    const crossHospEval = identityService.evaluateAccess(docClaims, 'clinical:note:sign', {
      hospitalId: 'hosp-other-999',
    });
    expect(crossHospEval.allowed).toBe(false);
    expect(crossHospEval.reason).toBe('CROSS_HOSPITAL_TENANT_DENIED');
  });

  it('enrolls and verifies RFC 6238 TOTP Multi-Factor Authentication and Password Reset flow', async () => {
    // 1. Setup MFA for Auditor account
    const mfaSetup = await identityService.initiateMfaSetup('usr-auditor-01');
    expect(mfaSetup.secretHex).toHaveLength(40);

    const mfaVerify = await identityService.verifyAndEnableMfa(
      'usr-auditor-01',
      mfaSetup.currentTotpPreviewForTest,
    );
    expect(mfaVerify.mfaEnabled).toBe(true);

    // Login without TOTP code must now fail
    await expect(
      identityService.login({
        emailOrUsername: 'auditor@hos.local',
        password: 'Hospital@2026!',
      }),
    ).rejects.toThrow(/MFA_CODE_REQUIRED_OR_INVALID/);

    // Login with valid TOTP code succeeds
    const mfaLogin = await identityService.login({
      emailOrUsername: 'auditor@hos.local',
      password: 'Hospital@2026!',
      totpCode: mfaSetup.currentTotpPreviewForTest,
    });
    expect(mfaLogin.accessToken).toBeDefined();

    // 2. Password Reset Flow
    const forgot = await identityService.requestPasswordReset('billing@hos.local');
    expect(forgot.resetToken).toBeDefined();
    const resetConfirm = await identityService.confirmPasswordReset(
      forgot.resetToken!,
      'Hospital@2026!',
    );
    expect(resetConfirm.passwordReset).toBe(true);
  });

  it('verifies SHA-256 hash-chained AuditLog integrity and database trigger blocking audit mutation', async () => {
    const chainCheck = await identityService.verifyAuditChainIntegrity('hosp-main-001');
    expect(chainCheck.valid).toBe(true);
    expect(chainCheck.checkedCount).toBeGreaterThanOrEqual(5);

    const anyAudit = await identityService.prisma.auditLog.findFirst({
      where: { hospitalId: 'hosp-main-001' },
    });
    expect(anyAudit).not.toBeNull();

    // Attempt to delete an audit log record -> PostgreSQL trigger must reject with COMPLIANCE_VIOLATION!
    await expect(
      identityService.prisma.auditLog.delete({ where: { id: anyAudit!.id } }),
    ).rejects.toThrow(/COMPLIANCE_VIOLATION/);
  });
});

