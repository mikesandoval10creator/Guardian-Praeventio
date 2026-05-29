// Real-router supertest for §211-213 Confidential Reports / Ley Karín 21.643.
// (The sibling confidentialReports.test.ts only pins the receipt-ID crypto
// contract; this exercises the actual 5-endpoint handler for real coverage.)
//
// High privacy + security value: 3-layer anonymity (reporter stored as a hash,
// never raw uid unless identity is offered), handler-only access to the inbox
// and lifecycle actions, and a retaliation-pattern detector. Mounted via
// fakeFirestore.

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
    const role = req.header('x-test-role');
    (req as Request & { user: Record<string, unknown> }).user = { uid, ...(role ? { role } : {}) };
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

import crRouter from '../../server/routes/confidentialReports.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', crRouter);
  return app;
}
const PATH = 'tenants/t1/confidential_reports';
const create = (uid: string, body: Record<string, unknown>) =>
  request(buildApp()).post('/api/sprint-k/p1/confidential-reports').set('x-test-uid', uid).send(body);

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('POST create', () => {
  it('201 stores an anonymous report as a hash (no raw uid) with SLA dates', async () => {
    const res = await create('worker1', {
      kind: 'harassment',
      severity: 'high',
      narrative: 'Situación de acoso reiterada por un supervisor.',
      allowsIdentity: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.report.reporterAnonHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.report.reporterUid).toBeUndefined(); // anonymity preserved
    expect(res.body.report.status).toBe('open');
    expect(res.body.sla.firstResponseDueAt).toBeTruthy();
  });

  it('records reporterUid only when identity is offered', async () => {
    const res = await create('worker1', {
      kind: 'safety',
      severity: 'medium',
      narrative: 'Andamio sin línea de vida en el nivel 3.',
      allowsIdentity: true,
    });
    expect(res.body.report.reporterUid).toBe('worker1');
  });

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/confidential-reports')
      .send({ kind: 'safety', severity: 'low', narrative: 'x'.repeat(20), allowsIdentity: false });
    expect(res.status).toBe(401);
  });
});

describe('GET list — anonymity-preserving access', () => {
  it('a handler sees all reports; a reporter sees only their own', async () => {
    await create('repA', { kind: 'safety', severity: 'low', narrative: 'reporte de A '.repeat(2), allowsIdentity: false });
    await create('repB', { kind: 'safety', severity: 'low', narrative: 'reporte de B '.repeat(2), allowsIdentity: false });

    const asHandler = await request(buildApp())
      .get('/api/sprint-k/p1/confidential-reports')
      .set('x-test-uid', 'inv1')
      .set('x-test-role', 'investigator');
    expect(asHandler.body.role).toBe('investigator');
    expect(asHandler.body.reports).toHaveLength(2);

    const asReporter = await request(buildApp())
      .get('/api/sprint-k/p1/confidential-reports')
      .set('x-test-uid', 'repA');
    expect(asReporter.body.role).toBe('reporter');
    expect(asReporter.body.reports).toHaveLength(1); // only A's own
  });
});

describe('POST respond / close — handler-gated lifecycle', () => {
  beforeEach(() => {
    H.db!._seed(`${PATH}/cr1`, {
      id: 'cr1',
      projectId: 'p1',
      kind: 'harassment',
      severity: 'high',
      status: 'open',
      reporterAnonHash: 'hashX',
      submittedAt: new Date().toISOString(),
    });
  });

  it('403 when a non-handler tries to respond', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/confidential-reports/cr1/respond')
      .set('x-test-uid', 'worker1')
      .send({ message: 'no deberia poder' });
    expect(res.status).toBe(403);
  });

  it('handler respond moves open→investigating and appends an audit event', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/confidential-reports/cr1/respond')
      .set('x-test-uid', 'inv1')
      .set('x-test-role', 'investigator')
      .send({ message: 'Iniciamos la investigación, gracias por reportar.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('investigating');
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith(`${PATH}/cr1/audit/`));
    expect(auditKeys.length).toBe(1);
  });

  it('404 when responding to a missing report', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/confidential-reports/missing/respond')
      .set('x-test-uid', 'inv1')
      .set('x-test-role', 'investigator')
      .send({ message: 'x' });
    expect(res.status).toBe(404);
  });

  it('handler close with substantiated outcome → resolved', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/confidential-reports/cr1/close')
      .set('x-test-uid', 'admin1')
      .set('x-test-role', 'admin')
      .send({ resolution: 'Medidas aplicadas.', outcome: 'substantiated' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
  });
});

describe('GET retaliation-alerts', () => {
  it('403 for non-handlers', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/confidential-reports/retaliation-alerts')
      .set('x-test-uid', 'worker1');
    expect(res.status).toBe(403);
  });

  it('flags an adverse action against a reporter within the 90-day window', async () => {
    const reportAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const actionAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    H.db!._seed(`${PATH}/cr1`, {
      id: 'cr1', projectId: 'p1', reporterAnonHash: 'HASH1', submittedAt: reportAt, status: 'open',
    });
    H.db!._seed('tenants/t1/confidential_adverse_actions/a1', {
      workerUidHash: 'HASH1', changeKind: 'termination', changedAt: actionAt, notedByUid: 'hr1',
    });
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/confidential-reports/retaliation-alerts')
      .set('x-test-uid', 'admin1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toMatchObject({ reportId: 'cr1', actionKind: 'termination', severity: 'critical' });
  });
});
