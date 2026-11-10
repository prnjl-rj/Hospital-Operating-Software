import { describe, it, expect } from 'vitest';
import { PORTAL_DEFINITIONS } from '../../frontend/src/App';

describe('BLOCK 05 — React 13-Role Portal Definitions & Contract Verification', () => {
  it('defines all 13 required role portals mapped to live backend RBAC roles', () => {
    expect(PORTAL_DEFINITIONS).toHaveLength(13);
    const keys = PORTAL_DEFINITIONS.map((p) => p.key);
    expect(keys).toEqual([
      'SUPER_ADMIN',
      'HOSPITAL_ADMIN',
      'DOCTOR',
      'NURSE',
      'COMPOUNDER',
      'RECEPTIONIST',
      'PHARMACY',
      'LABORATORY',
      'RADIOLOGY',
      'BILLING',
      'HR',
      'INVENTORY',
      'PATIENT_PORTAL',
    ]);
  });
});

