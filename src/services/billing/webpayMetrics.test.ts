// Praeventio Guard — Webpay return latency histogram tests.
//
// TDD coverage for `recordWebpayReturnLatency`:
//   • Each `outcome` value emits the right histogram key (matches Terraform descriptor in monitoring.tf).
//   • Latency value reaches the histogram bucket via `noopMetricsAdapter`.
//   • State is reset between tests via `__resetNoopMetricsStateForTests`.
//   • Observability errors NEVER bubble out (defensive).
//
// We rely on `METRICS_ADAPTER` defaulting to `noop` in CI (no env stub
// needed) and inspect the in-process state via the existing test inspector.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __getNoopMetricsStateForTests,
  __resetNoopMetricsStateForTests,
} from '../observability/metricsAdapter';
import * as observabilityModule from '../observability';
import { recordWebpayReturnLatency } from './webpayMetrics';

const HISTOGRAM_NAME = 'praeventio/webpay/return_latency_ms';

describe('recordWebpayReturnLatency', () => {
  beforeEach(() => {
    __resetNoopMetricsStateForTests();
    // Force noop adapter in case a previous test stubbed METRICS_ADAPTER.
    vi.stubEnv('METRICS_ADAPTER', 'noop');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits histogram observation for outcome="success"', () => {
    recordWebpayReturnLatency({ outcome: 'success', latencyMs: 123 });
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="success"}`]).toEqual([123]);
  });

  it('emits histogram observation for outcome="failure"', () => {
    recordWebpayReturnLatency({ outcome: 'failure', latencyMs: 456 });
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="failure"}`]).toEqual([456]);
  });

  it('emits histogram observation for outcome="invalid"', () => {
    recordWebpayReturnLatency({ outcome: 'invalid', latencyMs: 7 });
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="invalid"}`]).toEqual([7]);
  });

  it('keeps separate buckets per outcome label', () => {
    recordWebpayReturnLatency({ outcome: 'success', latencyMs: 100 });
    recordWebpayReturnLatency({ outcome: 'success', latencyMs: 200 });
    recordWebpayReturnLatency({ outcome: 'failure', latencyMs: 50 });
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="success"}`]).toEqual([100, 200]);
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="failure"}`]).toEqual([50]);
  });

  it('rounds non-integer latency values (passes them through unchanged)', () => {
    // Implementation detail: we forward the raw number; histograms in
    // Cloud Monitoring / Prometheus accept floats. Just assert no
    // mutation / loss.
    recordWebpayReturnLatency({ outcome: 'success', latencyMs: 12.75 });
    const state = __getNoopMetricsStateForTests();
    expect(state.histograms[`${HISTOGRAM_NAME}{outcome="success"}`]).toEqual([12.75]);
  });

  it('NEVER throws when the underlying metrics call would throw', () => {
    // Defensive: if a downstream metrics adapter blows up, the helper
    // must swallow the error. This is the reliability guarantee for
    // server.ts — observability MUST NOT break the response path.
    //
    // We achieve this by spying on getMetrics() to return an adapter
    // whose histogram() throws synchronously.
    const spy = vi.spyOn(observabilityModule, 'getMetrics').mockReturnValue({
      name: 'noop',
      isAvailable: true,
      counter: () => ({ inc: () => undefined }),
      gauge: () => ({ set: () => undefined, inc: () => undefined }),
      histogram: () => {
        throw new Error('synthetic metrics outage');
      },
    });
    try {
      expect(() =>
        recordWebpayReturnLatency({ outcome: 'success', latencyMs: 99 }),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
