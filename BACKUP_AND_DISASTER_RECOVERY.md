# BLOCK 02 — Backup and Disaster Recovery Guide (`BACKUP_AND_DISASTER_RECOVERY.md`)

## 1. Recovery Objectives (RPO & RTO)

For a 500+ bed multispecialty hospital, clinical and billing availability is critical:
- **Recovery Point Objective (RPO):** `< 5 minutes` in production via Amazon RDS PostgreSQL Continuous Write-Ahead Log (WAL) archiving to S3 (Point-In-Time Recovery / PITR).
- **Recovery Time Objective (RTO):** `< 15 minutes` via Amazon RDS Multi-AZ standby automatic failover (`< 60–120 seconds` for compute/storage failover).

---

## 2. Three-Tier Backup Strategy

1. **Tier 1 — Continuous Physical WAL & Automated Snapshots (Production AWS RDS):**
   - Multi-AZ synchronous standby replication across two Availability Zones.
   - Automated daily snapshots with **35-day retention** encrypted with customer-managed AWS KMS key (`alias/hos-rds-kms`).
   - AWS Backup vault with **vault lock (WORM)** copying weekly snapshots cross-region.
2. **Tier 2 — Per-Schema Logical Backups (`pg_dump`):**
   - Because each microservice owns an isolated schema (`identity`, `hospital_core`, `clinical`, `diagnostics_pharmacy`, `operations_billing`), logical dumps can be taken and restored independently without rolling back other domains.
   - Executed via [`scripts/db-backup.ps1`](file:///c:/Users/Pranjal/OneDrive/Desktop/Emerald%20Windows/My_Projects/HOS%20-%20Antigravity/scripts/db-backup.ps1), producing SHA-256 checksum manifests (`.sql.sha256`).
3. **Tier 3 — S3 Medical Document Versioning & Object Lock:**
   - S3 bucket versioning enabled with KMS encryption and lifecycle transition to S3 Glacier Instant Retrieval after 365 days.

---

## 3. Execution Commands (Local & Containerized Verification)

### Run Per-Schema Verified Backup
```powershell
.\scripts\db-backup.ps1 -BackupDir ".\backups\postgres" -ContainerName "hos-postgres"
```

### Verify SHA-256 Checksum & Restore a Schema
```powershell
.\scripts\db-restore.ps1 -DumpFile ".\backups\postgres\hos_clinical_<TIMESTAMP>.sql" -ContainerName "hos-postgres"
```

