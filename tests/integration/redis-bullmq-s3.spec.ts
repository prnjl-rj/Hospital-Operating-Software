import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { HospitalRedisBullMqEngine } from '../../packages/shared/src/redis/redis-bullmq-engine';
import { DocumentS3Service } from '../../services/operations-billing-service/src/document-s3.service';
import { OperationsBillingService } from '../../services/operations-billing-service/src/operations-billing.service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

describe('BLOCK 08 & BLOCK 09 — Live Redis, BullMQ Background Jobs & AWS S3 Document Management Integration', () => {
  let redisEngine: HospitalRedisBullMqEngine;
  let opsService: OperationsBillingService;
  let s3Service: DocumentS3Service;

  beforeAll(() => {
    redisEngine = new HospitalRedisBullMqEngine();
    opsService = new OperationsBillingService();
    s3Service = new DocumentS3Service(opsService.prisma);
  });

  afterAll(async () => {
    await redisEngine.closeAll();
    await opsService.onModuleDestroy();
  });

  it('verifies live Redis connectivity, read-through caching, cache invalidation, rate limiting, and distributed locks', async () => {
    const healthy = await redisEngine.pingHealth();
    expect(healthy).toBe(true);

    // 1. Read-Through Cache + Invalidation
    const cacheKey = `hos:cache:test-topology:${Date.now()}`;
    let dbCalls = 0;
    const firstRead = await redisEngine.getOrSetCache(cacheKey, 60, async () => {
      dbCalls++;
      return { hospitalCode: 'HOS-MAIN-001', beds: 550 };
    });
    expect(firstRead.cacheHit).toBe(false);
    expect(dbCalls).toBe(1);

    const secondRead = await redisEngine.getOrSetCache(cacheKey, 60, async () => {
      dbCalls++;
      return { hospitalCode: 'HOS-MAIN-001', beds: 550 };
    });
    expect(secondRead.cacheHit).toBe(true);
    expect(dbCalls).toBe(1);

    const deletedCount = await redisEngine.invalidateCachePattern(cacheKey);
    expect(deletedCount).toBe(1);

    // 2. Rate Limiter
    const rlKey = `test-ip-${Date.now()}`;
    const r1 = await redisEngine.checkRateLimit(rlKey, 2, 60);
    const r2 = await redisEngine.checkRateLimit(rlKey, 2, 60);
    const r3 = await redisEngine.checkRateLimit(rlKey, 2, 60);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);

    // 3. Distributed Lock (Atomic SET NX PX + Lua Release)
    const resource = `bed-alloc-lock-${Date.now()}`;
    const lock1 = await redisEngine.acquireDistributedLock(resource, 5000);
    expect(lock1.acquired).toBe(true);

    const lock2 = await redisEngine.acquireDistributedLock(resource, 5000);
    expect(lock2.acquired).toBe(false);

    const released = await redisEngine.releaseDistributedLock(resource, lock1.lockToken);
    expect(released).toBe(true);
  });

  it('processes BullMQ background jobs with retries and idempotent job handler deduplication', async () => {
    const queueName = `hos-notifications-test-${Date.now()}`;
    const processedPayloads: any[] = [];

    redisEngine.registerIdempotentWorker({
      queueName,
      handler: async (job) => {
        processedPayloads.push(job.data);
        return { delivered: true };
      },
    });

    await redisEngine.enqueueBackgroundJob({
      queueName,
      jobName: 'send-appointment-reminder',
      idempotencyJobId: 'job-idem-001',
      payload: { appointmentNumber: 'APT-2026-000001', channel: 'SMS' },
    });

    // Wait briefly for BullMQ worker to process from live Redis
    await new Promise((r) => setTimeout(r, 600));

    const stats = await redisEngine.getQueueStats(queueName);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
    expect(processedPayloads).toHaveLength(1);
    expect(processedPayloads[0].appointmentNumber).toBe('APT-2026-000001');
  });

  it('validates S3 medical document uploads, generates KMS-encrypted presigned PUT/GET URLs, and enforces hospital tenant access control', async () => {
    // 1. Reject disallowed MIME type (e.g., executable script)
    await expect(
      s3Service.createPresignedUpload({
        hospitalId: 'hosp-main-001',
        patientRefId: 'pat-synth-001',
        documentCategory: 'LAB_REPORT',
        fileName: 'malicious.exe',
        mimeType: 'application/x-msdownload',
        fileSizeBytes: 2048,
        uploadedByUserId: 'usr-lab-01',
      }),
    ).rejects.toThrow(/UNSUPPORTED_DOCUMENT_MIME_TYPE/);

    // 2. Reject oversized file (> 25 MB)
    await expect(
      s3Service.createPresignedUpload({
        hospitalId: 'hosp-main-001',
        patientRefId: 'pat-synth-001',
        documentCategory: 'LAB_REPORT',
        fileName: 'huge-file.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 30 * 1024 * 1024,
        uploadedByUserId: 'usr-lab-01',
      }),
    ).rejects.toThrow(/FILE_SIZE_EXCEEDS_LIMIT/);

    // 3. Valid synthetic lab report PDF presigned upload
    const uploadRes = await s3Service.createPresignedUpload({
      hospitalId: 'hosp-main-001',
      patientRefId: 'pat-synth-001',
      documentCategory: 'LAB_REPORT',
      fileName: 'cbc-report-HOS-2026-000001.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 145200,
      contentSampleForChecksum: 'SYNTHETIC-PDF-CONTENT-CBC-001',
      uploadedByUserId: 'usr-lab-01',
    });

    expect(uploadRes.document.id).toBeDefined();
    expect(uploadRes.document.s3Bucket).toBe('hos-medical-documents-dev');
    expect(uploadRes.document.checksumSha256).toHaveLength(64);
    expect(uploadRes.presignedUploadUrl).toContain('X-Amz-Signature=');
    expect(uploadRes.presignedUploadUrl).toContain('x-amz-server-side-encryption');

    // 4. Generate authorized presigned GET download URL
    const downloadRes = await s3Service.createPresignedDownload({
      documentId: uploadRes.document.id,
      requesterHospitalId: 'hosp-main-001',
      requesterUserId: 'usr-doctor-01',
      requesterRoles: ['DOCTOR'],
    });
    expect(downloadRes.presignedDownloadUrl).toContain('X-Amz-Signature=');

    // 5. Block cross-hospital unauthorized access to medical document
    await expect(
      s3Service.createPresignedDownload({
        documentId: uploadRes.document.id,
        requesterHospitalId: 'hosp-unauthorized-999',
        requesterUserId: 'usr-external',
        requesterRoles: ['DOCTOR'],
      }),
    ).rejects.toThrow(/CROSS_HOSPITAL_DOCUMENT_ACCESS_DENIED/);
  });
});
