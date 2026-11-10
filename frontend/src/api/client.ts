import { useAuthStore } from '../store/authStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(options.headers as Record<string, string> | undefined),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `API Error (${res.status})`);
  }
  return data as T;
}

export const hosApi = {
  login: (emailOrUsername: string, password: string, totpCode?: string) =>
    apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrUsername, password, totpCode }),
    }),
  logout: (refreshToken?: string | null) =>
    apiRequest('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  getOverview: () => apiRequest('/dashboard/overview'),
  verifyAuditChain: (hospitalId: string) =>
    apiRequest(`/audit/verify-integrity/${hospitalId}`),
  createDepartment: (dto: {
    hospitalId: string;
    code: string;
    name: string;
    specialtyCategory: string;
  }) =>
    apiRequest('/departments', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  registerPatient: (dto: Record<string, unknown>) =>
    apiRequest('/patients', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  createAppointment: (dto: Record<string, unknown>) =>
    apiRequest('/appointments', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  checkInOpd: (appointmentId: string, priority = 'NORMAL') =>
    apiRequest('/opd/check-in', {
      method: 'POST',
      body: JSON.stringify({ appointmentId, priority }),
    }),
  createEncounter: (dto: Record<string, unknown>) =>
    apiRequest('/encounters', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  recordVitals: (dto: Record<string, unknown>) =>
    apiRequest('/emr/vitals', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  createAndSignClinicalNote: async (dto: Record<string, unknown>) => {
    const draft = await apiRequest('/emr/notes', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return apiRequest(`/emr/notes/${draft.id}/sign`, { method: 'POST' });
  },
  createPrescription: (dto: Record<string, unknown>) =>
    apiRequest('/prescriptions', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  admitInpatient: (dto: Record<string, unknown>) =>
    apiRequest('/ipd/admissions', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  dischargeInpatient: (admissionId: string, dto: Record<string, unknown>) =>
    apiRequest(`/ipd/admissions/${admissionId}/discharge`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  completeCompounderTask: (taskId: string) =>
    apiRequest(`/compounder/tasks/${taskId}/complete`, { method: 'PATCH' }),
  createLabOrder: (dto: Record<string, unknown>) =>
    apiRequest('/lab/orders', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  collectLabSample: (orderId: string) =>
    apiRequest(`/lab/orders/${orderId}/collect-sample`, { method: 'PATCH' }),
  submitLabResult: (orderId: string, dto: Record<string, unknown>) =>
    apiRequest(`/lab/orders/${orderId}/results`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  createRadiologyOrder: (dto: Record<string, unknown>) =>
    apiRequest('/radiology/orders', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  dispensePharmacyOrder: (orderId: string) =>
    apiRequest(`/pharmacy/orders/${orderId}/dispense`, { method: 'POST' }),
  appendInvoiceCharge: (dto: Record<string, unknown>) =>
    apiRequest('/billing/invoices/charge', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  finalizeInvoice: (invoiceId: string) =>
    apiRequest(`/billing/invoices/${invoiceId}/finalize`, { method: 'POST' }),
  collectPayment: (dto: Record<string, unknown>, idempotencyKey: string) =>
    apiRequest('/payments', {
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify({ ...dto, idempotencyKey }),
    }),
  runPayroll: (monthYear: string) =>
    apiRequest('/hr/payroll/run', {
      method: 'POST',
      body: JSON.stringify({ monthYear }),
    }),
};

