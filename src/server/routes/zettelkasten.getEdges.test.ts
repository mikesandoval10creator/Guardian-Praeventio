// @vitest-environment node
// Praeventio Guard — zettelkasten get-edges router contract tests.
//
// PR-3a ZK-5 — POST /api/zettelkasten/get-edges expone el ZkEdge[] completo
// (con weight/decay) para RiskNetworkHealth.tsx. Cobertura de cada status code:
//   401 unauthorized      — sin token
//   400 invalid_payload   — schema rejects (empty projectId, limit=0, limit>2000, null)
//   403 forbidden         — caller NO es member del project (ProjectMembershipError)
//   404 tenant_not_found  — projectId no existe
//   200 + edges          — happy path con pesos
//   200 + edges=[]       — tenant sin edges
//   limit enforcement    — limit=1 retorna max 1; limit=2000 boundary ok
//   shape                — cada edge incluye weight/validFrom/validUntil/decayFn
//   cross-tenant         — caller no ve edges de OTRO tenant

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as unknown as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  >,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db);
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

vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import zettelkastenRouter from './zettelkasten.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zettelkasten', zettelkastenRouter);
  return app;
}

const TENANT_ID = 'tenant-zk-test';
const EDGE_COLLECTION = `tenants/${TENANT_ID}/zettelkasten_edges`;
const PROJECT_ID = 'p-zk-get-edges';
const MEMBER_UID = 'uid-zk-member';
const OTHER_TENANT_ID = 'tenant-zk-other';
const OTHER_EDGE_COLLECTION = `tenants/${OTHER_TENANT_ID}/zettelkasten_edges`;
const NON_MEMBER_UID = 'uid-zk-stranger';

function makeEdge(
  from: string,
  to: string,
  type: string,
  weight?: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fromNodeId: from,
    toNodeId: to,
    type,
    inverseType: type === 'mitigates' ? 'mitigated_by' : 'related_to',
    createdAt: '2026-08-20T00:00:00.000Z',
    createdBy: MEMBER_UID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    weight: weight ?? 1,
    decayFn: 'none',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'ZK Get Edges Test Project',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

describe('POST /api/zettelkasten/get-edges', () => {
  const path = '/api/zettelkasten/get-edges';

  it('returns 200 + edges con peso cuando el caller es member', async () => {
    H.db._seed(`${EDGE_COLLECTION}/e1`, makeEdge('A', 'B', 'mitigates', 0.5) as any);
    H.db._seed(`${EDGE_COLLECTION}/e2`, makeEdge('C', 'D', 'causes', 1) as any);

    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('edges');
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(res.body.edges.length).toBe(2);
    const types = res.body.edges.map((e: any) => e.type);
    expect(types).toContain('mitigates');
    expect(types).toContain('causes');
    const byFrom = Object.fromEntries(
      res.body.edges.map((e: any) => [e.fromNodeId, e]),
    );
    expect(byFrom.A.weight).toBe(0.5);
    expect(byFrom.A.decayFn).toBe('none');
  });

  it('200 + edges=[] cuando el tenant no tiene edges', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(200);
    expect(res.body.edges).toEqual([]);
  });

  it('401 unauthorized cuando el caller no esta autenticado', async () => {
    const res = await request(buildApp())
      .post(path)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('403 forbidden cuando el caller NO es member del project', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', NON_MEMBER_UID)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 tenant_not_found cuando projectId no existe', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: 'no-such-project' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('400 invalid_payload cuando projectId es string vacio', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: '' });

    expect(res.status).toBe(400);
  });

  it('400 invalid_payload cuando projectId es null', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: null });

    expect(res.status).toBe(400);
  });

  it('400 invalid_payload cuando limit=0', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID, limit: 0 });

    expect(res.status).toBe(400);
  });

  it('400 invalid_payload cuando limit > 2000', async () => {
    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID, limit: 2001 });

    expect(res.status).toBe(400);
  });

  it('200 respeta el límite: limit=1 retorna max 1 edge', async () => {
    H.db._seed(`${EDGE_COLLECTION}/e1`, makeEdge('A', 'B', 'mitigates', 0.5) as any);
    H.db._seed(`${EDGE_COLLECTION}/e2`, makeEdge('C', 'D', 'causes', 1) as any);

    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.edges.length).toBe(1);
  });

  it('200 respeta el límite: limit=2000 retorna todos (boundary)', async () => {
    H.db._seed(`${EDGE_COLLECTION}/e1`, makeEdge('A', 'B', 'mitigates') as any);

    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID, limit: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('shape: cada edge incluye campos de peso/decaimiento', async () => {
    H.db._seed(`${EDGE_COLLECTION}/e1`, {
      ...makeEdge('A', 'B', 'mitigates', 0.7, {
        validFrom: '2026-08-20T00:00:00.000Z',
        validUntil: '2027-08-20T00:00:00.000Z',
        decayFn: 'linear',
        decayHalfLifeMs: 86400000,
      }),
    } as any);

    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(200);
    const edge = res.body.edges[0];
    expect(edge).toHaveProperty('weight', 0.7);
    expect(edge).toHaveProperty('decayFn', 'linear');
    expect(edge).toHaveProperty('decayHalfLifeMs', 86400000);
    expect(edge).toHaveProperty('validFrom', '2026-08-20T00:00:00.000Z');
    expect(edge).toHaveProperty('validUntil', '2027-08-20T00:00:00.000Z');
  });

  it('no-unauth: caller NO ve edges de OTRO tenant (isolation tenant-scoped)', async () => {
    H.db._seed(`${OTHER_EDGE_COLLECTION}/e1`, makeEdge('X', 'Y', 'mitigates', 0.3) as any);

    const res = await request(buildApp())
      .post(path)
      .set('x-test-uid', MEMBER_UID)
      .send({ projectId: PROJECT_ID });

    expect(res.status).toBe(200);
    // Caller member of TENANT_ID, edges seeded under OTHER_TENANT_ID
    // must NOT leak. Endpoint is tenant-scoped via buildEdgeStore(db).listByTenant.
    expect(res.body.edges).toEqual([]);
  });
});
