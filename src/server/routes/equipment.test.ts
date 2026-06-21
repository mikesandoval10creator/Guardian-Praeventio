// Praeventio Guard — equipment router behavioral tests (real router +
// supertest). Covers GET /:projectId/equipment, the Sprint I.5 Equipment
// Master listing endpoint backed by the real EquipmentFirestoreAdapter
// (nested path tenants/{tid}/projects/{pid}/equipment).
//
// Exercises every status code the route emits:
//   401 (no token), 403 (non-member), 404 (project has no tenantId),
//   200 (happy path — real adapter reads the nested equipment collection),
//   500 (Firestore read failure → no internal leak).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

import equipmentRouter from './equipment.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', equipmentRouter);
  return app;
}

const PROJECT_ID = 'p-eq-test';
const MEMBER_UID = 'uid-eq-member';
const NON_MEMBER_UID = 'uid-eq-stranger';
const TENANT_ID = 't-eq-1';

function seedProject(db: NonNullable<typeof H.db>, opts: { tenantId?: string } = {}) {
  const doc: Record<string, unknown> = {
    name: 'Equipment Test Project',
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  };
  if (opts.tenantId !== undefined) doc.tenantId = opts.tenantId;
  db._seed(`projects/${PROJECT_ID}`, doc);
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('equipmentRouter — GET /:projectId/equipment', () => {
  const path = `/api/sprint-k/${PROJECT_ID}/equipment`;

  it('401 without a token', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    const res = await request(buildApp()).get(path);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    const res = await request(buildApp())
      .get(path)
      .set('x-test-uid', NON_MEMBER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the project has no tenantId resolved', async () => {
    // Member of the project, but the project doc carries no tenantId — the
    // guard cannot resolve a tenant and must 404 (not 200 with leaked data).
    seedProject(H.db!); // no tenantId
    const res = await request(buildApp())
      .get(path)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns only equipment with status=operativo by default', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment`;
    H.db!._seed(`${base}/e1`, {
      id: 'e1',
      code: 'INV-001',
      type: 'gruahorquilla',
      status: 'operativo',
      criticality: 'critical',
      riskCategories: ['atropello'],
      requiresPreUseChecklist: true,
    });
    H.db!._seed(`${base}/e2`, {
      id: 'e2',
      code: 'INV-002',
      type: 'compresor',
      status: 'fuera_servicio', // filtered out by default status=operativo
      criticality: 'medium',
      riskCategories: [],
      requiresPreUseChecklist: false,
    });

    const res = await request(buildApp())
      .get(path)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.equipment)).toBe(true);
    expect(res.body.equipment).toHaveLength(1);
    expect(res.body.equipment[0]).toMatchObject({
      id: 'e1',
      code: 'INV-001',
      status: 'operativo',
    });
  });

  it('200 honors an explicit ?status= filter', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    const base = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment`;
    H.db!._seed(`${base}/e1`, {
      id: 'e1',
      code: 'INV-001',
      type: 'gruahorquilla',
      status: 'operativo',
      criticality: 'critical',
      riskCategories: [],
      requiresPreUseChecklist: true,
    });
    H.db!._seed(`${base}/e2`, {
      id: 'e2',
      code: 'INV-002',
      type: 'compresor',
      status: 'fuera_servicio',
      criticality: 'medium',
      riskCategories: [],
      requiresPreUseChecklist: false,
    });

    const res = await request(buildApp())
      .get(`${path}?status=fuera_servicio`)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.equipment).toHaveLength(1);
    expect(res.body.equipment[0].id).toBe('e2');
    expect(res.body.equipment[0].status).toBe('fuera_servicio');
  });

  it('200 with an empty list when no equipment matches', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    const res = await request(buildApp())
      .get(path)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(200);
    expect(res.body.equipment).toEqual([]);
  });

  it('500 with no internal leak when the adapter read fails', async () => {
    seedProject(H.db!, { tenantId: TENANT_ID });
    // Force the equipment collection read to throw AFTER the guard reads
    // (project doc / membership) succeed — the path substring only matches
    // the nested equipment collection.
    H.db!._failReads(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment`);
    const res = await request(buildApp())
      .get(path)
      .set('x-test-uid', MEMBER_UID);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
    // Never leak the raw error message / stack.
    expect(JSON.stringify(res.body)).not.toContain('forced read failure');
  });
});
