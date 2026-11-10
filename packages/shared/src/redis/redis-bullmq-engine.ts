import Redis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { randomUUID } from 'node:crypto';

export interface RedisConnectionOptions {
  host?: string;
  port?: number;
  password?: string;
}

export class HospitalRedisBullMqEngine {
  public readonly redis: Redis;
  private readonly connectionConfig: { host: string; port: number; password?: string; maxRetriesPerRequest: null };
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly processedJobIds = new Set<string>();

  constructor(opts: RedisConnectionOptions = {}) {
    const host = opts.host || process.env.REDIS_HOST || 'localhost';
    const port = Number(opts.port || process.env.REDIS_PORT || 6380);
    const password = opts.password || process.env.REDIS_PASSWORD || 'hos_redis_local_pwd';

    this.connectionConfig = {
      host,
      port,
      password,
      maxRetriesPerRequest: null,
    };

    this.redis = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 500)),
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => {
      // Suppress unhandled error events during Redis failover/outage tests (Rule 29)
    });
  }

  async pingHealth(): Promise<boolean> {
    try {
      const res = await this.redis.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // 1. Safe Read-Through Cache with Explicit TTL & Graceful Degradation (Rule 29)
  // Never caches raw clinical notes or sensitive PHI; used for topology/catalog/KPIs
  // ===========================================================================
  async getOrSetCache<T>(
    cacheKey: string,
    ttlSeconds: number,
    fallbackFetcher: () => Promise<T>,
  ): Promise<{ value: T; cacheHit: boolean }> {
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return { value: JSON.parse(cached) as T, cacheHit: true };
      }
    } catch {
      // Degrade gracefully to PostgreSQL fetcher if Redis is temporarily unavailable
    }

    const freshValue = await fallbackFetcher();

    try {
      await this.redis.set(cacheKey, JSON.stringify(freshValue), 'EX', ttlSeconds);
    } catch {
      // Ignore cache write error on degraded Redis
    }

    return { value: freshValue, cacheHit: false };
  }

  async invalidateCachePattern(prefix: string): Promise<number> {
    try {
      const keys = await this.redis.keys(`${prefix}*`);
      if (keys.length === 0) return 0;
      return await this.redis.del(...keys);
    } catch {
      return 0;
    }
  }

  // ===========================================================================
  // 2. Sliding-Window / Fixed-Window API Rate Limiter
  // ===========================================================================
  async checkRateLimit(
    identifier: string,
    maxRequests = 100,
    windowSeconds = 60,
  ): Promise<{ allowed: boolean; currentCount: number; remaining: number }> {
    const key = `hos:ratelimit:${identifier}`;
    try {
      const currentCount = await this.redis.incr(key);
      if (currentCount === 1) {
        await this.redis.expire(key, windowSeconds);
      }
      const allowed = currentCount <= maxRequests;
      return {
        allowed,
        currentCount,
        remaining: Math.max(maxRequests - currentCount, 0),
      };
    } catch {
      // Fail-open for critical clinical workflows if Redis is down (Rule 29)
      return { allowed: true, currentCount: 0, remaining: maxRequests };
    }
  }

  // ===========================================================================
  // 3. Distributed Coordination Lock (Atomic SET NX PX + Lua Safe Release)
  // Prevents concurrent bed allocation / appointment slot race conditions
  // ===========================================================================
  async acquireDistributedLock(
    resourceName: string,
    ttlMs = 5000,
  ): Promise<{ acquired: boolean; lockToken: string; degradedFallback?: boolean }> {
    const lockKey = `hos:lock:${resourceName}`;
    const lockToken = randomUUID();
    try {
      const res = await this.redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX');
      return { acquired: res === 'OK', lockToken };
    } catch {
      // When Redis is unreachable, allow transactional PostgreSQL row/unique constraint to act as safety net (Rule 29)
      return { acquired: true, lockToken, degradedFallback: true };
    }
  }

  async releaseDistributedLock(resourceName: string, lockToken: string): Promise<boolean> {
    const lockKey = `hos:lock:${resourceName}`;
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const res = await this.redis.eval(luaScript, 1, lockKey, lockToken);
    return res === 1;
  }

  // ===========================================================================
  // 4. BullMQ Background Job Queues with Retries, DLQ Retention & Idempotency
  // ===========================================================================
  getOrCreateQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this.connectionConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 150,
          },
          removeOnComplete: 100,
          removeOnFail: false, // Retain failed jobs for dead-letter inspection & replay
        },
      });
      this.queues.set(queueName, queue);
    }
    return this.queues.get(queueName)!;
  }

  async enqueueBackgroundJob<T = Record<string, unknown>>(params: {
    queueName: string;
    jobName: string;
    idempotencyJobId: string;
    payload: T;
  }) {
    const queue = this.getOrCreateQueue(params.queueName);
    return queue.add(params.jobName, params.payload, {
      jobId: params.idempotencyJobId,
    });
  }

  registerIdempotentWorker<T = Record<string, unknown>>(params: {
    queueName: string;
    handler: (job: Job<T>) => Promise<unknown>;
  }): Worker {
    const worker = new Worker<T>(
      params.queueName,
      async (job) => {
        const dedupKey = `hos:bullmq:processed:${params.queueName}:${job.id}`;
        const alreadyDone = await this.redis.get(dedupKey);
        if (alreadyDone || this.processedJobIds.has(`${params.queueName}:${job.id}`)) {
          return { skippedDuplicate: true };
        }

        const result = await params.handler(job);
        this.processedJobIds.add(`${params.queueName}:${job.id}`);
        await this.redis.set(dedupKey, '1', 'EX', 86400);
        return result;
      },
      { connection: this.connectionConfig },
    );
    this.workers.push(worker);
    return worker;
  }

  async getQueueStats(queueName: string) {
    const queue = this.getOrCreateQueue(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return counts;
  }

  async closeAll(): Promise<void> {
    for (const w of this.workers) {
      await w.close().catch(() => {});
    }
    for (const q of this.queues.values()) {
      await q.close().catch(() => {});
    }
    await this.redis.quit().catch(() => {});
  }
}
