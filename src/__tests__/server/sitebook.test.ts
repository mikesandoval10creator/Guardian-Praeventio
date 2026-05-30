// Real-router supertest for the Site Book (Bitácora de Obra) endpoints
// (src/server/routes/sitebook.ts). Mounts the ACTUAL router through the reusable
// fakeFirestore + the REAL SiteBookAdapter (atomic folio counter via
// runTransaction) + the REAL siteBookService, so this is genuine coverage of the
// production handlers (the route had 0 tests).
//
// The site logbook is a LEGAL append-only record (Ley 16.744 site book): there
// is no update/delete surface, folios are atomic + sequential, and every read is
// project-membership gated. Focus: auth + the tenant fallback, the create →
// atomic-folio → read-back round trip, and the validation boundaries.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // Default auth() — getUser() returns no customClaims, so resolveTenantId falls
  // back to the project document's tenantId (which we seed below).
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import sitebookRouter from '../../server/routes/sitebook.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sitebook', sitebookRouter);
  return app;
}

const BASE = '/api/sitebook/p1';

const validEntry = {
  kind: 'inspection',
  occurredAt: '2026-05-30T10:00:00.000Z',
  description: 'Inspección de andamios nivel 3 completada sin observaciones.',
};

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  // resolveTenantId falls back to this project doc's tenantId.
  H.db._seed('projects/p1', { tenantId: 't1', members: ['boss', 'w1'] });
});

describe('POST /sitebook/:projectId/entries', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(`${BASE}/entries`).send(validEntry);
    expect(res.status).toBe(401);
  });

  it('403 forbidden when the caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(`${BASE}/entries`)
      .set('x-test-uid', 'stranger')
      .send(validEntry);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when the description is shorter than 15 chars (schema)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/entries`)
      .set('x-test-uid', 'w1')
      .send({ ...validEntry, description: 'muy corto' });
    expect(res.status).toBe(400);
  });

  it('400 on an unknown entry kind (schema enum)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/entries`)
      .set('x-test-uid', 'w1')
      .send({ ...validEntry, kind: 'party' });
    expect(res.status).toBe(400);
  });

  it('201 creates an entry with a folio SB-YYYY-NNNNNN, stamping the recorder', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/entries`)
      .set('x-test-uid', 'boss')
      .set('x-test-role', 'supervisor')
      .send(validEntry);
    expect(res.status).toBe(201);
    expect(res.body.folio).toMatch(/^SB-2026-\d{6}$/);
    expect(res.body.kind).toBe('inspection');
    expect(res.body.recordedByUid).toBe('boss');
    expect(res.body.recordedByRole).toBe('supervisor');
  });

  it('assigns sequential, unique folios across concurrent-ish creates (atomic counter)', async () => {
    const app = buildApp();
    const a = await request(app).post(`${BASE}/entries`).set('x-test-uid', 'w1').send(validEntry);
    const b = await request(app).post(`${BASE}/entries`).set('x-test-uid', 'w1').send(validEntry);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.folio).not.toBe(b.body.folio);
    expect(b.body.sequenceNumber).toBe(a.body.sequenceNumber + 1);
  });
});

describe('GET /sitebook/:projectId/entry/:folio', () => {
  it('404 for an unknown folio', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/entry/SB-2026-999999`)
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('200 returns a previously-created entry by folio', async () => {
    const app = buildApp();
    const created = await request(app)
      .post(`${BASE}/entries`)
      .set('x-test-uid', 'w1')
      .send(validEntry);
    const folio = created.body.folio as string;
    const res = await request(app).get(`${BASE}/entry/${folio}`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.folio).toBe(folio);
    expect(res.body.description).toBe(validEntry.description);
  });
});

describe('GET /sitebook/:projectId/entries', () => {
  it('400 on an out-of-range year', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/entries?year=1999`)
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_year');
  });

  it('200 lists entries for the year with a count', async () => {
    const app = buildApp();
    await request(app).post(`${BASE}/entries`).set('x-test-uid', 'w1').send(validEntry);
    const res = await request(app).get(`${BASE}/entries?year=2026`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});
