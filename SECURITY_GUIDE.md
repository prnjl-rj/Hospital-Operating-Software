# BLOCK 03 — Security, Identity, Authentication & Authorization Guide (`SECURITY_GUIDE.md`)

## 1. Zero-Trust Identity & Authentication Architecture

The Hospital Operating Software implements multi-layered authentication and authorization enforced inside backend microservices (never merely hidden in the React UI):

1. **Password Security (`scrypt` + `timingSafeEqual`):**
   - Passwords are salted and hashed using `scrypt` (`64-byte` key derivation) and verified using constant-time `crypto.timingSafeEqual` to prevent timing side-channel attacks.
   - 5 consecutive failed login attempts automatically lock the account (`status = 'LOCKED'`, `lockedUntil = +15m`) and publish `hospital.identity.login.failed`.
2. **Short-Lived Access JWT + Rotated Refresh Token Families:**
   - Access tokens (`HS256`/`RS256`, `15m` TTL) carry `sub`, `hospitalId`, `roles`, `permissions`, `departmentScope`, `wardScope`, and `sessionId`.
   - Refresh tokens (`7d` TTL) are stored only as SHA-256 hashes (`identity.RefreshToken`) grouped by `familyId`.
   - **Replay Attack Mitigation:** Every `/auth/refresh` call rotates the refresh token. If a previously rotated refresh token is ever presented again, the service immediately revokes the **entire `familyId`**, terminates all active user sessions, and writes a high-priority `AUTH_REFRESH_TOKEN_REPLAY_DETECTED` audit record.
3. **Multi-Factor Authentication (RFC 6238 TOTP):**
   - Supported for privileged clinical, financial, and administrative roles via `/api/v1/auth/mfa/setup` and `/api/v1/auth/mfa/verify`.
4. **Service-to-Service (S2S) Authentication:**
   - Internal microservice calls require either mutual gRPC context verification or `X-Internal-Service-Token` validated by `@InternalS2S()` and `JwtAuthGuard`.

---

## 2. 15-Role Hospital RBAC & Resource-Level ABAC Matrix

| Role Code | Primary Domain Scope | Key Granted Permissions |
|---|---|---|
| `SUPER_ADMIN` | Multi-Branch Enterprise | `*` (Full platform governance) |
| `HOSPITAL_ADMIN` | Single Hospital (`hospitalId`) | `hospital:config:manage`, `department:manage`, `employee:manage`, `doctor:manage`, `bed:manage`, `billing:invoice:finalize`, `audit:read` |
| `DEPARTMENT_ADMIN` | Department (`departmentScope`) | `department:read`, `roster:manage`, `doctor:schedule:manage`, `appointment:manage`, `opd:queue:manage` |
| `DOCTOR` | Clinical & Inpatient | `encounter:write`, `clinical:note:write`, `clinical:note:sign`, `prescription:sign`, `lab:order:write`, `radiology:order:write`, `ipd:discharge:sign`, `ot:schedule:write` |
| `NURSE` | Ward / ICU / ER (`wardScope`) | `clinical:vitals:write`, `nursing:task:manage`, `nursing:mar:write`, `bed:manage`, `emergency:triage:write`, `icu:flowsheet:write` |
| `COMPOUNDER` | OPD & Dispensary | `clinical:vitals:write`, `prescription:read`, `compounder:task:manage`, `pharmacy:stock:read` |
| `PHARMACIST` | Pharmacy Store | `prescription:read`, `pharmacy:order:dispense`, `pharmacy:catalog:manage`, `inventory:stock:write` |
| `LAB_TECHNICIAN` | Central Lab & Blood Bank | `lab:order:read`, `lab:specimen:collect`, `lab:result:write`, `bloodbank:unit:manage` |
| `RADIOLOGY_TECHNICIAN` | Imaging & PACS | `radiology:order:read`, `radiology:imaging:perform`, `pacs:study:write` |
| `RECEPTIONIST` | Front Desk & ER Registration | `patient:write`, `appointment:manage`, `opd:queue:manage`, `emergency:case:register`, `ambulance:dispatch` |
| `BILLING_STAFF` | Revenue Cycle & Cashier | `billing:invoice:write`, `billing:invoice:finalize`, `payment:collect`, `insurance:claim:manage` |
| `HR` | Workforce & Payroll | `employee:manage`, `roster:manage`, `hr:attendance:manage`, `hr:leave:approve`, `hr:payroll:run` |
| `INVENTORY_MANAGER` | Central Store & Procurement | `inventory:manage`, `procurement:vendor:manage`, `procurement:po:manage`, `procurement:grn:write`, `asset:manage` |
| `ACCOUNTANT` | Financial Ledger & TPA | `billing:invoice:finalize`, `payment:refund`, `insurance:claim:manage`, `hr:payroll:run`, `analytics:read` |
| `AUDITOR` | Compliance & Medico-Legal | `audit:read`, `analytics:read`, `billing:read`, `clinical:note:read_audit` (Strictly Read-Only) |

---

## 3. Tamper-Evident Cryptographic Audit Trail

Every security-sensitive and clinical/financial action is recorded in `identity.AuditLog` with:
- `previousHash`: The `integrityHash` of the immediately preceding audit record for that hospital (`GENESIS` for record 0).
- `integrityHash`: `SHA-256(previousHash + "|" + canonicalRecordJson)`.
- **Database Trigger Protection:** `trg_prevent_audit_log_mutation` raises `COMPLIANCE_VIOLATION` on any SQL `UPDATE` or `DELETE` against `identity."AuditLog"`.

