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
    this.isAvailable = typeof process !== 'undefined' && Boolean(process.env.GCP_PROJECT_ID);
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

  /**
   * In-process registry. Maps (name + sorted labels) → numeric value.
   *
   * Why not `prom-client`?
   *   • Zero-dep keeps the bundle lean for the PWA (web build).
   *   • `PROMETHEUS_ENABLED=1` flips this from stub to live; ops that
   *     need full prom-client can `npm install` it later and swap the
   *     registry body.
   *   • The formatter below is OpenMetrics-compatible enough for
   *     `promtool check metrics` and the standard scrape format.
   *
   * Cardinality guard: never put user IDs / RUTs in labels — keep to
   * small enums (route, method, status_class, tenant_tier, kind).
   * See header comment on this file for the full rationale.
   */
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  constructor() {
    this.isAvailable =
      typeof process !== 'undefined' && process.env.PROMETHEUS_ENABLED === '1';
  }

  counter(name: string, labels?: Record<string, string>): CounterHandle {
    const key = formatMetricKey(name, labels);
    const counters = this.counters;
    return {
      inc(value = 1) {
        const next = (counters.get(key) ?? 0) + value;
        counters.set(key, next);
        emitDebug('counter', key, next);
      },
    };
  }

  gauge(name: string, labels?: Record<string, string>): GaugeHandle {
    const key = formatMetricKey(name, labels);
    const gauges = this.gauges;
    return {
      set(value: number) {
        gauges.set(key, value);
        emitDebug('gauge', key, value);
      },
      inc(value = 1) {
        const next = (gauges.get(key) ?? 0) + value;
        gauges.set(key, next);
        emitDebug('gauge', key, next);
      },
      dec(value = 1) {
        const next = (gauges.get(key) ?? 0) - value;
        gauges.set(key, next);
        emitDebug('gauge', key, next);
      },
    };
  }

  histogram(name: string, labels?: Record<string, string>): HistogramHandle {
    const key = formatMetricKey(name, labels);
    const histograms = this.histograms;
    return {
      observe(value: number) {
        const bucket = histograms.get(key) ?? [];
        bucket.push(value);
        histograms.set(key, bucket);
        emitDebug('histogram', key, value);
      },
    };
  }

  /**
   * Render the registry as Prometheus text exposition format
   * (https://prometheus.io/docs/instrumenting/exposition_formats/).
   * Returns the snapshot consumed by `GET /metrics`.
   *
   * NOTE: histograms render as `*_count`, `*_sum`, `*_max`. A real
   * bucket distribution needs `prom-client` (deferred to Round 2 —
   * see OBSERVABILITY.md §4). For the production alert we only need
   * the count + sum + max to spot regressions.
   */
  renderExposition(): string {
    const lines: string[] = [];
    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`# TYPE ${baseName(key)} counter`);
      lines.push(`${key} ${value}`);
    }
    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`# TYPE ${baseName(key)} gauge`);
      lines.push(`${key} ${value}`);
    }
    // Histograms (count / sum / max)
    for (const [key, samples] of this.histograms.entries()) {
      const base = baseName(key);
      const count = samples.length;
      const sum = samples.reduce((acc, v) => acc + v, 0);
      const max = samples.reduce((acc, v) => Math.max(acc, v), 0);
      lines.push(`# TYPE ${base} summary`);
      lines.push(`${base}_count${labelsOf(key)} ${count}`);
      lines.push(`${base}_sum${labelsOf(key)} ${sum}`);
      lines.push(`${base}_max${labelsOf(key)} ${max}`);
    }
    return lines.join('\n') + '\n';
  }
}

/**
 * Extract the metric name (without label braces) from a formatted key.
 * Inverse of `formatMetricKey`.
 */
function baseName(formattedKey: string): string {
  const open = formattedKey.indexOf('{');
  return open === -1 ? formattedKey : formattedKey.slice(0, open);
}

/**
 * Extract just the `{k="v",...}` portion of a formatted key (or '' if none).
 */
function labelsOf(formattedKey: string): string {
  const open = formattedKey.indexOf('{');
  if (open === -1) return '';
  return formattedKey.slice(open);
}

export const prometheusAdapter: PrometheusAdapter = new PrometheusAdapter();

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
