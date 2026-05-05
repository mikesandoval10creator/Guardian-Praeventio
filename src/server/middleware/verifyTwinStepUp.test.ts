// Sprint 26 — Bucket YY.3 tests — verifyTwinStepUp middleware.
//
// Cubre los 6 paths del ADR 0011 §"Server-side enforcement":
//   1. Happy path → next() llamado, payload anexado a req.
//   2. Header X-Twin-Step-Up faltante → 401 twin_stepup_missing.
//   3. Token con projectId distinto al request → 401 project_mismatch.
//   4. Token expirado por iat > recentMinutes → 401 twin_stepup_stale.
//   5. Token con firma inválida → 401 twin_stepup_invalid.
//   6. Token con uid distinto al req.user.uid → 401 uid_mismatch.

import { describe, it, expect, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  signTwinStepUpToken,
  verifyTwinStepUp,
} from './verifyTwinStepUp';

const SECRET = 'test-secret-do-not-use-in-prod-1234567890';

function buildApp(opts: {
  uid?: string;
  middlewareOpts?: Parameters<typeof verifyTwinStepUp>[0];
}) {
  const app = express();
  // Stub verifyAuth: populate req.user.uid like real verifyAuth would.
  app.use((req, _res, next) => {
    if (opts.uid) {
      (req as Request & { user?: { uid: string } }).user = { uid: opts.uid };
    }
    next();
  });
  app.get(
    '/twin/:projectId/data',
    verifyTwinStepUp({ secret: SECRET, ...opts.middlewareOpts }),
    (req: Request, res: Response) => {
      res.json({
        ok: true,
        twinStepUp: (req as Request & { twinStepUp?: unknown }).twinStepUp,
      });
    },
  );
  return app;
}

describe('verifyTwinStepUp — Bucket YY.3 (ADR 0011 server enforcement)', () => {
  it('1. happy path: valid token → next() + payload anexado', async () => {
    const token = await signTwinStepUpToken(
      { uid: 'worker-1', projectId: 'proj-A' },
      { secret: SECRET },
    );
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app)
      .get('/twin/proj-A/data')
      .set('X-Twin-Step-Up', token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.twinStepUp).toMatchObject({
      uid: 'worker-1',
      projectId: 'proj-A',
    });
  });

  it('2. header X-Twin-Step-Up faltante → 401 twin_stepup_missing', async () => {
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app).get('/twin/proj-A/data');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('twin_stepup_missing');
  });

  it('3. projectId del token ≠ projectId del request → 401 project_mismatch', async () => {
    const token = await signTwinStepUpToken(
      { uid: 'worker-1', projectId: 'proj-OTHER' },
      { secret: SECRET },
    );
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app)
      .get('/twin/proj-A/data')
      .set('X-Twin-Step-Up', token);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('twin_stepup_project_mismatch');
  });

  it('4. token con iat > recentMinutes → 401 twin_stepup_stale', async () => {
    // Firmamos hace 60 min, recentMinutes default 30.
    const sixtyMinAgoMs = Date.now() - 60 * 60 * 1000;
    const token = await signTwinStepUpToken(
      { uid: 'worker-1', projectId: 'proj-A' },
      {
        secret: SECRET,
        now: () => sixtyMinAgoMs,
        ttlSeconds: 24 * 60 * 60, // ttl largo para que jose no expire antes del check de stale
      },
    );
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app)
      .get('/twin/proj-A/data')
      .set('X-Twin-Step-Up', token);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('twin_stepup_stale');
  });

  it('5. firma inválida (wrong secret) → 401 twin_stepup_invalid', async () => {
    const token = await signTwinStepUpToken(
      { uid: 'worker-1', projectId: 'proj-A' },
      { secret: 'a-different-secret-1234567890abcdef' },
    );
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app)
      .get('/twin/proj-A/data')
      .set('X-Twin-Step-Up', token);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('twin_stepup_invalid');
  });

  it('6. uid del token ≠ req.user.uid → 401 uid_mismatch', async () => {
    const token = await signTwinStepUpToken(
      { uid: 'worker-OTHER', projectId: 'proj-A' },
      { secret: SECRET },
    );
    const app = buildApp({ uid: 'worker-1' });
    const res = await request(app)
      .get('/twin/proj-A/data')
      .set('X-Twin-Step-Up', token);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('twin_stepup_uid_mismatch');
  });

  it('bonus: secret muy corto → throw temprano (defensa contra config error)', async () => {
    await expect(
      signTwinStepUpToken(
        { uid: 'w', projectId: 'p' },
        { secret: 'short' },
      ),
    ).rejects.toThrow(/SESSION_SECRET.*too short/i);
  });
});
