// SPDX-License-Identifier: MIT
// Adversarial role-gate test for PATCH /api/projects/:projectId/workers/:workerId.
// Ticket 3cdaa66d-73fe-81a6-b18e-fa56ae23d9dd — Workers PATCH must reject
// operario/worker callers even when assertProjectMember passes. Admin SDK
// bypasses firestore.rules:670 (admin/supervisor/creator gate), so the
// server-side gate here is the only defense for Ley 16.744 PII mutation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  createFakeFirestore,
  adminMock,
  type FakeFirestore,
} from '../helpers/fakeFirestore';

const H = vi.hoisted(() => ({ db: null as FakeFirestore | null }));

const authImpl = {
  verifyIdToken: async (token: string) => {
    const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
    const parts = raw.split(':');
    return {
      uid: parts[0] === 'test' ? parts[1] : 'unknown',
      email: parts[2] ?? null,
      role: parts[3] ?? undefined,
      admin: parts[4] === '1',
      tenantId: parts[5] ?? 't1',
    };
  },
  getUser: async (uid: string) => ({ uid }),
};

vi.mock('firebase-admin', () => adminMock(() => H.db!, authImpl));
vi.mock('../../server/services/auditLogs/auditServerEvent.js', () => ({
  auditServerEvent: vi.fn().mockResolvedValue(undefined),
}));

const PATCH_PATH = '/projects/p1/workers/w1';

const buildApp = async () => {
  const { default: workersRouter } = await import(
    '../../server/routes/workers.js'
  );
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/', workersRouter);
  return app;
};

const token = (uid: string, role: string, admin = false) =>
  `Bearer test:${uid}:${uid}@x.cl:${role}:${admin ? '1' : '0'}:t1`;

describe('PATCH /api/projects/:projectId/workers/:workerId (role gate)', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
  });
  afterEach(() => vi.restoreAllMocks());

  const seedProject = (createdBy: string, members: string[] = []) => {
    H.db!._seed('projects/p1', { createdBy, members });
    H.db!._seed('projects/p1/workers/w1', {
      name: 'Juan', email: 'j@x.cl', phone: '1', status: 'active', hasArt22: true,
    });
  };

  it('rejects operario member who is not creator/admin/supervisor', async () => {
    seedProject('other-user', ['caller']);
    const app = await buildApp();
    const res = await request(app)
      .patch(PATCH_PATH)
      .set('Authorization', token('caller', 'operario'))
      .send({ name: 'Hackeado' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect(H.db!._store.get('projects/p1/workers/w1')?.name).toBe('Juan');
  });

  it('rejects worker role', async () => {
    seedProject('other-user', ['caller']);
    const app = await buildApp();
    const res = await request(app)
      .patch(PATCH_PATH)
      .set('Authorization', token('caller', 'worker'))
      .send({ name: 'Hackeado 2' });
    expect(res.status).toBe(403);
  });

  it('allows project creator (operario role)', async () => {
    H.db!._seed('projects/p1', { createdBy: 'creator', members: [] });
    H.db!._seed('projects/p1/workers/w1', { name: 'Juan' });
    const app = await buildApp();
    const res = await request(app)
      .patch(PATCH_PATH)
      .set('Authorization', token('creator', 'operario'))
      .send({ name: 'Updated By Creator' });
    expect(res.status).toBe(200);
    expect(res.body.worker.name).toBe('Updated By Creator');
  });

  it('allows admin role', async () => {
    H.db!._seed('projects/p1', { createdBy: 'someone', members: ['admin-1'] });
    H.db!._seed('projects/p1/workers/w1', { name: 'Juan' });
    const app = await buildApp();
    const res = await request(app)
      .patch(PATCH_PATH)
      .set('Authorization', token('admin-1', 'admin'))
      .send({ name: 'Updated By Admin' });
    expect(res.status).toBe(200);
  });

  it('allows supervisor role', async () => {
    H.db!._seed('projects/p1', { createdBy: 'someone', members: ['sup'] });
    H.db!._seed('projects/p1/workers/w1', { name: 'Juan' });
    const app = await buildApp();
    const res = await request(app)
      .patch(PATCH_PATH)
      .set('Authorization', token('sup', 'supervisor'))
      .send({ name: 'Updated By Supervisor' });
    expect(res.status).toBe(200);
  });
});
