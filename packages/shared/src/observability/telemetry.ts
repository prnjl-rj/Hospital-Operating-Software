import client from 'prom-client';
import { randomUUID } from 'crypto';

export class HospitalObservabilityRegistry {
  public readonly registry: client.Registry;
  public readonly httpRequestDurationSeconds: client.Histogram<string>;
  public readonly httpRequestsTotal: client.Counter<string>;
  public readonly httpErrorsTotal: client.Counter<string>;
  public readonly outboxPendingEventsGauge: client.Gauge<string>;
  public readonly kafkaDlqEventsTotal: client.Counter<string>;
  public readonly bullmqJobsProcessedTotal: client.Counter<string>;
  public readonly criticalLabAlertsTotal: client.Counter<string>;
  public readonly bedOccupancyRatioGauge: client.Gauge<string>;

  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({
      register: this.registry,
      prefix: 'hos_node_',
    });

    this.httpRequestDurationSeconds = new client.Histogram({
      name: 'hos_http_request_duration_seconds',
      help: 'HTTP request latency in seconds across HOS microservices (PHI-free labels)',
      labelNames: ['service', 'method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new client.Counter({
      name: 'hos_http_requests_total',
      help: 'Total HTTP requests processed by HOS microservices',
      labelNames: ['service', 'method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpErrorsTotal = new client.Counter({
      name: 'hos_http_errors_total',
      help: 'Total HTTP 4xx/5xx error responses across HOS microservices',
      labelNames: ['service', 'method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.outboxPendingEventsGauge = new client.Gauge({
      name: 'hos_outbox_pending_events',
      help: 'Number of transactional outbox events pending publication per schema',
      labelNames: ['schema'],
      registers: [this.registry],
    });

    this.kafkaDlqEventsTotal = new client.Counter({
      name: 'hos_kafka_dlq_events_total',
      help: 'Total Kafka events routed to dead-letter queues (.dlq)',
      labelNames: ['topic', 'consumer_group'],
      registers: [this.registry],
    });

    this.bullmqJobsProcessedTotal = new client.Counter({
      name: 'hos_bullmq_jobs_processed_total',
      help: 'Total background jobs processed by BullMQ workers',
      labelNames: ['queue', 'status'],
      registers: [this.registry],
    });

    this.criticalLabAlertsTotal = new client.Counter({
      name: 'hos_critical_lab_alerts_total',
      help: 'Total critical laboratory result alerts dispatched',
      labelNames: ['hospital_id'],
      registers: [this.registry],
    });

    this.bedOccupancyRatioGauge = new client.Gauge({
      name: 'hos_bed_occupancy_ratio',
      help: 'Current hospital bed occupancy ratio (0.0 to 1.0)',
      labelNames: ['hospital_id'],
      registers: [this.registry],
    });
  }

  recordHttpRequest(params: {
    service: string;
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void {
    const labels = {
      service: params.service,
      method: params.method,
      route: params.route,
      status_code: String(params.statusCode),
    };
    this.httpRequestDurationSeconds.observe(labels, params.durationSeconds);
    this.httpRequestsTotal.inc(labels);
    if (params.statusCode >= 400) {
      this.httpErrorsTotal.inc(labels);
    }
  }

  createTraceContext(incomingTraceparent?: string, incomingCorrelationId?: string): {
    traceId: string;
    spanId: string;
    traceparent: string;
    correlationId: string;
  } {
    const traceId = incomingTraceparent?.split('-')[1] || randomUUID().replace(/-/g, '');
    const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
    const traceparent = `00-${traceId}-${spanId}-01`;
    const correlationId = incomingCorrelationId || `corr-${randomUUID()}`;
    return { traceId, spanId, traceparent, correlationId };
  }
}

export const globalObservability = new HospitalObservabilityRegistry();

