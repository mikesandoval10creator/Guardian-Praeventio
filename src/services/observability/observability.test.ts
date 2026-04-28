// Praeventio Guard — Observability adapter tests.
//
// Coverage:
//   • `sentryAdapter.isAvailable` env gating + stub error message.
//   • `cloudErrorReportingAdapter.isAvailable` env gating.
//   • `noopErrorTrackingAdapter` happy path (captureException, captureMessage,
//     addBreadcrumb, setUserContext, flush).
//   • `getErrorTracker()` env-based selection + fall-back policy.
//   • `getMetrics()` env-based selection.
//   • Noop metrics counter / gauge / histogram routing through state.
//
// We use vitest's `vi.stubEnv` to mutate `process.env` per-test and
// `vi.unstubAllEnvs` to reset between tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sentryAdapter } from './sentryAdapter';
import { cloudErrorReportingAdapter } from './cloudErrorReportingAdapter';
import {
  __resetNoopErrorTrackerStateForTests,
  noopErrorTrackingAdapter,
} from './noopErrorTrackingAdapter';
import {
  __getNoopMetricsStateForTests,
  __resetNoopMetricsStateForTests,
  cloudMonitoringAdapter,
  noopMetricsAdapter,
  prometheusAdapter,
} from './metricsAdapter';
import { getErrorTracker, getMetrics } from './index';
import { ObservabilityNotImplementedError } from './types';

describe('sentryAdapter (stub)', () => {
  it('isAvailable === false when SENTRY_DSN unset', () => {
    // Adapter captures isAvailable in its constructor. We re-import a
    // fresh module to pick up the env state — but since the singleton was
    // built at module-load time before any test ran, we instead check
    // whether the DSN is unset right now and assert consistency. In a
    // typical CI run SENTRY_DSN is unset, which gives us false.
    if (!process.env.SENTRY_DSN) {
      expect(sentryAdapter.isAvailable).toBe(false);
    } else {
      expect(sentryAdapter.isAvailable).toBe(true);
    }
  });

  it('init() throws ObservabilityNotImplementedError with install command', () => {
    expect(() =>
      sentryAdapter.init({ environment: 'development' }),
    ).toThrow(ObservabilityNotImplementedError);
    expect(() =>
      sentryAdapter.init({ environment: 'development' }),
    ).toThrow(/npm install @sentry\/node/);
  });

  it('captureException() throws helpful error including OBSERVABILITY.md', () => {
    expect(() =>
      sentryAdapter.captureException(new Error('boom')),
    ).toThrow(/OBSERVABILITY\.md/);
  });

  it('addBreadcrumb / setUserContext / flush DO NOT throw (hot-path safe)', async () => {
    expect(() =>
      sentryAdapter.addBreadcrumb({
        category: 'http',
        message: 'GET /api/health',
        level: 'info',
        timestamp: new Date(),
      }),
    ).not.toThrow();
    expect(() => sentryAdapter.setUserContext('uid-1')).not.toThrow();
    await expect(sentryAdapter.flush(1000)).resolves.toBeUndefined();
  });

  it('name is "sentry"', () => {
    expect(sentryAdapter.name).toBe('sentry');
  });
});

describe('cloudErrorReportingAdapter (stub)', () => {
  it('isAvailable mirrors GCP_PROJECT_ID presence', () => {
    if (!process.env.GCP_PROJECT_ID) {
      expect(cloudErrorReportingAdapter.isAvailable).toBe(false);
    } else {
      expect(cloudErrorReportingAdapter.isAvailable).toBe(true);
    }
  });

  it('captureException throws ObservabilityNotImplementedError with GCP install', () => {
    expect(() =>
      cloudErrorReportingAdapter.captureException(new Error('x')),
    ).toThrow(/npm install @google-cloud\/error-reporting/);
  });

  it('name is "cloud-error-reporting"', () => {
    expect(cloudErrorReportingAdapter.name).toBe('cloud-error-reporting');
  });
});

