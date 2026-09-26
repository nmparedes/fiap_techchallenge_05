import { Counter, Histogram } from '@prometheus-io/client';
import {
  createServiceMetrics,
  type PrometheusRegistry,
  type ServiceMetrics,
} from '@fiap-x/observability';

export interface ProcessorServiceMetrics extends ServiceMetrics {
  jobs: Counter<'outcome'>;
  jobDuration: Histogram<'outcome'>;
  failures: Counter<'error_code'>;
}

const metricsByRegistry = new WeakMap<PrometheusRegistry, ProcessorServiceMetrics>();

export function createProcessorServiceMetrics(
  registry: PrometheusRegistry,
): ProcessorServiceMetrics {
  const registered = metricsByRegistry.get(registry);
  if (registered !== undefined) {
    return registered;
  }
  const serviceMetrics = createServiceMetrics(registry);
  for (const dependency of ['rabbitmq', 'storage', 'ffmpeg']) {
    serviceMetrics.readiness.set({ service: 'processor-service', dependency }, 0);
  }
  const metrics = {
    ...serviceMetrics,
    jobs: new Counter({
      name: 'fiap_x_processor_jobs_total',
      help: 'Processor Service jobs by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    jobDuration: new Histogram({
      name: 'fiap_x_processor_job_duration_seconds',
      help: 'Processor Service job duration in seconds by outcome.',
      labelNames: ['outcome'],
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
      registers: [registry],
    }),
    failures: new Counter({
      name: 'fiap_x_processor_failures_total',
      help: 'Processor Service failures by bounded error code.',
      labelNames: ['error_code'],
      registers: [registry],
    }),
  };
  metricsByRegistry.set(registry, metrics);
  return metrics;
}
