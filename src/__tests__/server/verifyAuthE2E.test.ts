// Praeventio Guard â€” Sprint 19 / F-B05.
//
// E2E_MODE guard tests for `verifyAuth`. The middleware accepts an
// `Authorization: E2E <secret>:<uid>` header ONLY when:
//   - process.env.E2E_MODE === '1'
//   - process.env.NODE_ENV !== 'production'
//   - process.env.E2E_TEST_SECRET is defined and matches the provided secret
//
// In production NODE_ENV the guard MUST stay inert no matter what env vars
// are set. A configuration error (NODE_ENV=production && E2E_MODE=1) is a
// startup-time fatal â€” exercised in the third describe block via re-import.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('verifyAuth â€” E2E_MODE guard', () => {
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
});
