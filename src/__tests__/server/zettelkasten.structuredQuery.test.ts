// Real-router supertest for POST /api/zettelkasten/structured-query
// (Alpha41 ZK-8). Mounts the ACTUAL zettelkasten router and drives the real
// stack — parsePatternQuery -> nodes scan (`nodes` collection, projectId
// filter) -> buildEdgeStore -> runStructuredQuery — through the reusable
// fakeFirestore. Read-only: nunca escribe.

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

const URL = '/api/zettelkasten/structured-query';

interface MatchOut {
  from: { id: string; type: string; title: string | null; severity: string | null };
  to: { id: string; type: string; title: string | null; severity: string | null };
  via: string;
  direction: 'incoming' | 'outgoing';
  edgeType: string;
}

function seedGraph() {
  // Nodos canónicos del proyecto (`nodes`, id de grafo = campo `id`).
  H.db!._seed('nodes/t1_p1_ctrl1', {
    id: 'ctrl1', type: 'Control', title: 'Arnés certificado', severity: 'medium', projectId: 'p1',
  });
  H.db!._seed('nodes/t1_p1_riskCrit', {
    id: 'riskCrit', type: 'Riesgo', title: 'Caída de altura', severity: 'critical', projectId: 'p1',
  });
  H.db!._seed('nodes/t1_p1_riskLow', {
    id: 'riskLow', type: 'Riesgo', title: 'Golpe menor', severity: 'low', projectId: 'p1',
  });
  // Aristas tenant-scoped: el control mitiga ambos riesgos.
  H.db!._seed('tenants/t1/zettelkasten_edges/e1', {
    id: 'e1', fromNodeId: 'ctrl1', toNodeId: 'riskCrit', type: 'mitigates',
    inverseType: 'mitigated_by', tenantId: 't1',
  });
  H.db!._seed('tenants/t1/zettelkasten_edges/e2', {
    id: 'e2', fromNodeId: 'ctrl1', toNodeId: 'riskLow', type: 'mitigates',
    inverseType: 'mitigated_by', tenantId: 't1',
  });
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('POST /api/zettelkasten/structured-query (real router)', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .send({ projectId: 'p1', pattern: '(:Control)-[:mitigates]->(:Riesgo)' });
    expect(res.status).toBe(401);
  });

  it('400 when pattern is missing (Zod)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('400 invalid_pattern when the cypher-lite pattern does not parse', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: 'esto no es un patrón' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_pattern');
    expect(res.body.reason).toBe('MALFORMED_PATTERN');
  });

  it('400 invalid_pattern on non-canonical edge type', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: '(:Control)-[:destroys]->(:Riesgo)' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('UNKNOWN_EDGE_TYPE');
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: '(:Control)-[:mitigates]->(:Riesgo)' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 tenant_not_found when the project doc has no tenantId', async () => {
    H.db!._seed('projects/p1', { members: ['u1'] }); // no tenantId
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: '(:Control)-[:mitigates]->(:Riesgo)' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200: WHERE severity=critical filtra al único riesgo crítico mitigado', async () => {
    seedGraph();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({
        projectId: 'p1',
        pattern: '(:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical',
      });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const matches = res.body.matches as MatchOut[];
    expect(matches[0].from.id).toBe('ctrl1');
    expect(matches[0].to.id).toBe('riskCrit');
    expect(matches[0].to.severity).toBe('critical');
    expect(matches[0].via).toBe('mitigates');
    expect(matches[0].direction).toBe('outgoing');
  });

  it('200: dirección invertida <-[:mitigates]- responde desde el riesgo', async () => {
    seedGraph();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: '(:Riesgo)<-[:mitigates]-(:Control)' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const matches = res.body.matches as MatchOut[];
    expect(matches.every((m) => m.direction === 'incoming')).toBe(true);
    expect(matches.every((m) => m.to.id === 'ctrl1')).toBe(true);
  });

  it('200 con grafo vacío -> cero matches', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', pattern: '(:Control)-[:mitigates]->(:Riesgo)' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.matches).toEqual([]);
  });
});
