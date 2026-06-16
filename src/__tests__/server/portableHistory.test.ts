// Real-router supertest for F.18 Portable Worker History (Ley 19.628 privacy).
// Bug-hunting on the privacy contract: owner/admin-only access, identity
// REDACTED unless allowsPortableExport, incidents excluded unless
// includesIncidents, and the HARD export gate (403 without export consent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import portableRouter from '../../server/routes/portableHistory.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', portableRouter);
  return app;
}
const CONSENT = 'tenants/t1/projects/p1/workers/w1/portable_history/consent';
const get = (path: string, caller: string, admin = false) => {
  const r = request(buildApp()).get(`/api/sprint-k/p1/workers/${path}`).set('x-test-uid', caller);
  return admin ? r.set('x-test-admin', 'true') : r;
};

function seedWorker() {
  H.db!._seed('projects/p1/workers/w1', { name: 'Juan Pérez', rut: '12.345.678-9', email: 'juan@x.cl' });
}
function seedConsent(allowsPortableExport: boolean, includesIncidents: boolean) {
  H.db!._seed(CONSENT, { allowsPortableExport, includesIncidents, updatedAt: '2026-05-01T00:00:00Z', updatedByUid: 'w1' });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET portable-history (bundle) — owner-only + consent redaction', () => {
  it('403 when caller is neither the worker nor an admin', async () => {
    seedWorker();
    expect((await get('w1/portable-history', 'stranger')).status).toBe(403);
  });

  it('404 when the worker does not exist', async () => {
    expect((await get('w1/portable-history', 'w1')).status).toBe(404);
  });

  it('owner with NO export consent → identity is REDACTED', async () => {
    seedWorker();
    seedConsent(false, false);
    const res = await get('w1/portable-history', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.bundle.identity.fullName).toBe('[REDACTED]');
    expect(res.body.bundle.identity.rut).toBe('[REDACTED]');
  });

  it('owner WITH export consent → real identity', async () => {
    seedWorker();
    seedConsent(true, false);
    const res = await get('w1/portable-history', 'w1');
    expect(res.body.bundle.identity.fullName).toBe('Juan Pérez');
  });

  it('incidents excluded unless includesIncidents consent is set', async () => {
    seedWorker();
    H.db!._seed('tenants/t1/projects/p1/incidents/i1', { workerUid: 'w1', description: 'algo' });
    seedConsent(true, false);
    const noInc = await get('w1/portable-history', 'w1');
    expect(noInc.body.bundle.incidents).toHaveLength(0);
    seedConsent(true, true);
    const withInc = await get('w1/portable-history', 'w1');
    expect(withInc.body.bundle.incidents.length).toBeGreaterThan(0);
  });

  it('an admin may read another worker\'s bundle', async () => {
    seedWorker();
    seedConsent(true, false);
    const res = await get('w1/portable-history', 'admin1', true);
    expect(res.status).toBe(200);
  });

  it('cross-tenant: a global incident from ANOTHER project is excluded; same-project is included', async () => {
    seedWorker();
    seedConsent(true, true);
    // Same worker uid in the SHARED global `incidents` collection but from a
    // different employer/project — must NOT leak into this bundle (Ley 19.628).
    H.db!._seed('incidents/foreign', { workerUid: 'w1', projectId: 'OTHER-PROJ', description: 'incidente-ajeno' });
    // A global incident for THIS project is legitimately part of the bundle.
    H.db!._seed('incidents/mine', { workerUid: 'w1', projectId: 'p1', description: 'incidente-propio' });
    const res = await get('w1/portable-history', 'w1');
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body.bundle.incidents);
    expect(serialized).not.toContain('incidente-ajeno');
    expect(serialized).toContain('incidente-propio');
  });
});

describe('POST consent — owner-only', () => {
  it('403 for a non-owner', async () => {
    seedWorker();
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/workers/w1/portable-history/consent')
      .set('x-test-uid', 'stranger')
      .send({ allowsPortableExport: true, includesIncidents: true });
    expect(res.status).toBe(403);
  });

  it('200 owner updates + persists consent', async () => {
    seedWorker();
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/workers/w1/portable-history/consent')
      .set('x-test-uid', 'w1')
      .send({ allowsPortableExport: true, includesIncidents: false });
    expect(res.status).toBe(200);
    const stored = H.db!._dump()[CONSENT] as { allowsPortableExport: boolean };
    expect(stored.allowsPortableExport).toBe(true);
  });
});

describe('GET export — the hard Ley 19.628 consent gate', () => {
  it('403 consent_required_for_export when export consent is missing', async () => {
    seedWorker();
    seedConsent(false, false);
    const res = await get('w1/portable-history/export', 'w1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_required_for_export');
  });

  it('200 JSON export with a SHA-256 checksum header when consent allows', async () => {
    seedWorker();
    seedConsent(true, false);
    const res = await get('w1/portable-history/export?format=json', 'w1');
    expect(res.status).toBe(200);
    expect(res.headers['x-portable-history-checksum']).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('403 for a non-owner exporting', async () => {
    seedWorker();
    seedConsent(true, true);
    expect((await get('w1/portable-history/export', 'stranger')).status).toBe(403);
  });
});
