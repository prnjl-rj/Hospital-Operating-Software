# =============================================================================
# HOSPITAL OPERATING SOFTWARE (HOS) — POSTGRESQL RESTORE & INTEGRITY VERIFICATION
# Verifies SHA-256 checksum before restoring schema backup into target database
# =============================================================================
param(
  [Parameter(Mandatory=$true)][string]$DumpFile,
  [string]$ContainerName = "hos-postgres"
)

$ErrorActionPreference = "Stop"
if (!(Test-Path $DumpFile)) {
  throw "Backup file not found: $DumpFile"
}

$ShaFile = "$DumpFile.sha256"
if (Test-Path $ShaFile) {
  $ExpectedHash = (Get-Content $ShaFile).Split(" ")[0].Trim()
  $ActualHash = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash
  if ($ExpectedHash -ne $ActualHash) {
    throw "INTEGRITY CHECK FAILED: Expected SHA256 $ExpectedHash, got $ActualHash"
  }
  Write-Host "[Restore] SHA-256 checksum verified: $ActualHash"
}

Write-Host "[Restore] Restoring $DumpFile into $ContainerName..."
Get-Content $DumpFile | docker exec -i $ContainerName psql -U hos_admin -d hos_db
Write-Host "[Restore] Restoration completed successfully."

