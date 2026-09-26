import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

export type PrometheusRegistry = Registry;

export interface ServiceMetrics {
  httpRequests: Counter<'service' | 'method' | 'route' | 'status_code'>;
  httpRequestDuration: Histogram<'service' | 'method' | 'route'>;
  readiness: Gauge<'service' | 'dependency'>;
}

const serviceMetricsByRegistry = new WeakMap<PrometheusRegistry, ServiceMetrics>();

export function createPrometheusRegistry(): PrometheusRegistry {
  return new Registry();
}

export function createServiceMetrics(registry: PrometheusRegistry): ServiceMetrics {
  const registered = serviceMetricsByRegistry.get(registry);
  if (registered !== undefined) {
    return registered;
  }

  const metrics: ServiceMetrics = {
    httpRequests: new Counter({
      name: 'fiap_x_http_requests_total',
      help: 'HTTP requests by service, method, normalized route, and status code.',
      labelNames: ['service', 'method', 'route', 'status_code'],
      registers: [registry],
    }),
    httpRequestDuration: new Histogram({
      name: 'fiap_x_http_request_duration_seconds',
      help: 'HTTP request duration by service, method, and normalized route.',
      labelNames: ['service', 'method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    readiness: new Gauge({
      name: 'fiap_x_readiness',
      help: 'Dependency readiness by service and dependency (1 ready, 0 unavailable).',
      labelNames: ['service', 'dependency'],
      registers: [registry],
    }),
  };
  serviceMetricsByRegistry.set(registry, metrics);
  return metrics;
}
