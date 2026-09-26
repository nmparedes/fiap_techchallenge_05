import { Counter } from '@prometheus-io/client';
import {
  createServiceMetrics,
  type PrometheusRegistry,
  type ServiceMetrics,
} from '@fiap-x/observability';

export interface VideoServiceMetrics extends ServiceMetrics {
  uploads: Counter<'outcome'>;
  statusEvents: Counter<'event_type' | 'outcome'>;
  videosByStatus: Counter<'operation' | 'status'>;
  retries: Counter<'outcome'>;
}

const metricsByRegistry = new WeakMap<PrometheusRegistry, VideoServiceMetrics>();

export function createVideoServiceMetrics(registry: PrometheusRegistry): VideoServiceMetrics {
  const registered = metricsByRegistry.get(registry);
  if (registered !== undefined) {
    return registered;
  }
  const serviceMetrics = createServiceMetrics(registry);
  serviceMetrics.readiness.set({ service: 'video-service', dependency: 'mysql' }, 0);
  serviceMetrics.readiness.set({ service: 'video-service', dependency: 'rabbitmq' }, 0);
  const metrics = {
    ...serviceMetrics,
    uploads: new Counter({
      name: 'fiap_x_video_uploads_total',
      help: 'Total video upload requests by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    statusEvents: new Counter({
      name: 'fiap_x_video_status_events_total',
      help: 'Total processing status events by type and outcome.',
      labelNames: ['event_type', 'outcome'],
      registers: [registry],
    }),
    videosByStatus: new Counter({
      name: 'fiap_x_video_status_total',
      help: 'Videos by observed or transitioned status.',
      labelNames: ['operation', 'status'],
      registers: [registry],
    }),
    retries: new Counter({
      name: 'fiap_x_video_retries_total',
      help: 'Video retry requests by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
  };
  metricsByRegistry.set(registry, metrics);
  return metrics;
}
