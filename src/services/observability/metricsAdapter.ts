// Praeventio Guard — Metrics adapter (counters / gauges / histograms).
//
// SCAFFOLDING ONLY. Three adapters here, mirroring the error-tracking shape:
//
//   • cloudMonitoringAdapter — GCP Cloud Monitoring stub (Round 2 SDK install)
//   • prometheusAdapter      — prom-client stub (alternative for self-host)
//   • noopMetricsAdapter     — dev/CI: routes to logger.debug
//
// Selection happens in `index.ts` (`getMetrics()`) via `METRICS_ADAPTER` env.
//
// Round 2 will:
//   1. `npm install @google-cloud/monitoring` (or `prom-client`).
//   2. Replace the stub bodies with the real SDK calls.
//   3. Define custom metric types — see OBSERVABILITY.md §4 for the full list.
//
// NOTE on label cardinality: every distinct label combo creates a separate
// time series. NEVER put user IDs / RUTs / event IDs in labels — that
// explodes cost and hits Cloud Monitoring's per-metric series cap. Keep
// labels to small enums (route, method, status_class, tenant_tier).

import { logger } from '../../utils/logger';
import {
  ObservabilityNotImplementedError,
  type CounterHandle,
  type GaugeHandle,
  type HistogramHandle,
  type MetricsAdapter,
} from './types';

const CLOUD_MONITORING_INSTALL = 'npm install @google-cloud/monitoring';
const PROMETHEUS_INSTALL = 'npm install prom-client';

/**
 * Format `(name, labels)` as a single `name{k=v,k=v}` string for log
 * mirroring. Mirrors Prometheus' textfile / OpenMetrics encoding so a dev
 * reading `logger.debug` output sees the same shape they'd see in Grafana.
 */
function formatMetricKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `${name}{${pairs}}`;
}

// ---------------------------------------------------------------------------
// Cloud Monitoring stub
// ---------------------------------------------------------------------------

class CloudMonitoringAdapter implements MetricsAdapter {
  readonly name = 'cloud-monitoring' as const;
  readonly isAvailable: boolean;

  constructor() {
    // Same gating as cloudErrorReportingAdapter — explicit project ID, ADC
    // for auth.
    this.isAvailable = Boolean(process.env.GCP_PROJECT_ID);
  }

  counter(_name: string, _labels?: Record<string, string>): CounterHandle {
    throw new ObservabilityNotImplementedError('CloudMonitoring', CLOUD_MONITORING_INSTALL);
  }

  gauge(_name: string, _labels?: Record<string, string>): GaugeHandle {
    throw new ObservabilityNotImplementedError('CloudMonitoring', CLOUD_MONITORING_INSTALL);
  }

  histogram(_name: string, _labels?: Record<string, string>): HistogramHandle {
    throw new ObservabilityNotImplementedError('CloudMonitoring', CLOUD_MONITORING_INSTALL);
  }
}

export const cloudMonitoringAdapter: MetricsAdapter = new CloudMonitoringAdapter();

// ---------------------------------------------------------------------------
// Prometheus stub
// ---------------------------------------------------------------------------

class PrometheusAdapter implements MetricsAdapter {
  readonly name = 'prometheus' as const;
  readonly isAvailable: boolean;

  constructor() {
    // prom-client doesn't need any env config — it's a pure in-process
    // registry. The `isAvailable` flag mirrors Sentry's: only `true` once
    // the operator opts in via `PROMETHEUS_ENABLED=1`. That keeps the
    // stub from claiming availability on systems that haven't actually
    // installed the SDK yet.
    this.isAvailable = process.env.PROMETHEUS_ENABLED === '1';
  }

  counter(_name: string, _labels?: Record<string, string>): CounterHandle {
    throw new ObservabilityNotImplementedError('Prometheus', PROMETHEUS_INSTALL);
  }

  gauge(_name: string, _labels?: Record<string, string>): GaugeHandle {
    throw new ObservabilityNotImplementedError('Prometheus', PROMETHEUS_INSTALL);
  }

  histogram(_name: string, _labels?: Record<string, string>): HistogramHandle {
    throw new ObservabilityNotImplementedError('Prometheus', PROMETHEUS_INSTALL);
  }
}

export const prometheusAdapter: MetricsAdapter = new PrometheusAdapter();

// ---------------------------------------------------------------------------
// Noop adapter — routes through logger.debug so devs can see metric activity
// ---------------------------------------------------------------------------

/**
 * In-process counter / gauge state. Lives only in this module — the noop
 * adapter doesn't try to be a full registry, it just lets devs verify
 * metric calls fire by emitting a `logger.debug` and keeping a running
 * total they can inspect via `__getNoopMetricsStateForTests`.
 */
const noopState = {
  counters: new Map<string, number>(),
  gauges: new Map<string, number>(),
  histograms: new Map<string, number[]>(),
};

function emitDebug(kind: 'counter' | 'gauge' | 'histogram', key: string, value: number): void {
  logger.debug(`observability:metric:${kind}`, { key, value });
}

export const noopMetricsAdapter: MetricsAdapter = {
  name: 'noop',
  isAvailable: true,

  counter(name, labels): CounterHandle {
    const key = formatMetricKey(name, labels);
    return {
      inc(value = 1) {
        const current = noopState.counters.get(key) ?? 0;
        const next = current + value;
        noopState.counters.set(key, next);
        emitDebug('counter', key, next);
      },
    };
  },

  gauge(name, labels): GaugeHandle {
    const key = formatMetricKey(name, labels);
    return {
      set(value: number) {
        noopState.gauges.set(key, value);
        emitDebug('gauge', key, value);
      },
      inc(value = 1) {
        const current = noopState.gauges.get(key) ?? 0;
        const next = current + value;
        noopState.gauges.set(key, next);
        emitDebug('gauge', key, next);
      },
      dec(value = 1) {
        const current = noopState.gauges.get(key) ?? 0;
        const next = current - value;
        noopState.gauges.set(key, next);
        emitDebug('gauge', key, next);
      },
    };
  },

  histogram(name, labels): HistogramHandle {
    const key = formatMetricKey(name, labels);
    return {
      observe(value: number) {
        const bucket = noopState.histograms.get(key) ?? [];
        bucket.push(value);
        noopState.histograms.set(key, bucket);
        emitDebug('histogram', key, value);
      },
    };
  },
};

/**
 * Test-only inspector. Returns a snapshot of the in-process counter / gauge
 * / histogram state so tests can assert metric activity without monkey-
 * patching the logger.
 */
export function __getNoopMetricsStateForTests(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
} {
  return {
    counters: Object.fromEntries(noopState.counters),
    gauges: Object.fromEntries(noopState.gauges),
    histograms: Object.fromEntries(
      [...noopState.histograms.entries()].map(([k, v]) => [k, [...v]]),
    ),
  };
}

/**
 * Test-only reset. Mirrors the SII / KMS pattern.
 */
export function __resetNoopMetricsStateForTests(): void {
  noopState.counters.clear();
  noopState.gauges.clear();
  noopState.histograms.clear();
}
