// Real-router supertest for the admin ARCO processing endpoints
// (Ley 21.719 roadmap gap G-8 / P0): until now `processDataAccessRequest`
// and `eraseUserData` (src/services/compliance/ley19628.ts) had NO HTTP
// surface invoking them, so access/erasure requests stayed `pending`
// forever — the right was "registered", never "satisfied".
//
//   POST /api/compliance/admin/data-request/:id/process  → access/portability
//   POST /api/compliance/admin/data-request/:id/erase    → approved erasure
//
// Security contract (mirrors admin.router.test.ts): the admin gate re-reads
// the caller role from Firebase Auth custom claims (server-authoritative),
// so a client token claiming `admin` cannot escalate. The ley19628 domain
// service runs REAL against fakeFirestore so the Firestore side effects
// (status transitions, deletions, legal-retention preservation) are the
// actual code under test — not a reimplementation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({ uid, customClaims: { role: H.roles[uid] } }),
  };
  return adminMock(() => H.db!, auth);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    // Deliberately attach a CLIENT-claimed role that may differ from the
    // Auth record — the route must ignore it and re-read from Auth.
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.cl`,
      role: req.header('x-test-claim-role') ?? 'worker',
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import complianceRouter from '../../server/routes/compliance.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Matches server.ts: app.use('/api/compliance', complianceRouter)
  app.use('/api/compliance', complianceRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

function auditRows(action: string) {
  return [...H.db!._store.entries()]
    .filter(([k, v]) => k.startsWith('audit_logs/') && v.action === action)
    .map(([, v]) => v);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.roles = { admin1: 'admin', gerente1: 'gerente', worker1: 'operario' };
});

// ---------------------------------------------------------------------------
// POST /api/compliance/admin/data-request/:id/process — access/portability
// ---------------------------------------------------------------------------

describe('POST /api/compliance/admin/data-request/:id/process', () => {
  function seedAccessRequest(id = 'req-acc-1', uid = 'victim') {
    H.db!._seed(`compliance_data_requests/${id}`, {
      uid,
      type: 'access',
      status: 'pending',
      requestedAt: 1717777777000,
    });
  }

  it('401 without token', async () => {
    seedAccessRequest();
    const res = await request(buildApp()).post(
      '/api/compliance/admin/data-request/req-acc-1/process',
    );
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller — even claiming admin in the client token', async () => {
    seedAccessRequest();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-acc-1/process')
      .set(asUser('worker1'))
      .set('x-test-claim-role', 'admin');
    expect(res.status).toBe(403);
    // The real processDataAccessRequest never ran: request still pending.
    expect(H.db!._store.get('compliance_data_requests/req-acc-1')?.status).toBe('pending');
  });

  it('404 nonexistent request id', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/no-such-req/process')
      .set(asUser('admin1'));
    expect(res.status).toBe(404);
  });

  it('400 when the request is an erasure (must use the /erase endpoint)', async () => {
    H.db!._seed('compliance_data_requests/req-er-x', {
      uid: 'victim',
      type: 'erasure',
      status: 'pending',
      requestedAt: 1717777777000,
    });
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-x/process')
      .set(asUser('admin1'));
    expect(res.status).toBe(400);
    expect(H.db!._store.get('compliance_data_requests/req-er-x')?.status).toBe('pending');
  });

  it('200 happy path: real processDataAccessRequest completes the row + audit written', async () => {
    seedAccessRequest();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-acc-1/process')
      .set(asUser('admin1'));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.request.status).toBe('completed');

    // Only the REAL processDataAccessRequest flips pending → completed and
    // stamps completedAt + exportedToUrl.
    const row = H.db!._store.get('compliance_data_requests/req-acc-1');
    expect(row?.status).toBe('completed');
    expect(typeof row?.completedAt).toBe('number');
    expect(row?.exportedToUrl).toBe('/api/compliance/data-export/req-acc-1');

    // Audit row with server-stamped identity (from the verified token).
    const audits = auditRows('arco_access_processed');
    expect(audits.length).toBe(1);
    expect(audits[0].userId).toBe('admin1');
    expect((audits[0].details as Record<string, unknown>).requestId).toBe('req-acc-1');
    expect((audits[0].details as Record<string, unknown>).targetUid).toBe('victim');
  });

  it('200 idempotent: a second process call on a completed row is a no-op', async () => {
    seedAccessRequest();
    const app = buildApp();
    await request(app)
      .post('/api/compliance/admin/data-request/req-acc-1/process')
      .set(asUser('admin1'));
    const res = await request(app)
      .post('/api/compliance/admin/data-request/req-acc-1/process')
      .set(asUser('admin1'));
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// POST /api/compliance/admin/data-request/:id/erase — destructive, confirmed
// ---------------------------------------------------------------------------

describe('POST /api/compliance/admin/data-request/:id/erase', () => {
  function seedErasureWorld() {
    H.db!._seed('compliance_data_requests/req-er-1', {
      uid: 'victim',
      type: 'erasure',
      status: 'pending',
      requestedAt: 1717777777000,
    });
    // The victim's personal data across exportable collections.
    H.db!._seed('users/victim-doc', { uid: 'victim', name: 'Víctima Test' });
    H.db!._seed('gamification_xp/x1', { uid: 'victim', xp: 100 });
    // Another user's data — must NEVER be touched.
    H.db!._seed('users/other-doc', { uid: 'someone-else', name: 'Otro' });
    // Legal-retention record (Ley 16.744 / DS 594, 7 years) — must survive
    // because the route erases with keepLegalRecords: true.
    H.db!._seed('audit_logs/legacy-row', { userId: 'victim', action: 'incident_report' });
  }

  it('401 without token', async () => {
    seedErasureWorld();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-1/erase')
      .send({ confirm: 'req-er-1' });
    expect(res.status).toBe(401);
  });

  it('403 non-admin caller — nothing erased', async () => {
    seedErasureWorld();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-1/erase')
      .set(asUser('worker1'))
      .set('x-test-claim-role', 'gerente')
      .send({ confirm: 'req-er-1' });
    expect(res.status).toBe(403);
    expect(H.db!._store.has('users/victim-doc')).toBe(true);
    expect(H.db!._store.get('compliance_data_requests/req-er-1')?.status).toBe('pending');
  });

  it('400 without confirm — destructive op requires body { confirm: requestId }', async () => {
    seedErasureWorld();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-1/erase')
      .set(asUser('admin1'))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('confirm_required');
    expect(H.db!._store.has('users/victim-doc')).toBe(true); // nothing erased
    expect(auditRows('arco_erasure_executed').length).toBe(0);
  });

  it('400 when confirm does not match the request id', async () => {
    seedErasureWorld();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-1/erase')
      .set(asUser('admin1'))
      .send({ confirm: 'some-other-id' });
    expect(res.status).toBe(400);
    expect(H.db!._store.has('users/victim-doc')).toBe(true);
  });

  it('404 nonexistent request id (confirm matching)', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/no-such-req/erase')
      .set(asUser('admin1'))
      .send({ confirm: 'no-such-req' });
    expect(res.status).toBe(404);
  });

  it('400 when the target request is not an erasure request', async () => {
    H.db!._seed('compliance_data_requests/req-acc-2', {
      uid: 'victim',
      type: 'access',
      status: 'pending',
      requestedAt: 1717777777000,
    });
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-acc-2/erase')
      .set(asUser('admin1'))
      .send({ confirm: 'req-acc-2' });
    expect(res.status).toBe(400);
  });

  it('200 happy path: real eraseUserData runs (keepLegalRecords) + before/after audit', async () => {
    seedErasureWorld();
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-1/erase')
      .set(asUser('gerente1')) // gerente is also an admin role
      .send({ confirm: 'req-er-1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The REAL eraseUserData deleted the victim's rows...
    expect(H.db!._store.has('users/victim-doc')).toBe(false);
    expect(H.db!._store.has('gamification_xp/x1')).toBe(false);
    // ...never another user's data...
    expect(H.db!._store.has('users/other-doc')).toBe(true);
    // ...and preserved legal-retention records (keepLegalRecords: true).
    expect(H.db!._store.has('audit_logs/legacy-row')).toBe(true);
    expect(res.body.result.preserved).toContain('audit_logs');

    // The request row is marked completed (re-persisted as compliance
    // evidence after the sweep deleted the victim's request docs).
    const row = H.db!._store.get('compliance_data_requests/req-er-1');
    expect(row?.status).toBe('completed');
    expect(typeof row?.completedAt).toBe('number');

    // Audit BEFORE and AFTER, server-stamped from the verified token.
    const started = auditRows('arco_erasure_started');
    const executed = auditRows('arco_erasure_executed');
    expect(started.length).toBe(1);
    expect(executed.length).toBe(1);
    expect(started[0].userId).toBe('gerente1');
    expect(executed[0].userId).toBe('gerente1');
    expect((executed[0].details as Record<string, unknown>).requestId).toBe('req-er-1');
    expect((executed[0].details as Record<string, unknown>).targetUid).toBe('victim');
    expect(Array.isArray((executed[0].details as Record<string, unknown>).erased)).toBe(true);
  });

  it('200 idempotent: erasing an already-completed request is a no-op (no second sweep)', async () => {
    H.db!._seed('compliance_data_requests/req-er-done', {
      uid: 'victim',
      type: 'erasure',
      status: 'completed',
      requestedAt: 1717777777000,
      completedAt: 1717777778000,
    });
    H.db!._seed('users/victim-doc', { uid: 'victim', name: 'Víctima Test' });
    const res = await request(buildApp())
      .post('/api/compliance/admin/data-request/req-er-done/erase')
      .set(asUser('admin1'))
      .send({ confirm: 'req-er-done' });
    expect(res.status).toBe(200);
    expect(res.body.alreadyCompleted).toBe(true);
    // No new sweep ran (doc re-created after completion stays put) and no
    // duplicate "executed" audit row for an op that did not run.
    expect(H.db!._store.has('users/victim-doc')).toBe(true);
    expect(auditRows('arco_erasure_executed').length).toBe(0);
  });
});
