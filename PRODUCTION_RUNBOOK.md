# HOSPITAL OPERATING SOFTWARE (HOS) — PRODUCTION RUNBOOK (`PRODUCTION_RUNBOOK.md`)

## 1. Standard Operating Procedures (SOPs) for Hospital SREs

### SOP-01: Daily Health & Audit Integrity Verification
1. Query API Gateway health across all 5 PostgreSQL schemas:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:4000/api/v1/gateway/health"
   ```
2. Verify cryptographic SHA-256 hash chain integrity of `identity."AuditLog"`:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:4000/api/v1/audit/verify-integrity/hosp-main-001" -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" }
   ```

### SOP-02: Zero-Downtime Rolling Deployment & Emergency Rollback
```powershell
# Rolling Upgrade with Atomic Rollback
helm upgrade --install hos-prod ./infrastructure/helm/hos-chart -n hos-prod --atomic --timeout 5m

# Manual Emergency Rollback
helm rollback hos-prod -n hos-prod
```

### SOP-03: Dead-Letter Queue (`.dlq`) Inspection & Replay
1. Open Kafka UI (`http://localhost:8085`) or query `hos_kafka_dlq_events_total` in Prometheus (`http://localhost:9095`).
2. Inspect the failed message headers (`x-dlq-reason`, `x-original-topic`, `x-correlation-id`).
3. After resolving the downstream issue, replay the payload to the primary topic; `ProcessedEvent` deduplication ensures already-succeeded consumers never double-process the event.

### SOP-04: Database Backup & Verified Restoration
```powershell
# Execute Per-Schema Backup + SHA-256 Checksum Generation
powershell -ExecutionPolicy Bypass -File ./scripts/db-backup.ps1

# Verify Checksum & Restore
powershell -ExecutionPolicy Bypass -File ./scripts/db-restore.ps1 -DumpFile ./backups/<filename>.sql
```

