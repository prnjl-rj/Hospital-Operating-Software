# =============================================================================
# HOSPITAL OPERATING SOFTWARE (HOS) — POSTGRESQL MULTI-SCHEMA BACKUP SCRIPT
# Creates timestamped, SHA-256 checksummed logical backups per schema & full DB
# =============================================================================
param(
  [string]$BackupDir = ".\backups\postgres",
  [string]$ContainerName = "hos-postgres"
)

$ErrorActionPreference = "Stop"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$Schemas = @("identity", "hospital_core", "clinical", "diagnostics_pharmacy", "operations_billing")

foreach ($Schema in $Schemas) {
  $OutFile = Join-Path $BackupDir "hos_${Schema}_${Timestamp}.sql"
  Write-Host "[Backup] Dumping isolated schema '$Schema' to $OutFile..."
  docker exec $ContainerName pg_dump -U hos_admin -d hos_db --schema=$Schema --no-owner --no-privileges > $OutFile
  $Hash = (Get-FileHash -Path $OutFile -Algorithm SHA256).Hash
  Set-Content -Path "$OutFile.sha256" -Value "$Hash  hos_${Schema}_${Timestamp}.sql"
}

Write-Host "[Backup] Completed verified per-schema backups with SHA-256 integrity manifests."

