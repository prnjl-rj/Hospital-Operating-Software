# BLOCK 08 — Redis & BullMQ Implementation (`REDIS_IMPLEMENTATION.md`)

## 1. Redis 7 Architecture & Security Boundaries

Redis (`redis:7-alpine`, container `hos-redis` on `:6380`, internal `redis:6379`) is configured with:
- **Authentication:** Mandatory `--requirepass` (`REDIS_PASSWORD`).
- **Persistence:** Append-Only File (`--appendonly yes`) persisted to Docker volume `hos_redisdata`.
- **Healthcare Safety Boundary (Rule 14 & Rule 29):**
  - Redis is **never** used as the primary system of record for clinical, inventory, patient, or financial transactions.
  - Sensitive patient narratives are never stored in Redis cache keys.
  - If Redis becomes unreachable, `HospitalRedisBullMqEngine.getOrSetCache()` and `checkRateLimit()` automatically degrade gracefully to PostgreSQL so clinical care is never interrupted.

---

## 2. Implemented Capabilities ([`packages/shared/src/redis/redis-bullmq-engine.ts`](file:///c:/Users/Pranjal/OneDrive/Desktop/Emerald%20Windows/My_Projects/HOS%20-%20Antigravity/packages/shared/src/redis/redis-bullmq-engine.ts))

1. **Read-Through Caching & Pattern Invalidation (`getOrSetCache`, `invalidateCachePattern`):**
   - Caches high-read, non-PHI operational views (`hos:cache:topology:<hospitalId>`, `hos:cache:kpis:<hospitalId>`) with explicit TTLs (`60s–300s`) and invalidates immediately on configuration updates.
2. **API Rate Limiting (`checkRateLimit`):**
   - Atomic `INCR` + `EXPIRE` counter per IP/User (`hos:ratelimit:<id>`) protecting authentication and public endpoints against brute-force floods.
3. **Distributed Coordination Locks (`acquireDistributedLock`, `releaseDistributedLock`):**
   - Atomic `SET <key> <token> PX <ttl> NX` and Lua-verified token release preventing concurrent double-allocation of beds or appointment slots.
4. **BullMQ Background Job Queues (`enqueueBackgroundJob`, `registerIdempotentWorker`):**
   - Queues: `hos-notifications-queue`, `hos-reports-queue`, `hos-documents-queue`.
   - Exponential backoff retry policy (`attempts: 3`, `delay: 150ms`), failed-job retention (`removeOnFail: false` for dead-letter inspection), and `jobId` idempotency deduplication.

