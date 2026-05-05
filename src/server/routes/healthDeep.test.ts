// SPDX-License-Identifier: MIT
// Sprint 22 Bucket AA — /api/health/deep tests.
//
// Coverage:
//   1. all checks ok → 200, status: healthy, every check.ok=true
//   2. one check times out → 503, status: degraded, that check.ok=false
//      with `timeout_2000ms`
//   3. withTimeout helper rejects in ≤ 2000ms (precision check)
//   4. optional photogrammetry skipped when env unset → still healthy
//   5. concurrent execution — total wall time < sum of per-probe latencies
//   6. non-timeout failure (thrown Error) propagates as 503 with the message

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  withTimeout,
  TimeoutError,
  runDeepHealth,
  type ProbeMap,
} from './health.js';

function buildAppWithProbes(probes: ProbeMap): express.Express {
  const app = express();
  app.get('/api/health/deep', async (_req, res) => {
    const { allHealthy, checks } = await runDeepHealth(probes);
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
  return app;
}

const okProbe = () => Promise.resolve();
const okSkipped = () => Promise.resolve({ skipped: true });

describe('GET /api/health/deep', () => {
  it('returns 200 + status: healthy when every probe passes', async () => {
    const app = buildAppWithProbes({
      firestore: okProbe,
      kms: okProbe,
      gemini: okProbe,
      resend: okProbe,
      openMeteo: okProbe,
      photogrammetry: okProbe,
    });
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.checks.firestore.ok).toBe(true);
    expect(res.body.checks.kms.ok).toBe(true);
    expect(res.body.checks.gemini.ok).toBe(true);
    expect(res.body.checks.resend.ok).toBe(true);
    expect(res.body.checks.openMeteo.ok).toBe(true);
    expect(res.body.checks.photogrammetry.ok).toBe(true);
  });

  it('returns 503 + status: degraded when one probe times out (2s cap)', async () => {
    // Hangs forever — must be cut by withTimeout at 2000ms.
    const slow = () =>
      new Promise<void>((resolve) => {
        // Long enough that the test would time out if withTimeout failed.
        setTimeout(resolve, 10_000);
      });
    const app = buildAppWithProbes({
      firestore: okProbe,
      kms: okProbe,
      gemini: slow, // <- offender
      resend: okProbe,
      openMeteo: okProbe,
      photogrammetry: okProbe,
    });
    const start = Date.now();
    const res = await request(app).get('/api/health/deep');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.gemini.ok).toBe(false);
    expect(res.body.checks.gemini.error).toBe('timeout_2000ms');
    // Other checks must still be reported as healthy — degradation is
    // per-dependency, not all-or-nothing.
    expect(res.body.checks.firestore.ok).toBe(true);
    expect(res.body.checks.openMeteo.ok).toBe(true);
    // Wall time must be bounded by the per-probe timeout, NOT by the
    // hung probe's 10s sleep. Allow generous slack for CI noise.
    expect(elapsed).toBeLessThan(4000);
  }, 8000);

  it('withTimeout rejects in ≈2000ms with TimeoutError', async () => {
    const start = Date.now();
    await expect(
      withTimeout(new Promise<void>(() => { /* never */ }), 2000),
    ).rejects.toBeInstanceOf(TimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(2500);
  }, 5000);

  it('marks optional photogrammetry probe healthy + skipped when unconfigured', async () => {
    const app = buildAppWithProbes({
      firestore: okProbe,
      kms: okProbe,
      gemini: okProbe,
      resend: okProbe,
      openMeteo: okProbe,
      // Probe returns `{ skipped: true }` when env var is unset — same
      // behavior as the real `checkPhotogrammetryWorker`.
      photogrammetry: okSkipped,
    });
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.checks.photogrammetry.ok).toBe(true);
    expect(res.body.checks.photogrammetry.skipped).toBe(true);
  });

  it('runs all probes in parallel — total time < sum of per-probe latencies', async () => {
    // Each probe sleeps 200ms. Sequential = 1200ms; parallel ≈ 200ms.
    const slow200 = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 200));
    const app = buildAppWithProbes({
      firestore: slow200,
      kms: slow200,
      gemini: slow200,
      resend: slow200,
      openMeteo: slow200,
      photogrammetry: slow200,
    });
    const start = Date.now();
    const res = await request(app).get('/api/health/deep');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Generous upper bound — the parallel path must finish well under
    // the 6 × 200ms = 1200ms sequential lower bound. CI machines can
    // be slow, so we use 800ms (still ½ of sequential).
    expect(elapsed).toBeLessThan(800);
  }, 6000);

  it('reports the underlying error message when a probe throws (non-timeout)', async () => {
    const app = buildAppWithProbes({
      firestore: okProbe,
      kms: () => Promise.reject(new Error('kms_unreachable')),
      gemini: okProbe,
      resend: okProbe,
      openMeteo: okProbe,
      photogrammetry: okSkipped,
    });
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.kms.ok).toBe(false);
    expect(res.body.checks.kms.error).toBe('kms_unreachable');
    // Latency for a thrown error is still reported.
    expect(typeof res.body.checks.kms.latencyMs).toBe('number');
  });
});

// Bonus — verify withTimeout settles cleanly when the inner promise
// resolves before the deadline (no late-resolution unhandled rejection).
describe('withTimeout', () => {
  it('resolves with the inner value when the inner promise wins', async () => {
    const v = await withTimeout(Promise.resolve(42), 1000);
    expect(v).toBe(42);
  });

  it('does not leak after the inner promise rejects late', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(
        withTimeout(
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('late')), 100)),
          50,
        ),
      ).rejects.toBeInstanceOf(TimeoutError);
      // Wait past the late rejection so we'd see the leak if any.
      await new Promise((r) => setTimeout(r, 200));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
