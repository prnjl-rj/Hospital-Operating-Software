# HOSPITAL OPERATING SOFTWARE (HOS) — PROMETHEUS & ALERTMANAGER CONFIGURATION

## 1. Scrape Configuration (`monitoring/prometheus/prometheus.yml`)
Prometheus scrapes metrics every `15s` (evaluation interval `15s`) across:
- `prometheus` (`localhost:9090` internal / `localhost:9095` host)
- `hos-microservices` (`host.docker.internal:4000` -> `/api/v1/metrics`)

## 2. Alert Rules (`monitoring/prometheus/alert-rules.yml`)
Prometheus continuously evaluates 5 production-critical hospital alert rules and dispatches firing alerts to **Alertmanager** (`monitoring/alertmanager/alertmanager.yml`):

| Alert Name | Expression | For | Severity | Operational Action |
|---|---|---|---|---|
| `HosServiceDown` | `up == 0` | `1m` | `critical` | Page on-call SRE; inspect pod logs and readiness probes. |
| `HosHighHttpErrorRate` | `rate(hos_http_errors_total{status_code=~"5.."}[5m]) > 0.05` | `2m` | `critical` | Inspect API Gateway and downstream PostgreSQL/Kafka health. |
| `HosHighApiLatencyP95` | `histogram_quantile(0.95, sum(rate(hos_http_request_duration_seconds_bucket[5m])) by (le, service)) > 1.5` | `3m` | `warning` | Check slow SQL queries, Redis cache hit rate, or HPA scaling. |
| `HosOutboxBacklogHigh` | `hos_outbox_pending_events > 100` | `2m` | `warning` | Check `KafkaOutboxEngine` poller and KRaft broker connectivity. |
| `HosKafkaDlqMessagesDetected` | `increase(hos_kafka_dlq_events_total[5m]) > 0` | `0m` | `critical` | Inspect `<topic>.dlq` payload in Kafka UI (`:8085`) and replay after fix. |

