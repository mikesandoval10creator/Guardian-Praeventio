// Real-router supertest for POST /api/zettelkasten/backlinks (§ZK-1 wire,
// 2026-05-29). Mounts the ACTUAL zettelkasten router and drives the real
// edge stack — buildEdgeStore (shared Firestore adapter) -> getRelatedNodes
// -> summarizeBacklinks/topReferencingNodes — through the reusable
// fakeFirestore. Genuine coverage of the production handler + the previously
// orphan backlinks aggregator, not a parallel copy.
//
// Advisory only: reads tenant-scoped edges, never writes.

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

const URL = '/api/zettelkasten/backlinks';

interface RelatedOut {
  nodeId: string;
  via: string;
  direction: 'incoming' | 'outgoing';
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('POST /api/zettelkasten/backlinks (real router)', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post(URL).send({ projectId: 'p1', nodeId: 'nodeX' });
    expect(res.status).toBe(401);
  });

  it('400 when nodeId is missing (Zod)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'nodeX' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 tenant_not_found when the project doc has no tenantId', async () => {
    H.db!._seed('projects/p1', { members: ['u1'] }); // no tenantId
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'nodeX' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('summarizes bidirectional backlinks + ranks referencing nodes (hubs)', async () => {
    // One outgoing edge (nodeX -> epp1) and one incoming (worker1 -> nodeX).
    H.db!._seed('tenants/t1/zettelkasten_edges/e1', {
      id: 'e1', fromNodeId: 'nodeX', toNodeId: 'epp1', type: 'requires', tenantId: 't1',
    });
    H.db!._seed('tenants/t1/zettelkasten_edges/e2', {
      id: 'e2', fromNodeId: 'worker1', toNodeId: 'nodeX', type: 'requires', tenantId: 't1',
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'nodeX' });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalRelated).toBe(2);
    expect(res.body.summary.totalIncoming).toBe(1);
    expect(res.body.summary.totalOutgoing).toBe(1);
    expect(res.body.summary.uniqueNodeCount).toBe(2);
    // Hub-detection: the incoming source ranks as a referencing node.
    expect(res.body.topReferencing[0].nodeId).toBe('worker1');
    expect(res.body.topReferencing[0].count).toBe(1);
    const related = res.body.related as RelatedOut[];
    expect(related.some((r) => r.nodeId === 'epp1' && r.direction === 'outgoing')).toBe(true);
    expect(related.some((r) => r.nodeId === 'worker1' && r.direction === 'incoming')).toBe(true);
  });

  it('node with no edges -> empty summary, no referencing nodes', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'lonelyNode' });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalRelated).toBe(0);
    expect(res.body.topReferencing).toEqual([]);
    expect(res.body.related).toEqual([]);
  });
});
