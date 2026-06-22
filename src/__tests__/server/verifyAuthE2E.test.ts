// Praeventio Guard — Sprint 19 / F-B05.
//
// E2E_MODE guard tests for `verifyAuth`. The middleware accepts an
// `Authorization: E2E <secret>:<uid>` header ONLY when:
//   - process.env.E2E_MODE === '1'
//   - process.env.NODE_ENV !== 'production'
//   - process.env.E2E_TEST_SECRET is defined and matches the provided secret
//
// In production NODE_ENV the guard MUST stay inert no matter what env vars
// are set. A configuration error (NODE_ENV=production && E2E_MODE=1) is a
// startup-time fatal — exercised in the third describe block via re-import.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// §2.31 open-handle fix: this file re-imports verifyAuth 6× via
// `vi.resetModules()`. verifyAuth pulls in the REAL firebase-admin AND the
// observability index (which starts the OpenTelemetry NodeSDK +
// auto-instrumentations at `tracing.ts:120 sdk.start()`). Re-evaluating those
// heavy modules on every re-import leaked a TCP server + sockets (found via
// `DETECT_HANDLES=1`), which kept the forked test worker alive → the
// intermittent 30-min CI "Tests" hang. These tests only exercise verifyAuth's
// env-gated E2E-header logic — they never call `verifyIdToken` or the tracer —
// so stubbing both deps is behaviour-preserving and stops the leak at the root.
vi.mock('firebase-admin', () => ({
  default: { auth: () => ({ verifyIdToken: vi.fn() }) },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

describe('verifyAuth — E2E_MODE guard', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Ensure firebase-admin's verifyIdToken is not actually called in E2E mode.
    vi.resetModules();
  });

  afterEach(() => {
    // Restore env between tests so stale values don't leak.
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('accepts Authorization: E2E <secret>:<uid> when E2E_MODE=1 and NODE_ENV=test', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'test-secret-do-not-use-in-prod';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user!.uid, email: req.user!.email });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E test-secret-do-not-use-in-prod:e2e-user-001');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('e2e-user-001');
    expect(res.body.email).toBe('e2e@praeventio.test');
  });

  it('rejects E2E header with 401 when E2E_MODE is unset', async () => {
    delete process.env.E2E_MODE;
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'test-secret-do-not-use-in-prod';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E test-secret-do-not-use-in-prod:e2e-user-001');

    // E2E_MODE not enabled â‡’ E2E header is rejected because it is not a Bearer scheme.
    expect(res.status).toBe(401);
  });

  it('rejects E2E header with 401 when secret does not match', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'real-secret';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E wrong-secret:e2e-user-001');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid e2e secret/i);
  });

  it('returns 500 when E2E_MODE=1 but E2E_TEST_SECRET is missing', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    delete process.env.E2E_TEST_SECRET;

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E anything:e2e-user-001');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/e2e_test_secret missing/i);
  });

  it('rejects requests with no Authorization header', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'test-secret-do-not-use-in-prod';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  it('throws at module load when NODE_ENV=production and E2E_MODE=1', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'production';

    await expect(async () => {
      await import('../../server/middleware/verifyAuth.js');
    }).rejects.toThrow(/FATAL.*production.*E2E_MODE/i);
  });

  // V12 — timing-safe E2E secret compare.
  // The compare `providedSecret !== secret` was replaced by `!safeSecretEqual(...)`.
  // These tests verify behavioral parity: wrong secret still 401, correct still 200.
  // The constant-time property cannot be asserted in unit tests (timing is env-dependent)
  // but the behavioral contract is the observable requirement we pin here.
  it('V12: accepts the correct secret after wiring safeSecretEqual (constant-time path)', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'ct-secret-32-chars-padding-here!';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user!.uid });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E ct-secret-32-chars-padding-here!:uid-ct');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('uid-ct');
  });

  it('V12: rejects a wrong secret with 401 via safeSecretEqual (constant-time path)', async () => {
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'ct-secret-32-chars-padding-here!';

    const { verifyAuth } = await import('../../server/middleware/verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E wrong-secret:uid-ct');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid e2e secret/i);
  });
});