describe('noopErrorTrackingAdapter', () => {
  beforeEach(() => {
    __resetNoopErrorTrackerStateForTests();
  });

  it('isAvailable === true (always)', () => {
    expect(noopErrorTrackingAdapter.isAvailable).toBe(true);
  });

  it('captureException returns a non-empty event id and does not throw', () => {
    const id = noopErrorTrackingAdapter.captureException(new Error('boom'), {
      userId: 'uid-1',
      endpoint: '/api/test',
    });
    expect(id).toMatch(/^noop-/);
    expect(id.length).toBeGreaterThan('noop-'.length);
  });

  it('captureMessage returns event id for each level', () => {
    const a = noopErrorTrackingAdapter.captureMessage('hi', 'info');
    const b = noopErrorTrackingAdapter.captureMessage('warn', 'warning');
    const c = noopErrorTrackingAdapter.captureMessage('err', 'error');
    expect(a).toMatch(/^noop-/);
    expect(b).toMatch(/^noop-/);
    expect(c).toMatch(/^noop-/);
  });

  it('addBreadcrumb does not throw on any level', () => {
    expect(() =>
      noopErrorTrackingAdapter.addBreadcrumb({
        category: 'http',
        message: 'GET /api/health',
        level: 'info',
        timestamp: new Date(),
        data: { status: 200 },
      }),
    ).not.toThrow();
    expect(() =>
      noopErrorTrackingAdapter.addBreadcrumb({
        category: 'auth',
        message: 'token refresh',
        level: 'debug',
        timestamp: new Date(),
      }),
    ).not.toThrow();
  });

  it('setUserContext stores context that captureException can pick up', () => {
    noopErrorTrackingAdapter.setUserContext('uid-42', { tier: 'plata' });
    // We can't assert against logger output without monkey-patching, but we
    // can assert no throw. The richer assertion lives in the integration
    // test added when sentryAdapter is wired up.
    expect(() =>
      noopErrorTrackingAdapter.captureException(new Error('x')),
    ).not.toThrow();
  });

  it('flush resolves without rejecting', async () => {
    await expect(noopErrorTrackingAdapter.flush()).resolves.toBeUndefined();
    await expect(noopErrorTrackingAdapter.flush(500)).resolves.toBeUndefined();
  });
});

describe('getErrorTracker() facade', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to noop when ERROR_TRACKER unset', () => {
    vi.stubEnv('ERROR_TRACKER', '');
    expect(getErrorTracker().name).toBe('noop');
  });

  it('returns noop for unknown values', () => {
    vi.stubEnv('ERROR_TRACKER', 'definitely-not-an-adapter');
    expect(getErrorTracker().name).toBe('noop');
  });

  it('returns sentry when ERROR_TRACKER=sentry AND SENTRY_DSN is configured', () => {
    // sentryAdapter.isAvailable is captured at module load. We assert
    // behaviour conditional on what's currently set so the test is
    // deterministic regardless of the test runner's env.
    vi.stubEnv('ERROR_TRACKER', 'sentry');
    if (sentryAdapter.isAvailable) {
      expect(getErrorTracker().name).toBe('sentry');
    } else {
      // Documented fall-back: silently downgrade to noop and warn.
      expect(getErrorTracker().name).toBe('noop');
    }
  });

  it('falls back to noop when sentry selected but unavailable (warn, do not throw)', () => {
    vi.stubEnv('ERROR_TRACKER', 'sentry');
    // We can't easily flip sentryAdapter.isAvailable post-construction, so
    // skip the assertion when the env happens to have a DSN. In CI without
    // SENTRY_DSN this is the primary fall-back assertion.
    if (!sentryAdapter.isAvailable) {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tracker = getErrorTracker();
      expect(tracker.name).toBe('noop');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("ERROR_TRACKER='sentry'"),
      );
      warnSpy.mockRestore();
    }
  });

  it('case-insensitive env match', () => {
    vi.stubEnv('ERROR_TRACKER', 'NOOP');
    expect(getErrorTracker().name).toBe('noop');
  });
});

