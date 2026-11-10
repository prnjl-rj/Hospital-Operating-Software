# HOSPITAL OPERATING SOFTWARE (HOS) — TROUBLESHOOTING GUIDE (`TROUBLESHOOTING.md`)

## 1. Common Local & Production Diagnostic Procedures

### Issue 1: Host Port Conflict When Starting `docker compose up -d`
- **Symptom:** `Bind for 0.0.0.0:xxxx failed: port is already allocated`.
- **Resolution:** HOS is preconfigured to use collision-free ports (`5435` for PostgreSQL, `6380` for Redis, `9094` for Kafka, `8085` for Kafka UI, `9095` for Prometheus, `9096` for Alertmanager, `3035` for Grafana, `4000-4005` for NestJS services, `5175` for Vite frontend). Check `.env` and `docker compose ps`.

### Issue 2: Signed Clinical Note Update Rejected (`IMMUTABLE_SIGNED_CLINICAL_NOTE`)
- **Symptom:** `PATCH` or SQL `UPDATE` on `clinical."ClinicalNote"` fails after a doctor signs the note.
- **Resolution:** By design (**Rule 28**), signed clinical notes are legally immutable at both the NestJS service layer and PostgreSQL trigger (`trg_prevent_signed_clinical_note_mutation`). Use `POST /api/v1/emr/notes/:id/addendum` to append a timestamped clinical addendum.

### Issue 3: Transactional Outbox Backlog Growing (`HosOutboxBacklogHigh`)
- **Symptom:** Prometheus alert `HosOutboxBacklogHigh` fires (`hos_outbox_pending_events > 100`).
- **Resolution:**
  1. Check `hos-kafka` broker health: `docker compose ps kafka`.
  2. Inspect Kafka UI at `http://localhost:8085` for `.dlq` poison messages.
  3. Trigger outbox drainage via `KafkaOutboxEngine.drainOutboxBatch()`.

### Issue 4: Redis Unavailable or Degraded
- **Symptom:** Redis connection timeout on `:6380`.
- **Resolution:** Per **Rule 29**, HOS automatically degrades gracefully: `HospitalRedisBullMqEngine` falls back to PostgreSQL queries and unique constraints, and `HospitalRealtimeHub` falls back to in-process `EventEmitter` until `hos-redis` recovers.

