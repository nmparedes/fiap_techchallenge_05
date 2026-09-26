import { Counter } from '@prometheus-io/client';
import {
  createServiceMetrics,
  type PrometheusRegistry,
  type ServiceMetrics,
} from '@fiap-x/observability';

export type AuthenticationOutcome = 'success' | 'failure';

export interface AuthServiceMetrics extends ServiceMetrics {
  loginAttempts: Counter<'outcome'>;
}

const metricsByRegistry = new WeakMap<PrometheusRegistry, AuthServiceMetrics>();

export function createAuthServiceMetrics(registry: PrometheusRegistry): AuthServiceMetrics {
  const registered = metricsByRegistry.get(registry);
  if (registered !== undefined) {
    return registered;
  }
  const serviceMetrics = createServiceMetrics(registry);
  serviceMetrics.readiness.set({ service: 'auth-service', dependency: 'mysql' }, 0);
  const metrics = {
    ...serviceMetrics,
    loginAttempts: new Counter({
      name: 'fiap_x_auth_login_attempts_total',
      help: 'Total authentication attempts by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
  };
  metricsByRegistry.set(registry, metrics);
  return metrics;
}
