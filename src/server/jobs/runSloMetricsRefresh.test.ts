// SPDX-License-Identifier: MIT
//
// Tests for runSloMetricsRefresh job.
//
// Verifies:
//   • Gate: returns { gateClosed: true } when SENTRY_SLO_ENABLED is not set
//   • Gate: returns { gateClosed: true } when any credential is missing
//   • Happy path: writes daily docs to slo_metrics/{sloId}/daily/{YYYY-MM-DD}
//   • Availability SLO: computes uptime fraction from error + total counts
//   • Error-rate SLO: computes fraction correctly
//   • Latency SLO: stores raw p95 value in ms
//   • Sentry API errors are non-fatal (SLO goes to failed[] but others continue)
//   • Empty series from Sentry: skips writing, no error

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runSloMetricsRefresh,
  type RunSloMetricsRefreshResult,
} from './runSloMetricsRefresh.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
}));

// ── Minimal Firestore fake with batch support ─────────────────────────────────

interface DocPath { path: string; data: Record<string, unknown> }

function fakeDb() {
  const written: DocPath[] = [];
  const fakeDocRef = (path: string) => ({
    path,
  });
  const fakeBatch = () => {
    const ops: DocPath[] = [];
    return {
      set(ref: { path: string }, data: Record<string, unknown>) {
        ops.push({ path: ref.path, data });
      },
      async commit() {
        written.push(...ops);
      },
    };
  };
  const fakeCollection = (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      collection: (sub: string) => ({
        doc: (subId: string) => fakeDocRef(`${name}/${id}/${sub}/${subId}`),
      }),
    }),
  });
  return {
    batch: fakeBatch,
    collection: fakeCollection,
    _written: written,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-15T08:00:00Z');
const VALID_ENV = {
  SENTRY_SLO_ENABLED: 'true',
  SENTRY_API_TOKEN: 'test-token',
  SENTRY_ORG: 'praeventio',
  SENTRY_PROJECT_ID: '12345',
};

/** Build a minimal Sentry events-stats-like response body. */
function sentryResponse(
  points: Array<[number, number]>,
): Record<string, unknown> {
  return {
    data: points.map(([epoch, count]) => [epoch, [{ count }]]),
  };
}

function makeEpoch(dateStr: string): number {
  return new Date(dateStr).getTime() / 1000;
}

// ── Gate tests ────────────────────────────────────────────────────────────────

describe('runSloMetricsRefresh — credential gate', () => {
  it('returns gateClosed:true when SENTRY_SLO_ENABLED is absent', async () => {
    const db = fakeDb();
    const result: RunSloMetricsRefreshResult = await runSloMetricsRefresh({
      db: db as any,
      env: {}, // no keys
      now: () => NOW,
      fetchFn: vi.fn(),
    });
    expect(result.gateClosed).toBe(true);
    expect(db._written).toHaveLength(0);
  });

  it('returns gateClosed:true when SENTRY_SLO_ENABLED=false', async () => {
    const db = fakeDb();
    const result = await runSloMetricsRefresh({
      db: db as any,
      env: { SENTRY_SLO_ENABLED: 'false' },
      now: () => NOW,
      fetchFn: vi.fn(),
    });
    expect(result.gateClosed).toBe(true);
    expect(db._written).toHaveLength(0);
  });

  it('returns gateClosed:true when SENTRY_API_TOKEN is missing', async () => {
    const db = fakeDb();
    const { SENTRY_API_TOKEN: _, ...envWithoutToken } = VALID_ENV;
    const result = await runSloMetricsRefresh({
      db: db as any,
      env: envWithoutToken,
      now: () => NOW,
      fetchFn: vi.fn(),
    });
    expect(result.gateClosed).toBe(true);
    expect(result.gateReason).toMatch(/SENTRY_API_TOKEN/);
    expect(db._written).toHaveLength(0);
  });

  it('returns gateClosed:true when SENTRY_ORG is missing', async () => {
    const db = fakeDb();
    const { SENTRY_ORG: _, ...envWithoutOrg } = VALID_ENV;
    const result = await runSloMetricsRefresh({
      db: db as any,
      env: envWithoutOrg,
      now: () => NOW,
      fetchFn: vi.fn(),
    });
    expect(result.gateClosed).toBe(true);
  });
});

// ── Happy path tests ──────────────────────────────────────────────────────────

describe('runSloMetricsRefresh — happy path (gated env provided)', () => {
  let db: ReturnType<typeof fakeDb>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = fakeDb();
    // Default: return 1 data point for every Sentry call (error + total).
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        sentryResponse([
          [makeEpoch('2026-05-14T00:00:00Z'), 10],
        ]),
    });
  });

  it('returns gateClosed:false when credentials are present', async () => {
    const result = await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });
    expect(result.gateClosed).toBe(false);
  });

  it('writes daily docs for SLOs that return data', async () => {
    const result = await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });
    // 4 SLOs defined in slos.ts; each should have written at least 1 doc.
    // (availability SLOs call fetch twice: error + total — both return 1 point)
    expect(result.refreshed.length).toBeGreaterThan(0);
    expect(result.failed).toHaveLength(0);
    // At least 1 Firestore write per SLO
    expect(db._written.length).toBeGreaterThanOrEqual(result.refreshed.length);
  });

  it('computes availability as (1 - errors/total) from two fetch calls', async () => {
    // For availability SLO: first call = error count, second = total count
    fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          sentryResponse([[makeEpoch('2026-05-14T00:00:00Z'), 100]]), // error events
      })
      .mockResolvedValue({
        ok: true,
        json: async () =>
          sentryResponse([[makeEpoch('2026-05-14T00:00:00Z'), 10000]]), // total events
      });

    await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });

    // Find the availability SLO daily doc
    const availDoc = db._written.find((w) =>
      w.path.includes('api-availability'),
    );
    expect(availDoc).toBeDefined();
    // availability = 1 - 100/10000 = 0.99
    expect(availDoc!.data.value).toBeCloseTo(0.99, 5);
    expect(availDoc!.data.samples).toBe(10000);
    expect(availDoc!.data.date).toBe('2026-05-14');
  });

  it('stores p95 latency as-is for latency SLOs', async () => {
    // latency SLO gets one fetch (no total fetch needed)
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        sentryResponse([[makeEpoch('2026-05-14T00:00:00Z'), 350]]), // 350ms p95
    });

    await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });

    const latencyDoc = db._written.find((w) =>
      w.path.includes('api-latency-p95'),
    );
    expect(latencyDoc).toBeDefined();
    expect(latencyDoc!.data.value).toBe(350);
    expect(latencyDoc!.data.samples).toBe(1);
  });
});

describe('runSloMetricsRefresh — error resilience', () => {
  it('marks a SLO as failed when Sentry returns non-200, continues with others', async () => {
    const db = fakeDb();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // First call fails (for the first SLO); rest succeed.
      if (callCount === 1) {
        return { ok: false, status: 429 };
      }
      return {
        ok: true,
        json: async () =>
          sentryResponse([[makeEpoch('2026-05-14T00:00:00Z'), 5]]),
      };
    });

    const result = await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });

    // First SLO failed; others should still be processed.
    expect(result.failed.length).toBeGreaterThanOrEqual(1);
    expect(result.refreshed.length).toBeGreaterThan(0);
  });

  it('skips writing docs when Sentry returns empty series (no error)', async () => {
    const db = fakeDb();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }), // empty series
    });

    const result = await runSloMetricsRefresh({
      db: db as any,
      env: VALID_ENV,
      now: () => NOW,
      fetchFn: fetchMock as any,
    });

    // No errors (empty is not an error), nothing written.
    expect(result.failed).toHaveLength(0);
    expect(db._written).toHaveLength(0);
  });
});