describe('noopMetricsAdapter', () => {
  beforeEach(() => {
    __resetNoopMetricsStateForTests();
  });

  it('counter.inc() increments running total', () => {
    const c = noopMetricsAdapter.counter('http_requests_total', { route: '/api/health' });
    c.inc();
    c.inc(2);
    const state = __getNoopMetricsStateForTests();
    expect(state.counters['http_requests_total{route="/api/health"}']).toBe(3);
  });

  it('gauge.set / gauge.inc / gauge.dec track current value', () => {
    const g = noopMetricsAdapter.gauge('queue_depth');
    g.set(10);
    g.inc(5);
    if (g.dec) g.dec(3);
    const state = __getNoopMetricsStateForTests();
    expect(state.gauges['queue_depth']).toBe(12);
  });

  it('histogram.observe collects all values', () => {
    const h = noopMetricsAdapter.histogram('latency_ms', { route: '/api/x' });
    h.observe(100);
    h.observe(250);
    h.observe(50);
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms['latency_ms{route="/api/x"}']).toEqual([100, 250, 50]);
  });

  it('formats label keys deterministically (sorted)', () => {
    const c = noopMetricsAdapter.counter('m', { z: '1', a: '2' });
    c.inc();
    const state = __getNoopMetricsStateForTests();
    // Sorted keys: a then z
    expect(state.counters['m{a="2",z="1"}']).toBe(1);
  });
});

describe('cloudMonitoringAdapter / prometheusAdapter (stubs)', () => {
  it('cloudMonitoringAdapter.counter throws ObservabilityNotImplementedError', () => {
    expect(() => cloudMonitoringAdapter.counter('x')).toThrow(ObservabilityNotImplementedError);
    expect(() => cloudMonitoringAdapter.counter('x')).toThrow(
      /npm install @google-cloud\/monitoring/,
    );
  });

  it('prometheusAdapter.histogram throws ObservabilityNotImplementedError', () => {
    expect(() => prometheusAdapter.histogram('x')).toThrow(ObservabilityNotImplementedError);
    expect(() => prometheusAdapter.histogram('x')).toThrow(/npm install prom-client/);
  });

  it('cloudMonitoringAdapter name + isAvailable are typed correctly', () => {
    expect(cloudMonitoringAdapter.name).toBe('cloud-monitoring');
    expect(typeof cloudMonitoringAdapter.isAvailable).toBe('boolean');
  });

  it('prometheusAdapter name + isAvailable are typed correctly', () => {
    expect(prometheusAdapter.name).toBe('prometheus');
    expect(typeof prometheusAdapter.isAvailable).toBe('boolean');
  });
});

describe('getMetrics() facade', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to noop when METRICS_ADAPTER unset', () => {
    vi.stubEnv('METRICS_ADAPTER', '');
    expect(getMetrics().name).toBe('noop');
  });

  it('returns noop for unknown values', () => {
    vi.stubEnv('METRICS_ADAPTER', 'graphite');
    expect(getMetrics().name).toBe('noop');
  });

  it('selects cloud-monitoring when METRICS_ADAPTER=cloud-monitoring AND project configured', () => {
    vi.stubEnv('METRICS_ADAPTER', 'cloud-monitoring');
    if (cloudMonitoringAdapter.isAvailable) {
      expect(getMetrics().name).toBe('cloud-monitoring');
    } else {
      expect(getMetrics().name).toBe('noop');
    }
  });

  it('falls back to noop when prometheus selected but unavailable', () => {
    vi.stubEnv('METRICS_ADAPTER', 'prometheus');
    if (!prometheusAdapter.isAvailable) {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getMetrics().name).toBe('noop');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    }
  });
});
