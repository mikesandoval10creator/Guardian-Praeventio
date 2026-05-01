// Praeventio Guard — Observability module facade.
//
// Single import entry point for the rest of the app:
//
//   import { getErrorTracker, getMetrics } from '@/src/services/observability';
//
// `getErrorTracker()` resolves the runtime adapter based on `ERROR_TRACKER`.
// `getMetrics()`     resolves the metrics adapter based on `METRICS_ADAPTER`.
// Both fall back to `noop` (which routes through the existing structured
// logger) so dev/CI never crash on an unset env var. Production deploys
// MUST set the relevant env var to a real adapter.
//
// SCAFFOLDING ONLY — every adapter except `noop` throws
// `ObservabilityNotImplementedError` today. See OBSERVABILITY.md for the
// runbook describing how Round 2 wires the real SDKs.

import { cloudErrorReportingAdapter } from './cloudErrorReportingAdapter';
import {
  cloudMonitoringAdapter,
  noopMetricsAdapter,
  prometheusAdapter,
} from './metricsAdapter';
import { noopErrorTrackingAdapter } from './noopErrorTrackingAdapter';
import { sentryAdapter } from './sentryAdapter';
import type {
  ErrorTrackingAdapter,
  ErrorTrackingAdapterName,
  MetricsAdapter,
  MetricsAdapterName,
} from './types';

// ---------------------------------------------------------------------------
// Error tracker selection
// ---------------------------------------------------------------------------

const ERROR_TRACKER_KEYS: ReadonlySet<ErrorTrackingAdapterName> =
  new Set<ErrorTrackingAdapterName>(['sentry', 'cloud-error-reporting', 'noop']);

/**
 * Resolve the active error tracker from `ERROR_TRACKER` env var.
 *
 * IMPORTANT — fall-back policy:
 *
 * Unlike the KMS adapter (which refuses to silently downgrade for security
 * reasons), the error tracker DOES fall back to `noop` if a real adapter
 * is selected but unavailable (`isAvailable === false`). Rationale:
 *
 *   • The noop adapter still routes errors through `logger.error()`, which
 *     in production lands in Cloud Logging — so we don't actually lose
 *     errors, we just lose Sentry's grouping/dedup/alerting.
 *   • An observability misconfiguration MUST NEVER take down the request
 *     path. Better to log a warning at startup and continue than to crash
 *     a paying user's checkout.
 *
 * The fall-back emits a `console.warn` (not `logger.warn` — we don't want
 * to recurse through observability code) so an operator scanning Cloud
 * Run logs can spot the misconfiguration.
 */
export function getErrorTracker(): ErrorTrackingAdapter {
  const raw = (process.env.ERROR_TRACKER ?? 'noop').toLowerCase().trim();
  const key: ErrorTrackingAdapterName = ERROR_TRACKER_KEYS.has(raw as ErrorTrackingAdapterName)
    ? (raw as ErrorTrackingAdapterName)
    : 'noop';

  let chosen: ErrorTrackingAdapter;
  switch (key) {
    case 'sentry':
      chosen = sentryAdapter;
      break;
    case 'cloud-error-reporting':
      chosen = cloudErrorReportingAdapter;
      break;
    case 'noop':
    default:
      chosen = noopErrorTrackingAdapter;
      break;
  }

  if (!chosen.isAvailable && chosen.name !== 'noop') {
    // eslint-disable-next-line no-console
    console.warn(
      `[observability] ERROR_TRACKER='${chosen.name}' is unavailable ` +
        '(missing DSN / project config). Falling back to noop. Errors will ' +
        'still flow through logger.error(); see OBSERVABILITY.md.',
    );
    return noopErrorTrackingAdapter;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Metrics selection
// ---------------------------------------------------------------------------

const METRICS_KEYS: ReadonlySet<MetricsAdapterName> = new Set<MetricsAdapterName>([
  'cloud-monitoring',
  'prometheus',
  'noop',
]);

/**
 * Resolve the active metrics adapter from `METRICS_ADAPTER` env var.
 *
 * Same fall-back policy as `getErrorTracker()` — silent downgrade to noop
 * on unavailability, so a metrics misconfiguration never breaks the app.
 * The noop adapter still emits `logger.debug` events, so dev can verify
 * metric calls fire even without a real backend.
 */
export function getMetrics(): MetricsAdapter {
  const raw = (process.env.METRICS_ADAPTER ?? 'noop').toLowerCase().trim();
  const key: MetricsAdapterName = METRICS_KEYS.has(raw as MetricsAdapterName)
    ? (raw as MetricsAdapterName)
    : 'noop';

  let chosen: MetricsAdapter;
  switch (key) {
    case 'cloud-monitoring':
      chosen = cloudMonitoringAdapter;
      break;
    case 'prometheus':
      chosen = prometheusAdapter;
      break;
    case 'noop':
    default:
      chosen = noopMetricsAdapter;
      break;
  }

  if (!chosen.isAvailable && chosen.name !== 'noop') {
    // eslint-disable-next-line no-console
    console.warn(
      `[observability] METRICS_ADAPTER='${chosen.name}' is unavailable. ` +
        'Falling back to noop (logger.debug). See OBSERVABILITY.md.',
    );
    return noopMetricsAdapter;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Re-exports — public surface
// ---------------------------------------------------------------------------

export {
  cloudErrorReportingAdapter,
  cloudMonitoringAdapter,
  noopErrorTrackingAdapter,
  noopMetricsAdapter,
  prometheusAdapter,
  sentryAdapter,
};

export { ObservabilityNotImplementedError } from './types';

export type {
  Breadcrumb,
  CounterHandle,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingAdapterName,
  ErrorTrackingInitOptions,
  GaugeHandle,
  HistogramHandle,
  MetricsAdapter,
  MetricsAdapterName,
} from './types';
