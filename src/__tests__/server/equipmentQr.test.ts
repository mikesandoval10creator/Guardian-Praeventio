// Real-router supertest for the equipment-QR pre-use inspection endpoints
// (src/server/routes/equipmentQr.ts). Mounts the ACTUAL router through the
// reusable fakeFirestore + the REAL EquipmentAdapter + the REAL validation
// engine, so this is genuine coverage of the production handlers (the route had
// 0 tests).
//
// Focus: the auth/role gate on `register`, payload validation, and the
// SAFETY-CRITICAL pre-use contract — a failed checklist on a CRITICAL machine
// RECOMMENDS not operating and downgrades the master status, but NEVER blocks
// the worker physically (project directive: recommend scientifically, never
// block machinery — no `blocked` flag is ever set).

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));
// idempotencyKey is opt-in (the client attaches an `Idempotency-Key` header).
// Without that header the prod middleware passes through; stub it to a no-op so
// the test never touches the idempotency cache.
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import equipmentQrRouter from '../../server/routes/equipmentQr.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/equipment', equipmentQrRouter);
  return app;
}

const BASE = '/api/equipment/p1/equipment-qr';

// A complete, all-passing checklist for the `compresor` type (items c1/c2/c3).
const COMPRESOR_PASS = [
  { itemId: 'c1', result: 'passed' },
  { itemId: 'c2', result: 'passed' },
  { itemId: 'c3', result: 'passed' },
];

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['boss', 'w1'] });
});

/** Register an equipment master via the route (supervisor) and return its qrId. */
async function registerEquipment(over: Record<string, unknown> = {}): Promise<string> {
  const res = await request(buildApp())
    .post(`${BASE}/register`)
    .set('x-test-uid', 'boss')
    .set('x-test-role', 'supervisor')
    .send({ code: 'CMP-01', type: 'compresor', criticality: 'critical', ...over });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.equipment.id as string;
}

describe('POST /equipment-qr/register', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/register`)
      .send({ code: 'X', type: 'compresor', criticality: 'low' });
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a plain worker (only supervisors register masters)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/register`)
      .set('x-test-uid', 'w1')
      .set('x-test-role', 'operario')
      .send({ code: 'X', type: 'compresor', criticality: 'low' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('201 + qrPayload when a supervisor registers', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/register`)
      .set('x-test-uid', 'boss')
      .set('x-test-role', 'supervisor')
      .send({ code: 'CMP-01', type: 'compresor', criticality: 'critical' });
    expect(res.status).toBe(201);
    expect(res.body.equipment.status).toBe('operativo');
    expect(res.body.qrPayload).toBe(`equipment:${res.body.equipment.id}`);
  });

  it('400 on an out-of-enum criticality (schema)', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/register`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ code: 'X', type: 'compresor', criticality: 'extreme' });
    expect(res.status).toBe(400);
  });
});

describe('GET /equipment-qr/:qrId', () => {
  it('404 when the equipment does not exist', async () => {
    const res = await request(buildApp()).get(`${BASE}/nonexistent`).set('x-test-uid', 'w1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('equipment_not_found');
  });

  it('200 + the type checklist for a registered equipment', async () => {
    const qrId = await registerEquipment({ type: 'compresor' });
    const res = await request(buildApp()).get(`${BASE}/${qrId}`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.equipment.id).toBe(qrId);
    expect(res.body.checklist.map((i: { id: string }) => i.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('GET /equipment-qr/list-by-site', () => {
  it('400 on an invalid status filter', async () => {
    const res = await request(buildApp())
      .get(`${BASE}/list-by-site?status=banana`)
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });

  it('200 lists operativo equipment by default', async () => {
    await registerEquipment({ code: 'A', type: 'compresor' });
    const res = await request(buildApp()).get(`${BASE}/list-by-site`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body.equipment.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /equipment-qr/:qrId/preuse — safety contract', () => {
  it('404 when the equipment does not exist', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/ghost/preuse`)
      .set('x-test-uid', 'w1')
      .send({ responses: COMPRESOR_PASS });
    expect(res.status).toBe(404);
  });

  it('422 preuse_validation_error when the checklist is incomplete', async () => {
    const qrId = await registerEquipment({ type: 'compresor' });
    const res = await request(buildApp())
      .post(`${BASE}/${qrId}/preuse`)
      .set('x-test-uid', 'w1')
      .send({ responses: [{ itemId: 'c1', result: 'passed' }] }); // missing c2, c3
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('preuse_validation_error');
    expect(res.body.code).toBe('CHECKLIST_INCOMPLETE');
  });

  it('201 "proceed" when every checklist item passes', async () => {
    const qrId = await registerEquipment({ type: 'compresor', criticality: 'critical' });
    const res = await request(buildApp())
      .post(`${BASE}/${qrId}/preuse`)
      .set('x-test-uid', 'w1')
      .send({ responses: COMPRESOR_PASS });
    expect(res.status).toBe(201);
    expect(res.body.validation.passed).toBe(true);
    expect(res.body.recommendation.action).toBe('proceed');
    expect(res.body.appliedStatus).toBe('operativo');
  });

  it('RECOMMENDS not operating — but NEVER blocks — a failed check on a critical machine', async () => {
    const qrId = await registerEquipment({ type: 'compresor', criticality: 'critical' });
    const res = await request(buildApp())
      .post(`${BASE}/${qrId}/preuse`)
      .set('x-test-uid', 'w1')
      .send({
        responses: [
          { itemId: 'c1', result: 'failed' },
          { itemId: 'c2', result: 'passed' },
          { itemId: 'c3', result: 'passed' },
        ],
      });
    // The inspection is RECORDED (201), never rejected — the worker is informed,
    // not blocked.
    expect(res.status).toBe(201);
    expect(res.body.validation.passed).toBe(false);
    expect(res.body.recommendation.action).toBe('recommend_not_operate');
    expect(res.body.recommendation.severity).toBe('critical');
    // Master status is downgraded so others see the recommendation, but there is
    // NO hard block — directive: recommend scientifically, never block machinery.
    expect(res.body.appliedStatus).toBe('fuera_servicio');
    expect(res.body.recommendation).not.toHaveProperty('blocked');
    expect(JSON.stringify(res.body)).not.toMatch(/bloquea|"blocked"/i);
  });

  it('downgrades a failed non-critical machine to restringido (not fuera_servicio)', async () => {
    const qrId = await registerEquipment({ type: 'compresor', criticality: 'low' });
    const res = await request(buildApp())
      .post(`${BASE}/${qrId}/preuse`)
      .set('x-test-uid', 'w1')
      .send({
        responses: [
          { itemId: 'c1', result: 'failed' },
          { itemId: 'c2', result: 'passed' },
          { itemId: 'c3', result: 'passed' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.recommendation.action).toBe('recommend_report_supervisor');
    expect(res.body.appliedStatus).toBe('restringido');
  });
});

describe('GET /equipment-qr/:qrId/history', () => {
  it('200 returns the pre-use history after an inspection is recorded', async () => {
    const qrId = await registerEquipment({ type: 'compresor', criticality: 'low' });
    await request(buildApp())
      .post(`${BASE}/${qrId}/preuse`)
      .set('x-test-uid', 'w1')
      .send({ responses: COMPRESOR_PASS });
    const res = await request(buildApp()).get(`${BASE}/${qrId}/history`).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBeGreaterThanOrEqual(1);
  });
});
