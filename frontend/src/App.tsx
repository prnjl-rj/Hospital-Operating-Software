import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { hosApi } from './api/client';
import { PortalKey, useAuthStore } from './store/authStore';
import { Badge, Card, EmptyState, StatMetric } from './components/ui';

const PatientSchema = z.object({
  firstName: z.string().min(2, 'First name required'),
  lastName: z.string().min(2, 'Last name required'),
  dateOfBirth: z.string().min(8, 'DOB YYYY-MM-DD required'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  bloodGroup: z.string().optional(),
  phone: z.string().min(10, 'Valid phone number required'),
  addressLine: z.string().min(4, 'Address required'),
  city: z.string().min(2, 'City required'),
  state: z.string().min(2, 'State required'),
  postalCode: z.string().min(4, 'Postal code required'),
});

export const PORTAL_DEFINITIONS: Array<{
  key: PortalKey;
  label: string;
  description: string;
  demoAccount: string;
}> = [
  { key: 'SUPER_ADMIN', label: '1. Super Admin Portal', description: 'Enterprise Multi-Branch Governance & Tamper-Evident Audit Chain', demoAccount: 'superadmin@hos.local' },
  { key: 'HOSPITAL_ADMIN', label: '2. Hospital Admin Portal', description: '550-Bed Topology, Departments, Beds, Assets & Executive KPIs', demoAccount: 'admin@hos.local' },
  { key: 'DOCTOR', label: '3. Doctor Portal', description: 'OPD Consultations, Immutable Signed SOAP EMR, E-Prescriptions, Lab/Radiology Orders & IPD Discharge', demoAccount: 'dr.arjun@hos.local' },
  { key: 'NURSE', label: '4. Nurse Portal', description: 'Ward & ICU Bed Census, Vital Signs, Nursing Tasks & Medication Administration (MAR)', demoAccount: 'nurse.priya@hos.local' },
  { key: 'COMPOUNDER', label: '5. Compounder Portal', description: 'Outpatient Injections, Wound Dressing, Nebulization & Dispensary Queue', demoAccount: 'compounder.ravi@hos.local' },
  { key: 'RECEPTIONIST', label: '6. Receptionist Portal', description: 'Synthetic Patient Registration (MPI), Appointment Booking, OPD Token Check-In & Ambulance Dispatch', demoAccount: 'reception@hos.local' },
  { key: 'PHARMACY', label: '7. Pharmacy Portal', description: 'E-Prescription Worklist & FEFO (First-Expiry-First-Out) Batch Dispensing', demoAccount: 'pharmacy@hos.local' },
  { key: 'LABORATORY', label: '8. Laboratory Portal', description: 'Specimen Barcode Collection, Analyzer Worklist, Result Entry & Critical Panic Alerts', demoAccount: 'lab@hos.local' },
  { key: 'RADIOLOGY', label: '9. Radiology & PACS Portal', description: 'CT/MRI/X-Ray Modality Worklist, DICOM Study UIDs & WADO-RS Viewer Links', demoAccount: 'radiology@hos.local' },
  { key: 'BILLING', label: '10. Billing & TPA Portal', description: 'Folio Invoices, Idempotent Cashier Payments & Insurance TPA Claims', demoAccount: 'billing@hos.local' },
  { key: 'HR', label: '11. HR & Payroll Portal', description: 'Workforce Onboarding, Shift Rosters, Leave Management & Monthly Payroll Runs', demoAccount: 'hr@hos.local' },
  { key: 'INVENTORY', label: '12. Inventory & Assets Portal', description: 'Central Store FEFO Batches, Reorder Thresholds, Procurement & Biomedical Assets', demoAccount: 'inventory@hos.local' },
  { key: 'PATIENT_PORTAL', label: '13. Patient Self-Service Portal', description: 'Personal Appointments, Signed Prescriptions, Verified Lab Reports & Invoices', demoAccount: 'reception@hos.local' },
];

export function App() {
  const { user, activePortal, setSession, setActivePortal, clearSession, refreshToken } =
    useAuthStore();
  const queryClient = useQueryClient();

  // Login State
  const [loginEmail, setLoginEmail] = useState('dr.arjun@hos.local');
  const [loginPassword, setLoginPassword] = useState('Hospital@2026!');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Patient Registration Form State
  const [patForm, setPatForm] = useState({
    firstName: 'Kavya',
    lastName: 'Nair (Synthetic)',
    dateOfBirth: '1994-11-12',
    gender: 'FEMALE' as const,
    bloodGroup: 'A+',
    phone: '+91-9820112233',
    addressLine: '18 Marine Drive Synthetic',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400020',
  });

  // Clinical SOAP Note State
  const [soapComplaint, setSoapComplaint] = useState('Acute chest tightness radiating to left arm');
  const [soapPlan, setSoapPlan] = useState('Stat ECG, Troponin-I & CBC; start Aspirin + Amoxicillin prophylaxis');

  const overviewQuery = useQuery({
    queryKey: ['hos-overview', user?.id],
    queryFn: () => hosApi.getOverview(),
    enabled: Boolean(user),
    refetchInterval: 8000,
  });

  const loginMutation = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      hosApi.login(creds.email, creds.password),
    onSuccess: (data) => {
      setLoginError(null);
      setSession(data.accessToken, data.refreshToken, data.user);
      setStatusBanner(`Authenticated as ${data.user.fullName} [${data.user.roles.join(', ')}]`);
    },
    onError: (err: Error) => {
      setLoginError(err.message);
    },
  });

  const registerPatientMutation = useMutation({
    mutationFn: async () => {
      const parsed = PatientSchema.parse(patForm);
      return hosApi.registerPatient(parsed);
    },
    onSuccess: (pat) => {
      setStatusBanner(`Registered Synthetic Patient ${pat.firstName} ${pat.lastName} — MRN: ${pat.mrn}`);
      queryClient.invalidateQueries({ queryKey: ['hos-overview'] });
    },
    onError: (err: Error) => setStatusBanner(`Validation/API Error: ${err.message}`),
  });

  const clinicalWorkflowMutation = useMutation({
    mutationFn: async () => {
      const enc = await hosApi.createEncounter({
        patientRefId: 'pat-synth-001',
        patientMrn: 'HOS-2026-000001',
        doctorRefId: 'doc-cardio-01',
        departmentRefId: 'dept-cardio',
        encounterType: 'OPD',
      });
      const signedNote = await hosApi.createAndSignClinicalNote({
        encounterId: enc.id,
        patientRefId: 'pat-synth-001',
        chiefComplaint: soapComplaint,
        historyOfPresentIllness: 'Recorded via Doctor Portal live workflow',
        assessmentAndPlan: soapPlan,
      });
      const rx = await hosApi.createPrescription({
        encounterId: enc.id,
        patientRefId: 'pat-synth-001',
        doctorRefId: 'doc-cardio-01',
        items: [
          {
            medicationCode: 'MED-AMOX-500',
            medicationName: 'Amoxicillin Trihydrate 500mg',
            dosageStrength: '500mg',
            route: 'IM',
            frequency: 'BID',
            durationDays: 5,
            quantityPrescribed: 10,
            requiresCompounder: true,
          },
        ],
      });
      return { enc, signedNote, rx };
    },
    onSuccess: ({ enc, signedNote, rx }) => {
      setStatusBanner(
        `Created Encounter ${enc.encounterNumber}, Signed Immutable Note (Hash: ${signedNote.contentHash.slice(0, 12)}...), and Issued Rx ${rx.prescriptionNumber}`,
      );
      queryClient.invalidateQueries({ queryKey: ['hos-overview'] });
    },
    onError: (err: Error) => setStatusBanner(`Clinical Error: ${err.message}`),
  });

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="mb-6">
            <Badge variant="info">NABH / JCI Enterprise Grade — 550+ Beds</Badge>
            <h1 className="mt-2 text-2xl font-bold text-white">
              Emerald Multispecialty Hospital Operating Software
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Sign in with any of the 15 RBAC hospital roles or select a quick role preset below.
            </p>
          </div>

          {loginError && (
            <div className="mb-4 rounded-lg border border-rose-700/60 bg-rose-950/60 p-3 text-sm text-rose-200">
              {loginError}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              loginMutation.mutate({ email: loginEmail, password: loginPassword });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Staff Email or Username
              </label>
              <input
                type="text"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loginMutation.isPending ? 'Authenticating...' : 'Sign In to Hospital OS'}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-800 pt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              One-Click Role Account Switcher (Password: Hospital@2026!)
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: 'Super Admin', email: 'superadmin@hos.local' },
                { label: 'Hospital Admin', email: 'admin@hos.local' },
                { label: 'Doctor (Cardio)', email: 'dr.arjun@hos.local' },
                { label: 'Nurse (ICU/Ward)', email: 'nurse.priya@hos.local' },
                { label: 'Compounder', email: 'compounder.ravi@hos.local' },
                { label: 'Receptionist', email: 'reception@hos.local' },
                { label: 'Pharmacist', email: 'pharmacy@hos.local' },
                { label: 'Lab Tech', email: 'lab@hos.local' },
                { label: 'Radiology Tech', email: 'radiology@hos.local' },
                { label: 'Billing Staff', email: 'billing@hos.local' },
                { label: 'HR Manager', email: 'hr@hos.local' },
                { label: 'Inventory Mgr', email: 'inventory@hos.local' },
              ].map((preset) => (
                <button
                  key={preset.email}
                  type="button"
                  onClick={() => {
                    setLoginEmail(preset.email);
                    loginMutation.mutate({ email: preset.email, password: 'Hospital@2026!' });
                  }}
                  className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-left text-xs text-slate-300 hover:border-emerald-600 hover:text-white"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = overviewQuery.data;
  const metrics = data?.metrics || {};
  const activePortalMeta =
    PORTAL_DEFINITIONS.find((p) => p.key === activePortal) || PORTAL_DEFINITIONS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Enterprise Header */}
      <header className="border-b border-slate-800 bg-slate-900/95 px-6 py-3.5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="text-sm font-bold tracking-wide text-white">
                {data?.hospital?.name || 'Emerald Multispecialty Hospital (550 Beds)'}
              </span>
              <Badge variant="success">{data?.hospital?.code || 'HOS-MAIN-001'}</Badge>
            </div>
            <p className="text-xs text-slate-400">
              Signed in as <strong className="text-slate-200">{user.fullName}</strong> (
              {user.roles.join(', ')}) — Synthetic Data Safeguard Active
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => overviewQuery.refetch()}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Sync Live State
            </button>
            <button
              onClick={async () => {
                await hosApi.logout(refreshToken).catch(() => {});
                clearSession();
              }}
              className="rounded-lg border border-rose-800/60 bg-rose-950/50 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/60"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-12">
        {/* Left Navigation: All 13 Role Portals */}
        <aside className="space-y-1.5 lg:col-span-3">
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            13 Role-Based Portals
          </div>
          {PORTAL_DEFINITIONS.map((portal) => (
            <button
              key={portal.key}
              onClick={() => setActivePortal(portal.key)}
              className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                activePortal === portal.key
                  ? 'border border-emerald-600/60 bg-emerald-950/60 text-emerald-300'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              {portal.label}
            </button>
          ))}
        </aside>

        {/* Main Portal Workspace */}
        <main className="space-y-6 lg:col-span-9">
          {statusBanner && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-700/60 bg-emerald-950/50 px-4 py-3 text-xs text-emerald-200">
              <span>{statusBanner}</span>
              <button
                onClick={() => setStatusBanner(null)}
                className="ml-4 font-bold text-emerald-400"
              >
                ×
              </button>
            </div>
          )}

          {/* Active Portal Header */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">{activePortalMeta.label}</h2>
                <p className="text-xs text-slate-400">{activePortalMeta.description}</p>
              </div>
              <Badge variant="info">Active Role Context: {user.roles[0]}</Badge>
            </div>
          </div>

          {/* Real-Time Hospital KPI Strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatMetric
              label="Registered Patients"
              value={metrics.patientsCount ?? 0}
              hint="Synthetic MPI Records"
            />
            <StatMetric
              label="Live Bed Census"
              value={`${metrics.occupiedBeds ?? 0} / ${metrics.totalBeds ?? 15}`}
              hint={`${metrics.availableBeds ?? 0} Available, ${metrics.cleaningBeds ?? 0} Cleaning`}
            />
            <StatMetric
              label="Pending Diagnostics"
              value={metrics.pendingLabOrders ?? 0}
              hint="Active Lab & Imaging Queue"
            />
            <StatMetric
              label="Collected Revenue"
              value={`INR ${((Number(metrics.totalRevenueMinor || 0)) / 100).toFixed(2)}`}
              hint={`${metrics.completedPaymentsCount ?? 0} Verified Receipts`}
            />
          </div>

          {/* Portal-Specific Interactive Operational Panels */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Receptionist & Patient Registration Panel */}
            <Card
              title="Master Patient Index (MPI) Registration"
              subtitle="Creates synthetic patient record & publishes hospital.patient.registered"
              badge={<Badge variant="success">Outbox Enabled</Badge>}
            >
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={patForm.firstName}
                    onChange={(e) => setPatForm({ ...patForm, firstName: e.target.value })}
                    placeholder="First Name"
                    className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                  />
                  <input
                    value={patForm.lastName}
                    onChange={(e) => setPatForm({ ...patForm, lastName: e.target.value })}
                    placeholder="Last Name"
                    className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={patForm.phone}
                    onChange={(e) => setPatForm({ ...patForm, phone: e.target.value })}
                    placeholder="Phone"
                    className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                  />
                  <input
                    value={patForm.bloodGroup}
                    onChange={(e) => setPatForm({ ...patForm, bloodGroup: e.target.value })}
                    placeholder="Blood Group"
                    className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                  />
                </div>
                <button
                  onClick={() => registerPatientMutation.mutate()}
                  disabled={registerPatientMutation.isPending}
                  className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-500"
                >
                  {registerPatientMutation.isPending
                    ? 'Registering...'
                    : 'Register Synthetic Patient & Emit Kafka Outbox Event'}
                </button>
              </div>
            </Card>

            {/* Doctor Clinical EMR, Immutable Note Signing & E-Prescription Panel */}
            <Card
              title="Clinical EMR, Immutable Note Signature & E-Rx"
              subtitle="Computes SHA-256 contentHash, locks note via DB trigger & fans out to Pharmacy/Compounder"
              badge={<Badge variant="info">Medico-Legal Safe</Badge>}
            >
              <div className="space-y-3 text-xs">
                <input
                  value={soapComplaint}
                  onChange={(e) => setSoapComplaint(e.target.value)}
                  placeholder="Chief Complaint"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                />
                <textarea
                  value={soapPlan}
                  onChange={(e) => setSoapPlan(e.target.value)}
                  rows={2}
                  placeholder="Assessment & Plan"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
                />
                <button
                  onClick={() => clinicalWorkflowMutation.mutate()}
                  disabled={clinicalWorkflowMutation.isPending}
                  className="w-full rounded-lg bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-500"
                >
                  {clinicalWorkflowMutation.isPending
                    ? 'Signing Clinical Record...'
                    : 'Sign Immutable SOAP Note + Issue E-Prescription'}
                </button>
              </div>
            </Card>
          </div>

          {/* Live 500+ Bed Ward & ICU Occupancy Grid */}
          <Card
            title="Real-Time Ward & ICU Bed Census Board"
            subtitle="Live state transitions: AVAILABLE -> OCCUPIED -> CLEANING (Housekeeping Turnaround)"
            badge={<Badge variant="default">{data?.beds?.length || 0} Monitored Beds</Badge>}
          >
            {!data?.beds || data.beds.length === 0 ? (
              <EmptyState message="No beds loaded." />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                {data.beds.map((bed: any) => (
                  <div
                    key={bed.id}
                    className={`rounded-lg border p-2.5 text-xs ${
                      bed.status === 'AVAILABLE'
                        ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                        : bed.status === 'OCCUPIED'
                          ? 'border-rose-800/70 bg-rose-950/40 text-rose-200'
                          : 'border-amber-800/70 bg-amber-950/40 text-amber-200'
                    }`}
                  >
                    <div className="font-bold">{bed.bedNumber}</div>
                    <div className="text-[11px] opacity-80">{bed.roomNumber}</div>
                    <div className="mt-1 font-semibold">{bed.status}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Diagnostics (Lab, Radiology/PACS), Pharmacy FEFO & Tamper-Evident Audit Trail */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card
              title="Laboratory, Radiology PACS & Pharmacy FEFO Queue"
              subtitle="Live diagnostic orders, barcode specimens & FEFO inventory batches"
            >
              <div className="space-y-2 text-xs">
                <div className="font-semibold text-slate-300">
                  Recent Lab Orders ({data?.labOrders?.length || 0})
                </div>
                {(data?.labOrders || []).slice(0, 3).map((ord: any) => (
                  <div
                    key={ord.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 p-2"
                  >
                    <div>
                      <span className="font-medium text-white">{ord.orderNumber}</span> —{' '}
                      {ord.testName}
                    </div>
                    <Badge variant={ord.status === 'RESULT_READY' ? 'success' : 'warning'}>
                      {ord.status}
                    </Badge>
                  </div>
                ))}

                <div className="pt-2 font-semibold text-slate-300">
                  FEFO Pharmacy Inventory Batches ({data?.inventoryBatches?.length || 0})
                </div>
                {(data?.inventoryBatches || []).map((batch: any) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 p-2"
                  >
                    <span>
                      {batch.medication?.genericName} ({batch.batchNumber})
                    </span>
                    <Badge variant="info">Qty: {batch.quantityOnHand}</Badge>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              title="Tamper-Evident SHA-256 Compliance Audit Ledger"
              subtitle="Append-only hash-chained security & medico-legal audit trail"
              badge={
                <button
                  onClick={async () => {
                    const res = await hosApi.verifyAuditChain(user.hospitalId);
                    setStatusBanner(
                      `Cryptographic Audit Chain Verified: valid=${res.valid} (${res.checkedCount} chained records verified)`,
                    );
                  }}
                  className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                >
                  Verify SHA-256 Chain
                </button>
              }
            >
              <div className="space-y-2 text-xs">
                {(data?.auditLogs || []).slice(0, 5).map((log: any) => (
                  <div
                    key={log.id}
                    className="rounded border border-slate-800 bg-slate-950 p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-400">{log.action}</span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(log.occurredAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                      Hash: {log.integrityHash}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}

