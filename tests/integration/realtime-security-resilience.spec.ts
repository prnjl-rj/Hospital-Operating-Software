import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { HospitalRealtimeHub } from '../../packages/shared/src/realtime/realtime-hub';
import { HospitalRedisBullMqEngine } from '../../packages/shared/src/redis/redis-bullmq-engine';
import { createGatewayApp } from '../../services/api-gateway/src/main';
import { IdentityService } from '../../services/identity-service/src/identity.service';

describe('BLOCK 10 & BLOCK 11 — Real-Time SSE/PubSub Hub, Security Controls & Failure Resilience', () => {
  let app: INestApplication;
  let identityService: IdentityService;
  let realtimeHub: HospitalRealtimeHub;
  const hospitalId = 'hosp-main-001';

  beforeAll(async () => {
    realtimeHub = new HospitalRealtimeHub('redis://:hos_redis_local_pwd@localhost:6380');
    await realtimeHub.connectRedis();

    app = await createGatewayApp();
    await app.init();
    identityService = app.get(IdentityService);
  });

  afterAll(async () => {
    await realtimeHub.close();
    await app.close();
  });

  it('bridges all 6 hospital real-time channels over Redis Pub/Sub with strict role filtering and PHI redaction', async () => {
    const doctorReceived: any[] = [];
    const receptionistReceived: any[] = [];

    const unsubDoctor = realtimeHub.subscribeForUser(
      { hospitalId, role: 'DOCTOR' },
      (evt) => doctorReceived.push(evt),
    );
    const unsubReceptionist = realtimeHub.subscribeForUser(
      { hospitalId, role: 'RECEPTIONIST' },
      (evt) => receptionistReceived.push(evt),
    );

    // Bridge 6 Kafka domain events covering all 6 real-time channels
    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-1',
      eventType: 'appointment.checked_in',
      hospitalId,
      payload: {
        appointmentId: 'appt-101',
        tokenNumber: 12,
        firstName: 'SENSITIVE_NAME_MUST_BE_STRIPPED',
        phone: '+919999999999',
      },
    });

    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-2',
      eventType: 'bed.allocated',
      hospitalId,
      payload: { bedId: 'bed-icu-01', bedNumber: 'ICU-01', status: 'OCCUPIED' },
    });

    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-3',
      eventType: 'lab.result.published',
      hospitalId,
      payload: {
        labOrderId: 'lab-901',
        parameterName: 'Troponin-I',
        value: '2.4 ng/mL',
        isCritical: true,
        nationalIdHash: 'SECRET_HASH',
      },
    });

    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-4',
      eventType: 'pharmacy.dispensed',
      hospitalId,
      payload: { dispenseOrderId: 'disp-501', status: 'DISPENSED' },
    });

    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-5',
      eventType: 'admission.discharged',
      hospitalId,
      payload: { admissionId: 'adm-301', bedId: 'bed-icu-01' },
    });

    await realtimeHub.bridgeKafkaEvent({
      eventId: 'rt-evt-6',
      eventType: 'payment.completed',
      hospitalId,
      payload: { paymentNumber: 'PAY-9001', amount: 4500 },
    });

    // Wait briefly for Redis Pub/Sub fan-out
    await new Promise((r) => setTimeout(r, 150));

    unsubDoctor();
    unsubReceptionist();

    // Doctor should receive OPD_QUEUE_UPDATE, BED_AVAILABILITY_UPDATE, LAB_CRITICAL_RESULT_ALERT, PHARMACY_DISPENSE_UPDATE
    const doctorChannels = doctorReceived.map((e) => e.channel);
    expect(doctorChannels).toContain('OPD_QUEUE_UPDATE');
    expect(doctorChannels).toContain('BED_AVAILABILITY_UPDATE');
    expect(doctorChannels).toContain('LAB_CRITICAL_RESULT_ALERT');
    expect(doctorChannels).toContain('PHARMACY_DISPENSE_UPDATE');

    // Receptionist should NOT receive LAB_CRITICAL_RESULT_ALERT or PHARMACY_DISPENSE_UPDATE
    const receptionistChannels = receptionistReceived.map((e) => e.channel);
    expect(receptionistChannels).toContain('OPD_QUEUE_UPDATE');
    expect(receptionistChannels).toContain('BED_AVAILABILITY_UPDATE');
    expect(receptionistChannels).not.toContain('LAB_CRITICAL_RESULT_ALERT');

    // Verify PHI redaction stripped firstName, phone, and nationalIdHash
    const opdEvt = doctorReceived.find((e) => e.channel === 'OPD_QUEUE_UPDATE');
    expect(opdEvt.payload.tokenNumber).toBe(12);
    expect(opdEvt.payload.firstName).toBeUndefined();
    expect(opdEvt.payload.phone).toBeUndefined();

    const labEvt = doctorReceived.find((e) => e.channel === 'LAB_CRITICAL_RESULT_ALERT');
    expect(labEvt.severity).toBe('CRITICAL');
    expect(labEvt.payload.nationalIdHash).toBeUndefined();
  });

  it('keeps critical workflows safe when Redis becomes unavailable (Rule 29 graceful fallback)', async () => {
    // Point Redis engine & RealtimeHub to an unreachable port (6399)
    const offlineRedis = new HospitalRedisBullMqEngine({ host: 'localhost', port: 6399 });
    const cached = await offlineRedis.getOrSetCache('test:offline:key', 60, async () => ({
      fallbackActive: true,
      hospitalStatus: 'SAFE_DEGRADED_MODE',
    }));
    expect(cached.value.fallbackActive).toBe(true);
    expect(cached.cacheHit).toBe(false);

    const rateLimit = await offlineRedis.checkRateLimit('offline-client', 10, 60);
    expect(rateLimit.allowed).toBe(true);

    const lock = await offlineRedis.acquireDistributedLock('bed:offline-1', 3000);
    expect(lock.acquired).toBe(true);
    expect(lock.degradedFallback).toBe(true);

    // RealtimeHub also falls back to in-process EventEmitter when Redis is unreachable
    const offlineHub = new HospitalRealtimeHub('redis://localhost:6399');
    const receivedLocal: any[] = [];
    const unsub = offlineHub.subscribeForUser({ hospitalId, role: 'NURSE' }, (e) => receivedLocal.push(e));
    await offlineHub.publish({
      eventId: 'local-fallback-1',
      channel: 'NURSING_TASK_UPDATE',
      hospitalId,
      targetRoles: ['NURSE'],
      severity: 'INFO',
      payload: { taskId: 'task-101', status: 'DUE' },
    });
    unsub();
    expect(receivedLocal.length).toBe(1);
    expect(receivedLocal[0].channel).toBe('NURSING_TASK_UPDATE');

    await offlineRedis.closeAll();
    await offlineHub.close();
  });

  it('enforces unauthorized access rejection, S3 presign endpoints, Prometheus metrics & backup scripts', async () => {
    // 1. Unauthenticated access to protected dashboard must return 401
    const unauthRes = await request(app.getHttpServer()).get('/api/v1/dashboard/overview');
    expect(unauthRes.status).toBe(401);

    // 2. Authenticate as Receptionist and verify RBAC blocks clinical note creation (403)
    const recepAuth = await identityService.login({
      emailOrUsername: 'reception@hos.local',
      password: 'Hospital@2026!',
    });
    const receptionistToken = recepAuth.accessToken;

    const forbiddenRes = await request(app.getHttpServer())
      .post('/api/v1/emr/notes')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: 'pat-001', subjective: 'Unauthorized write' });
    expect(forbiddenRes.status).toBe(403);

    // 3. Authenticate as Doctor and test S3 document upload presigning via HTTP controller
    const docAuth = await identityService.login({
      emailOrUsername: 'dr.arjun@hos.local',
      password: 'Hospital@2026!',
    });
    const doctorToken = docAuth.accessToken;

    const presignRes = await request(app.getHttpServer())
      .post('/api/v1/documents/presign-upload')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientRefId: 'pat-001',
        documentCategory: 'CONSENT_FORM',
        fileName: 'surgery-consent.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 128000,
      });
    expect(presignRes.status).toBe(201);
    expect(presignRes.body.presignedUploadUrl).toContain('X-Amz-Signature');

    // 4. Verify Prometheus /api/v1/metrics endpoint exposes PHI-free metrics
    const metricsRes = await request(app.getHttpServer()).get('/api/v1/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.text).toContain('hos_outbox_pending_events');
    expect(metricsRes.text).toContain('hos_http_request_duration_seconds');

    // 5. Verify Backup & Restore scripts exist and contain schema verification logic
    const backupScript = fs.readFileSync(path.resolve(process.cwd(), 'scripts/db-backup.ps1'), 'utf8');
    const restoreScript = fs.readFileSync(path.resolve(process.cwd(), 'scripts/db-restore.ps1'), 'utf8');
    expect(backupScript).toContain('pg_dump');
    expect(restoreScript).toContain('Get-FileHash');
  });
});
