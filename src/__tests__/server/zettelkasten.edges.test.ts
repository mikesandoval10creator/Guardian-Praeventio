// Real-router supertest for POST /api/zettelkasten/edges (Alpha41 ZK-5).
// Mounts the ACTUAL zettelkasten router and drives the real edge stack —
// buildEdgeStore (shared Firestore adapter) -> listByTenant -> the id
// reconciliation — through the reusable fakeFirestore.
//
// The bug ZK-5 closes: an edge references the **zkNodeId** (the canonical
// node's inner `id` FIELD) while the explorer keys its nodes by the Firestore
// **doc id**. Without translating, every typed edge is dropped and the graph
// shows only untyped `node.connections` links. These tests pin the translation.
//
// Read-only: never writes.

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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
// Heavy sibling-route deps — stub so the import never loads genai/embeddings.
vi.mock('../../services/ragService.js', () => ({ generateEmbedding: vi.fn(async () => [0.1]) }));
vi.mock('../../services/incidents/incidentRagService.js', () => ({
  searchIncidents: vi.fn(async () => ({ results: [] })),
}));

import zettelkastenRouter from '../../server/routes/zettelkasten.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
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

const URL = '/api/zettelkasten/edges';

interface EdgeOut {
  source: string;
  target: string;
  type: string;
}

/**
 * Seed a canonical (materialized) node: the DOC id is the composite
 * `{tenantId}_{projectId}_{zkNodeId}`, while the inner `id` field carries the
 * raw zkNodeId that edges reference.
 */
function seedNode(zkNodeId: string) {
  const docId = `t1_p1_${zkNodeId}`;
  H.db!._seed(`nodes/${docId}`, { id: zkNodeId, projectId: 'p1', type: 'RISK' });
  return docId;
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('POST /api/zettelkasten/edges (real router)', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post(URL).send({ projectId: 'p1' });
    expect(res.status).toBe(401);
  });

  it('400 when projectId is missing (Zod)', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'u1').send({});
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 tenant_not_found when the project doc has no tenantId', async () => {
    H.db!._seed('projects/p1', { members: ['u1'] }); // no tenantId
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('ZK-5: returns typed+directed edges translated from zkNodeId to the doc ids the explorer holds', async () => {
    const riskDoc = seedNode('risk1');
    const controlDoc = seedNode('ctrl1');
    const eppDoc = seedNode('epp1');

    // Edges reference the zkNodeId — NOT the composite doc id.
    H.db!._seed('tenants/t1/zettelkasten_edges/e1', {
      id: 'e1', fromNodeId: 'ctrl1', toNodeId: 'risk1', type: 'mitigates', tenantId: 't1',
    });
    H.db!._seed('tenants/t1/zettelkasten_edges/e2', {
      id: 'e2', fromNodeId: 'risk1', toNodeId: 'epp1', type: 'requires', tenantId: 't1',
    });

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    const edges = res.body.edges as EdgeOut[];
    expect(edges).toHaveLength(2);

    // Direction is preserved (from → to) and endpoints are the DOC ids.
    expect(edges).toContainEqual({ source: controlDoc, target: riskDoc, type: 'mitigates' });
    expect(edges).toContainEqual({ source: riskDoc, target: eppDoc, type: 'requires' });
  });

  it('drops an edge whose endpoint is not a node of this project', async () => {
    const riskDoc = seedNode('risk1');
    expect(riskDoc).toBe('t1_p1_risk1'); // sanity: the composite id shape
    // `ghost` is never materialized into this project's nodes.
    H.db!._seed('tenants/t1/zettelkasten_edges/e1', {
      id: 'e1', fromNodeId: 'risk1', toNodeId: 'ghost', type: 'causes', tenantId: 't1',
    });

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body.edges).toEqual([]);
  });

  it('project with no edges -> empty list', async () => {
    seedNode('risk1');
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.edges).toEqual([]);
  });
});
