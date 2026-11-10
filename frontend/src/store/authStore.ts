import { create } from 'zustand';

export type PortalKey =
  | 'SUPER_ADMIN'
  | 'HOSPITAL_ADMIN'
  | 'DOCTOR'
  | 'NURSE'
  | 'COMPOUNDER'
  | 'RECEPTIONIST'
  | 'PHARMACY'
  | 'LABORATORY'
  | 'RADIOLOGY'
  | 'BILLING'
  | 'HR'
  | 'INVENTORY'
  | 'PATIENT_PORTAL';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  hospitalId: string;
  roles: string[];
  permissions: string[];
  mfaEnabled: boolean;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthenticatedUser | null;
  activePortal: PortalKey;
  setSession: (accessToken: string, refreshToken: string, user: AuthenticatedUser) => void;
  setActivePortal: (portal: PortalKey) => void;
  clearSession: () => void;
}

const ROLE_TO_DEFAULT_PORTAL: Record<string, PortalKey> = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HOSPITAL_ADMIN: 'HOSPITAL_ADMIN',
  DEPARTMENT_ADMIN: 'HOSPITAL_ADMIN',
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  COMPOUNDER: 'COMPOUNDER',
  RECEPTIONIST: 'RECEPTIONIST',
  PHARMACIST: 'PHARMACY',
  LAB_TECHNICIAN: 'LABORATORY',
  RADIOLOGY_TECHNICIAN: 'RADIOLOGY',
  BILLING_STAFF: 'BILLING',
  ACCOUNTANT: 'BILLING',
  HR: 'HR',
  INVENTORY_MANAGER: 'INVENTORY',
  AUDITOR: 'SUPER_ADMIN',
  PATIENT: 'PATIENT_PORTAL',
};

const safeGetItem = (key: string): string | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors in non-browser environments
  }
  return null;
};

const safeSetItem = (key: string, value: string): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') {
      window.localStorage.setItem(key, value);
    }
  } catch {}
};

const safeRemoveItem = (key: string): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.removeItem === 'function') {
      window.localStorage.removeItem(key);
    }
  } catch {}
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: safeGetItem('hos_access_token'),
  refreshToken: safeGetItem('hos_refresh_token'),
  user: safeGetItem('hos_user') ? JSON.parse(safeGetItem('hos_user')!) : null,
  activePortal: 'SUPER_ADMIN',
  setSession: (accessToken, refreshToken, user) => {
    safeSetItem('hos_access_token', accessToken);
    safeSetItem('hos_refresh_token', refreshToken);
    safeSetItem('hos_user', JSON.stringify(user));
    const defaultPortal = ROLE_TO_DEFAULT_PORTAL[user.roles[0]] || 'HOSPITAL_ADMIN';
    set({ accessToken, refreshToken, user, activePortal: defaultPortal });
  },
  setActivePortal: (activePortal) => set({ activePortal }),
  clearSession: () => {
    safeRemoveItem('hos_access_token');
    safeRemoveItem('hos_refresh_token');
    safeRemoveItem('hos_user');
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
