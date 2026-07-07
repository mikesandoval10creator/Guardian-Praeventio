// Praeventio Guard — Normatives router: real-router supertest (Bloque E3).
//
// Exercises the REAL normatives router mounted under /api/normatives. The test
// pins the important compliance fix: the seed/write happens server-side and
// writes an `audit_logs` row stamped from the verified token.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({
      uid,
      customClaims: { role: H.roles[uid] },
      email: `${uid}@praeventio.test`,
      displayName: `User ${uid}`,
    }),
  };
  return adminMock(() => H.db!, auth);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    req.user = { uid, email: req.header('x-test-email') ?? null } as Request['user'];
    next();
  },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import normativesRouter from './normatives';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/normatives';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, normativesRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

function auditRows() {
  return [...H.db!._store.entries()]
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, any>);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.roles = { gerente1: 'gerente', admin1: 'admin', worker1: 'operario' };
});

describe('POST /api/normatives/seed', () => {
  it('401 when no token is present', async () => {
    const res = await request(buildApp()).post(`${PREFIX}/seed`).send({});
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not admin/gerente', async () => {
    const res = await request(buildApp()).post(`${PREFIX}/seed`).set(asUser('worker1')).send({});
    expect(res.status).toBe(403);
    expect(H.db!._store.size).toBe(0);
  });

  it('200 seeds missing normatives server-side and writes an audit row', async () => {
    const res = await request(buildApp()).post(`${PREFIX}/seed`).set(asUser('gerente1')).send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBeGreaterThan(0);

    const normatives = [...H.db!._store.entries()]
      .filter(([k]) => k.startsWith('normatives/'))
      .map(([, v]) => v as Record<string, any>);
    expect(normatives).toHaveLength(res.body.created);
    expect(normatives.some((n) => n.code === 'Ley 16.744')).toBe(true);
    expect(normatives.every((n) => n.status === 'active')).toBe(true);
    expect(normatives.every((n) => n.seededBy === 'gerente1')).toBe(true);

    const audit = auditRows().find((r) => r.action === 'normatives.seed');
    expect(audit, 'a normatives.seed audit row must exist').toBeTruthy();
    expect(audit!.module).toBe('normatives');
    expect(audit!.userId).toBe('gerente1');
    expect(audit!.details?.createdCount).toBe(res.body.created);
    expect(audit!.details?.createdCodes).toContain('Ley 16.744');
  });

  it('is idempotent: skips existing codes but still audits the seed attempt', async () => {
    H.db!._seed('normatives/existing-ley', {
      code: 'Ley 16.744',
      title: 'Existing Ley',
      category: 'Seguridad Social',
      description: 'Already seeded',
      status: 'active',
    });

    const res = await request(buildApp()).post(`${PREFIX}/seed`).set(asUser('admin1')).send({});

    expect(res.status).toBe(200);
    expect(res.body.createdCodes).not.toContain('Ley 16.744');
    expect(H.db!._store.get('normatives/existing-ley')).toMatchObject({ title: 'Existing Ley' });

    const audit = auditRows().find((r) => r.action === 'normatives.seed');
    expect(audit).toBeTruthy();
    expect(audit!.userId).toBe('admin1');
  });
});
