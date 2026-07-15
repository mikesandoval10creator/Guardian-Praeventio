// Real-router supertest for the audited worker mutation endpoint
// (src/server/routes/workers.ts):
//   PATCH /api/projects/:projectId/workers/:workerId → update (200)
//
// Mounts the REAL router over a faithful fakeFirestore. assertProjectMember and
// auditServerEvent run REAL — only firebase-admin, verifyAuth and the logger
// are mocked. The point of this endpoint is the audit trail, so the happy path
// asserts a row landed in audit_logs/.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import workersRouter from '../../server/routes/workers.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', workersRouter);
  return app;
}

const member = { 'x-test-uid': 'u1' };
const TENANT = 't1';
const PROJECT = 'p1';
const WORKER = 'w1';
const PATH = `/api/projects/${PROJECT}/workers/${WORKER}`;
const WORKER_PATH = `projects/${PROJECT}/workers/${WORKER}`;

function seedMemberProject() {
  H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['u1'] });
}
function seedWorker() {
  H.db!._seed(WORKER_PATH, {
    name: 'Juan Pérez',
    role: 'Operador',
    email: 'juan@empresa.cl',
    phone: '+56 9 1111 1111',
    status: 'active',
    hasArt22: false,
    projectId: PROJECT,
  });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function auditRows(): any[] {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v);
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('PATCH /api/projects/:projectId/workers/:workerId', () => {
  it('401 without a token', async () => {
    seedMemberProject();
    seedWorker();
    const res = await request(buildApp()).patch(PATH).send({ role: 'Capataz' });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['someone-else'] });
    seedWorker();
    const res = await request(buildApp())
      .patch(PATH)
      .set(member)
      .send({ role: 'Capataz' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on an empty patch (schema requires at least one field)', async () => {
    seedMemberProject();
    seedWorker();
    const res = await request(buildApp()).patch(PATH).set(member).send({});
    expect(res.status).toBe(400);
  });

  it('400 on a bad field (invalid email)', async () => {
    seedMemberProject();
    seedWorker();
    const res = await request(buildApp())
      .patch(PATH)
      .set(member)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('404 when the worker does not exist', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .patch(PATH)
      .set(member)
      .send({ role: 'Capataz' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('worker_not_found');
  });

  it('200 updates whitelisted fields, stamps updatedAt, and writes an audit row', async () => {
    seedMemberProject();
    seedWorker();
    const res = await request(buildApp())
      .patch(PATH)
      .set(member)
      .send({ role: 'Capataz', hasArt22: true, status: 'inactive' });

    expect(res.status).toBe(200);
    expect(res.body.worker.role).toBe('Capataz');
    expect(res.body.worker.hasArt22).toBe(true);
    expect(res.body.worker.updatedAt).toBeTruthy();

    // Persisted.
    const stored = H.db!._dump()[WORKER_PATH];
    expect(stored.role).toBe('Capataz');
    expect(stored.status).toBe('inactive');

    // The whole point: an immutable audit row landed, stamped with caller uid.
    const audits = auditRows();
    expect(audits.length).toBe(1);
    expect(audits[0].action).toBe('workers.update');
    expect(audits[0].userId).toBe('u1');
    expect(audits[0].details.workerId).toBe(WORKER);
    expect(audits[0].details.fields).toContain('role');
  });

  it('ignores fields outside the whitelist (cannot reparent projectId)', async () => {
    seedMemberProject();
    seedWorker();
    const res = await request(buildApp())
      .patch(PATH)
      .set(member)
      .send({ role: 'Capataz', projectId: 'other-project' });
    // projectId is stripped by the schema; the update still succeeds on role.
    expect(res.status).toBe(200);
    const stored = H.db!._dump()[WORKER_PATH];
    expect(stored.projectId).toBe(PROJECT);
  });
});
