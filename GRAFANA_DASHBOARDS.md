# HOSPITAL OPERATING SOFTWARE (HOS) — GRAFANA DASHBOARDS CATALOGUE

## 1. Provisioned Dashboards Overview
Grafana (`http://localhost:3035`) automatically provisions the Prometheus datasource (`monitoring/grafana/provisioning/datasources/datasources.yml`) and the **10-Domain Hospital Operations Suite** (`monitoring/grafana/provisioning/dashboards/hos-enterprise-dashboards.json`).

## 2. The 10 Required Dashboard Domains
1. **Executive Hospital Operations:** Real-time bed occupancy gauge (`hos_bed_occupancy_ratio`), active IPD admissions, OPD wait queue depth, and daily revenue collection velocity.
2. **Microservice Health:** Per-service request rate (`rate(hos_http_requests_total[5m])`), uptime status across all 6 NestJS services, and health readiness probes.
3. **API Gateway Performance:** P50, P95, and P99 latency histograms (`histogram_quantile(0.95, ...)`), upstream timeout rates, and rate-limiter rejection counts.
4. **Clinical and Operational Activity:** Critical laboratory alert counter (`hos_critical_lab_alerts_total`), signed SOAP notes velocity, and emergency triage volume.
5. **Database Performance:** Transactional Outbox backlog per PostgreSQL schema (`hos_outbox_pending_events`), active connection pool utilization, and query latency.
6. **Kafka Health and Consumer Lag:** Dead-letter queue event counter (`hos_kafka_dlq_events_total`), topic partition throughput, and consumer group lag.
7. **Redis and Queue Performance:** BullMQ background job throughput (`hos_bullmq_jobs_processed_total`), Redis cache hit/miss ratio, and distributed lock contention.
8. **Infrastructure and Kubernetes:** Node.js event loop lag (`hos_node_nodejs_eventloop_lag_seconds`), V8 heap memory utilization, CPU usage, and pod restart counts.
9. **Security and Authentication:** Real-time spike detection for `401 Unauthorized` and `403 Forbidden` responses (`hos_http_errors_total{status_code=~"401|403"}`), MFA verification failures, and refresh-token replay revocations.
10. **Alert Overview:** Live table of firing and pending Prometheus alerts (`ALERTS{alertstate="firing"}`) routed to Alertmanager (`http://localhost:9096`).

