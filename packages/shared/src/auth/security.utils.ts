import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type HospitalRole =
  | 'SUPER_ADMIN'
  | 'HOSPITAL_ADMIN'
  | 'DEPARTMENT_ADMIN'
  | 'DOCTOR'
  | 'NURSE'
  | 'COMPOUNDER'
  | 'PHARMACIST'
  | 'LAB_TECHNICIAN'
  | 'RADIOLOGY_TECHNICIAN'
  | 'RECEPTIONIST'
  | 'BILLING_STAFF'
  | 'HR'
  | 'INVENTORY_MANAGER'
  | 'ACCOUNTANT'
  | 'AUDITOR'
  | 'PATIENT';

export interface JwtUserPayload {
  sub: string;
  email: string;
  username: string;
  fullName: string;
  hospitalId: string;
  roles: HospitalRole[];
  permissions: string[];
  departmentScope?: string | null;
  wardScope?: string | null;
  sessionId: string;
  iat: number;
  exp: number;
}

// =============================================================================
// 1. Complete 15-Role Hospital Permission Matrix
// =============================================================================
export const ROLE_PERMISSION_MATRIX: Record<HospitalRole, string[]> = {
  SUPER_ADMIN: ['*'],
  HOSPITAL_ADMIN: [
    'hospital:config:manage',
    'department:manage',
    'employee:manage',
    'doctor:manage',
    'patient:read',
    'patient:write',
    'appointment:manage',
    'bed:manage',
    'ipd:manage',
    'billing:read',
    'billing:invoice:finalize',
    'inventory:manage',
    'asset:manage',
    'facility:manage',
    'analytics:read',
    'audit:read',
  ],
  DEPARTMENT_ADMIN: [
    'department:read',
    'employee:read',
    'roster:manage',
    'doctor:schedule:manage',
    'appointment:manage',
    'opd:queue:manage',
    'bed:read',
  ],
  DOCTOR: [
    'patient:read',
    'appointment:read',
    'opd:queue:manage',
    'encounter:write',
    'clinical:note:write',
    'clinical:note:sign',
    'clinical:vitals:write',
    'prescription:write',
    'prescription:sign',
    'lab:order:write',
    'lab:result:read',
    'radiology:order:write',
    'radiology:report:write',
    'pacs:study:read',
    'ipd:admission:write',
    'ipd:round:write',
    'ipd:discharge:sign',
    'emergency:triage:write',
    'ot:schedule:write',
    'icu:flowsheet:write',
    'document:read',
    'document:write',
  ],
  NURSE: [
    'patient:read',
    'opd:queue:read',
    'clinical:vitals:write',
    'prescription:read',
    'nursing:task:manage',
    'nursing:mar:write',
    'bed:manage',
    'ipd:round:read',
    'emergency:triage:write',
    'icu:flowsheet:write',
    'lab:result:read',
    'facility:cleaning:request',
  ],
  COMPOUNDER: [
    'patient:read',
    'opd:queue:read',
    'clinical:vitals:write',
    'prescription:read',
    'compounder:task:manage',
    'pharmacy:stock:read',
  ],
  PHARMACIST: [
    'patient:read',
    'prescription:read',
    'pharmacy:order:dispense',
    'pharmacy:catalog:manage',
    'inventory:stock:read',
    'inventory:stock:write',
  ],
  LAB_TECHNICIAN: [
    'patient:read',
    'lab:order:read',
    'lab:specimen:collect',
    'lab:result:write',
    'bloodbank:unit:manage',
  ],
  RADIOLOGY_TECHNICIAN: [
    'patient:read',
    'radiology:order:read',
    'radiology:imaging:perform',
    'pacs:study:write',
    'pacs:study:read',
  ],
  RECEPTIONIST: [
    'patient:read',
    'patient:write',
    'appointment:manage',
    'opd:queue:manage',
    'bed:read',
    'emergency:case:register',
    'ambulance:dispatch',
    'billing:read',
  ],
  BILLING_STAFF: [
    'patient:read',
    'billing:read',
    'billing:invoice:write',
    'billing:invoice:finalize',
    'payment:collect',
    'insurance:claim:manage',
  ],
  HR: [
    'employee:manage',
    'roster:manage',
    'hr:attendance:manage',
    'hr:leave:approve',
    'hr:payroll:run',
  ],
  INVENTORY_MANAGER: [
    'inventory:manage',
    'inventory:stock:read',
    'inventory:stock:write',
    'procurement:vendor:manage',
    'procurement:po:manage',
    'procurement:grn:write',
    'asset:manage',
  ],
  ACCOUNTANT: [
    'billing:read',
    'billing:invoice:finalize',
    'payment:read',
    'payment:refund',
    'insurance:claim:manage',
    'hr:payroll:run',
    'analytics:read',
  ],
  AUDITOR: [
    'audit:read',
    'analytics:read',
    'billing:read',
    'clinical:note:read_audit',
  ],
  PATIENT: [
    'patient:own:read',
    'appointment:own:manage',
    'prescription:own:read',
    'lab:result:own:read',
    'billing:own:read',
  ],
};

export function resolvePermissionsForRoles(roles: HospitalRole[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    const perms = ROLE_PERMISSION_MATRIX[role] || [];
    for (const p of perms) set.add(p);
  }
  return Array.from(set);
}

export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  if (userPermissions.includes('*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;
  const [reqResource, reqAction] = requiredPermission.split(':');
  return userPermissions.includes(`${reqResource}:*`) || userPermissions.includes(`${reqResource}:manage`);
}

// =============================================================================
// 2. Password Hashing & Verification (Scrypt + Timing-Safe Equal)
// =============================================================================
export function hashPasswordSecure(plainPassword: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(plainPassword, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPasswordSecure(plainPassword: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  const candidateHex = scryptSync(plainPassword, salt, 64).toString('hex');
  const a = Buffer.from(originalHex, 'hex');
  const b = Buffer.from(candidateHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// =============================================================================
// 3. RFC 7519 JWT Signing & Verification (Zero External Native Binary Issues)
// =============================================================================
function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signJwtToken(
  payload: Omit<JwtUserPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 900,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtUserPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJwtToken(token: string, secret: string): JwtUserPayload {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error('INVALID_TOKEN_FORMAT');
  }
  const [header, body, sig] = segments;
  const expectedSig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('INVALID_TOKEN_SIGNATURE');
  }
  const decoded = JSON.parse(base64UrlDecode(body)) as JwtUserPayload;
  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp <= now) {
    throw new Error('TOKEN_EXPIRED');
  }
  return decoded;
}

// =============================================================================
// 4. TOTP Multi-Factor Authentication (RFC 6238 HMAC-SHA1)
// =============================================================================
export function generateMfaSecret(): string {
  return randomBytes(20).toString('hex');
}

export function generateTotpCode(secretHex: string, windowOffset = 0, stepSeconds = 30): string {
  const counter = Math.floor(Date.now() / 1000 / stepSeconds) + windowOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);
  const hmac = createHmac('sha1', Buffer.from(secretHex, 'hex')).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretHex: string, candidateCode: string): boolean {
  for (const offset of [-1, 0, 1]) {
    if (generateTotpCode(secretHex, offset) === candidateCode) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// 5. Cryptographic Audit Hash-Chain Helper
// =============================================================================
export function computeAuditIntegrityHash(previousHash: string, canonicalRecordJson: string): string {
  return createHash('sha256').update(`${previousHash}|${canonicalRecordJson}`).digest('hex');
}

