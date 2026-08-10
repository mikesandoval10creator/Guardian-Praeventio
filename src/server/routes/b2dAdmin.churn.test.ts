// Tests para GET /api/admin/b2d/churn-snapshots — Ticket 399aa66d-73fe-81d3.
//
// El endpoint construye snapshots REALES desde Firestore (nunca métricas
// inventadas) y los devuelve para el <ChurnRiskPanel /> admin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  // assertAdmin usa admin.auth().getUser(uid).customClaims.role — devolvemos
  // 'admin' solo para 'admin-1' (mismo patrón que b2dAdmin.test.ts existente;
  // uid hardcodeado dentro del factory por hoisting de vi.mock).
  return adminMock(() => H.db!, {
    verifyIdToken: async () => ({ uid: 'test' }),
    getUser: async (uid: string) => ({
      uid,
      customClaims: { role: uid === 'admin-1' ? 'admin' : undefined },
    }),
  });
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = { uid, email: req.header('x-test-email') ?? null } as import('express').Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import b2dAdminRouter from './b2dAdmin';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/admin/b2d';
const ADMIN = 'admin-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, b2dAdminRouter);
  return app;
}

function seedAdminUser() {
  // assertAdmin lee users/{uid}.roles — admin necesita rol platform operator.
  H.db!._seed(`users/${ADMIN}`, {
    uid: ADMIN,
    roles: { platformOperator: true },
  });
}

function seedTenant(uid: string) {
  H.db!._seed(`users/${uid}`, {
    uid,
    createdAt: '2026-07-01T00:00:00.000Z',
    subscription: { planId: 'titanio', status: 'active', createdAt: '2026-07-01T00:00:00.000Z' },
  });
  H.db!._seed(`projects/p-${uid}`, {
    id: `p-${uid}`,
    name: `Proyecto ${uid}`,
    members: [uid],
    workersCount: 2,
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  H.db!._seed(`projects/p-${uid}/workers/w1`, { id: 'w1', name: 'Worker 1' });
  H.db!._seed(`projects/p-${uid}/workers/w2`, { id: 'w2', name: 'Worker 2' });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedAdminUser();
});

describe('GET /api/admin/b2d/churn-snapshots', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/b2d/churn-snapshots');
    expect(res.status).toBe(401);
  });

  it('200 returns real tenant snapshots (subscription + activity)', async () => {
    seedTenant('t1');
    seedTenant('t2');

    const res = await request(buildApp())
      .get('/api/admin/b2d/churn-snapshots')
      .set('x-test-uid', ADMIN);

    expect(res.status).toBe(200);
    const { snapshots } = res.body as {
      snapshots: Array<{ tenantId: string; hasPaidPlan: boolean; activeProjects: number; activeWorkers: number }>;
    };
    expect(snapshots).toHaveLength(2);
    const t1 = snapshots.find((s) => s.tenantId === 't1');
    expect(t1).toBeDefined();
    expect(t1!.hasPaidPlan).toBe(true);
    expect(t1!.activeProjects).toBe(1);
    expect(t1!.activeWorkers).toBe(2);
  });

  it('200 excludes users without subscription and without projects (no ghost tenants)', async () => {
    H.db!._seed(`users/ghost-1`, { uid: 'ghost-1', createdAt: '2026-07-01T00:00:00.000Z' });

    const res = await request(buildApp())
      .get('/api/admin/b2d/churn-snapshots')
      .set('x-test-uid', ADMIN);

    expect(res.status).toBe(200);
    const { snapshots } = res.body as { snapshots: Array<{ tenantId: string }> };
    expect(snapshots).toHaveLength(0);
  });
});
