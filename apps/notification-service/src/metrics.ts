import { Counter, Histogram } from '@prometheus-io/client';
import {
  createServiceMetrics,
  type PrometheusRegistry,
  type ServiceMetrics,
} from '@fiap-x/observability';

export interface NotificationServiceMetrics extends ServiceMetrics {
  notificationsConsumed: Counter<'outcome'>;
  consumptionDuration: Histogram<'outcome'>;
}

const metricsByRegistry = new WeakMap<PrometheusRegistry, NotificationServiceMetrics>();

export function createNotificationServiceMetrics(
  registry: PrometheusRegistry,
): NotificationServiceMetrics {
  const registered = metricsByRegistry.get(registry);
  if (registered !== undefined) {
    return registered;
  }
  const serviceMetrics = createServiceMetrics(registry);
  serviceMetrics.readiness.set({ service: 'notification-service', dependency: 'mysql' }, 0);
  serviceMetrics.readiness.set({ service: 'notification-service', dependency: 'rabbitmq' }, 0);
  const metrics = {
    ...serviceMetrics,
    notificationsConsumed: new Counter({
      name: 'fiap_x_notification_events_consumed_total',
      help: 'Processing failure events consumed by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    consumptionDuration: new Histogram({
      name: 'fiap_x_notification_consumption_duration_seconds',
      help: 'Processing failure event consumption duration by outcome.',
      labelNames: ['outcome'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
  };
  metricsByRegistry.set(registry, metrics);
  return metrics;
}
