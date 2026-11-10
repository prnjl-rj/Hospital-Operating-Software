# HOSPITAL OPERATING SOFTWARE (HOS) — MONITORING & OBSERVABILITY GUIDE

## 1. Observability Stack Architecture
The Hospital Operating Software implements full-stack observability across metrics, logs, traces, and alerts while strictly enforcing **Rule 14** (Zero PHI in logs, metric labels, or trace spans):

| Pillar | Technology | Local Endpoint | Production Target |
|---|---|---|---|
| **Metrics** | Prometheus (`prom-client`) | `http://localhost:9095` | Amazon Managed Prometheus / EKS Prometheus Operator |
| **Dashboards** | Grafana 11 | `http://localhost:3035` | Amazon Managed Grafana / EKS Grafana |
| **Alert Routing** | Alertmanager | `http://localhost:9096` | Alertmanager -> PagerDuty / Slack / AWS SNS |
| **Distributed Tracing** | OpenTelemetry W3C `traceparent` + `X-Correlation-Id` | Propagated across all 6 NestJS services & Kafka headers | Grafana Tempo / AWS X-Ray |
| **Structured Logs** | JSON Structured Logs (PHI-redacted) | Container stdout/stderr | Grafana Loki / Amazon CloudWatch Logs |

---

## 2. Custom Hospital & Technical Metrics (`/api/v1/metrics`)
Implemented in `packages/shared/src/observability/telemetry.ts` and exposed on `GET /api/v1/metrics`:
- `hos_http_request_duration_seconds`: Histogram of HTTP request latency (`service`, `method`, `route`, `status_code`).
- `hos_http_requests_total`: Counter of total HTTP requests processed.
- `hos_http_errors_total`: Counter of `4xx` and `5xx` error responses (used for security brute-force and RBAC violation alerting).
- `hos_outbox_pending_events`: Gauge of pending transactional outbox rows across all 4 domain schemas (`hospital_core`, `clinical`, `diagnostics_pharmacy`, `operations_billing`).
- `hos_kafka_dlq_events_total`: Counter of poison events routed to `.dlq` topics (`topic`, `consumer_group`).
- `hos_bullmq_jobs_processed_total`: Counter of background jobs processed by BullMQ workers (`queue`, `status`).
- `hos_critical_lab_alerts_total`: Counter of critical laboratory alerts dispatched per `hospital_id`.
- `hos_bed_occupancy_ratio`: Gauge of current hospital bed occupancy ratio (`0.0` to `1.0`).

---

## 3. W3C Distributed Trace & Correlation Propagation
Every incoming HTTP request at `api-gateway` is assigned or propagates:
- `traceparent`: W3C Trace Context header (`00-<traceId>-<spanId>-01`)
- `X-Correlation-Id`: Unique request correlation identifier (`corr-<uuid>`)
These headers are automatically copied into:
1. Internal gRPC/REST service-to-service calls.
2. PostgreSQL `OutboxEvent.correlationId` and `identity.AuditLog.correlationId`.
3. Kafka message headers (`x-correlation-id`, `traceparent`).

