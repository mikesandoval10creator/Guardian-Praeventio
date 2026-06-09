// SPDX-License-Identifier: MIT
//
// Phase 5 · IDOR cross-tenant (#700/#707/#708) — REAL-router supertest for
// POST /api/iot/devices/register.
//
// The sibling src/server/routes/iot.test.ts is a PARALLEL-APP reimplementation
// (it rebuilds the handler inline) — it can never catch a regression in the
// real route. This file mounts the ACTUAL `iotRouter` and mocks only the
// external edges (firebase-admin, verifyAuth, observability) so the real
// handler logic — including the new `assertProjectMember` cross-tenant guard —
// is exercised end to end.
//
// The bug: the admin/supervisor role check is GLOBAL; without a project-
// membership gate, a privileged user of tenant A could register a device into
// any tenant B's project (the tenant is derived from projects/{pid}.tenantId).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  roles: {} as Record<string, string | undefined>,
}));

// firebase-admin — Firestore via fakeFirestore; auth().getUser returns the
// per-uid role we stage in H.roles.
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({ uid, customClaims: { role: H.roles[uid] } }),
  });
});

// verifyAuth — x-test-uid header → req.user; 401 if absent.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

// idempotencyKey — passthrough (the real one is a no-op without the header, but
// we mock it to avoid any Firestore replay-store coupling).
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// auditServerEvent — no-op (the route already swallows its failures).
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => undefined),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// tracedAsync — just run the wrapped fn (no OTel).
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: vi.fn(async (_name: string, _attrs: unknown, fn: () => Promise<unknown>) => fn()),
}));

// projectMembership — REAL module, reads the fake db.

import iotRouter from '../../server/routes/iot.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PROJECT_ID = 'proj-iot-1';
const TENANT_ID = 'tenant-iot-a';
const ADMIN_MEMBER = 'uid-admin-member';
const ADMIN_OUTSIDER = 'uid-admin-outsider';
const WORKER_MEMBER = 'uid-worker-member';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/iot', iotRouter);
  return app;
}

const validBody = { deviceId: 'sensor-01', projectId: PROJECT_ID, type: 'gas_sensor' as const };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Project belongs to TENANT_ID; only ADMIN_MEMBER + WORKER_MEMBER are members.
  H.db._seed(`projects/${PROJECT_ID}`, {
    members: [ADMIN_MEMBER, WORKER_MEMBER],
    createdBy: ADMIN_MEMBER,
    tenantId: TENANT_ID,
  });
  H.roles = {
    [ADMIN_MEMBER]: 'admin',
    [ADMIN_OUTSIDER]: 'admin',
    [WORKER_MEMBER]: 'worker',
  };
});

describe('POST /api/iot/devices/register — real router, cross-tenant guard', () => {
  const URL = '/api/iot/devices/register';

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload on a bad device type', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', ADMIN_MEMBER)
      .send({ ...validBody, type: 'not_a_real_type' });
    expect(res.status).toBe(400);
  });

  it('403 when the caller lacks an admin/supervisor role', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', WORKER_MEMBER)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('403 when an admin of ANOTHER tenant is not a member of the target project (IDOR)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', ADMIN_OUTSIDER) // admin role, but NOT in project members
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 when an admin who IS a member registers a device (tenant derived from the project)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', ADMIN_MEMBER)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deviceId).toBe('sensor-01');
    // Tenant is derived from projects/{pid}.tenantId, never from the request body.
    expect(res.body.tenantId).toBe(TENANT_ID);
  });
});
