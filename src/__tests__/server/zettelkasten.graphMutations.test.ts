// Real-router behavioral coverage for server-authoritative Universal Knowledge
// graph mutations. The client context must never write `nodes` directly.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  auditServerEvent: vi.fn(async () => true),
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
    (req as Request & { user: { uid: string; email: string } }).user = {
      uid,
      email: `${uid}@example.cl`,
    };
    next();
  },
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: H.auditServerEvent,
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/ragService.js', () => ({
  generateIncidentEmbedding: vi.fn(async () => [0.1]),
}));
vi.mock('../../services/incidents/incidentRagService.js', () => ({
  searchIncidents: vi.fn(async () => ({ results: [] })),
}));

import { registerZettelkastenGraphMutationRoutes } from '../../server/routes/zettelkastenGraphMutations.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerZettelkastenGraphMutationRoutes(router);
  app.use('/api/zettelkasten', router);
  return app;
}

const NODE_URL = '/api/zettelkasten/graph/nodes';
const MIGRATION_URL = '/api/zettelkasten/graph/migrations';
const CONNECTION_URL = '/api/zettelkasten/graph/connections';

const nodeInput = {
  type: 'Riesgo',
  title: 'Riesgo de caída',
  description: 'Trabajo en borde abierto.',
  tags: ['altura'],
  metadata: { authorId: 'spoofed-user', probability: 4 },
  connections: [],
  isPublic: false,
  createdAt: '2000-01-01T00:00:00.000Z',
  updatedAt: '2000-01-01T00:00:00.000Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
  H.db._seed('projects/p2', { tenantId: 't2', members: ['u2'] });
  H.auditServerEvent.mockReset().mockResolvedValue(true);
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
});

describe('POST /graph/nodes (real zettelkasten router)', () => {
  it('returns 401 without verified auth', async () => {
    const res = await request(buildApp()).post(NODE_URL).send({ projectId: 'p1', node: nodeInput });
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid node shape', async () => {
    const res = await request(buildApp())
      .post(NODE_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', node: { title: '' } });
    expect(res.status).toBe(400);
  });

  it('rejects an invented node type before Admin SDK bypasses rules', async () => {
    const res = await request(buildApp())
      .post(NODE_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'poisoned-type', node: { ...nodeInput, type: 'ROOT_ACCESS' } });
    expect(res.status).toBe(400);
  });

  it('returns 403 and performs no write for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(NODE_URL)
      .set('x-test-uid', 'u2')
      .send({ projectId: 'p1', nodeId: 'outsider-node', node: nodeInput });
    expect(res.status).toBe(403);
    expect(Object.keys(H.db!._dump()).filter((key) => key.startsWith('nodes/'))).toEqual([]);
  });

  it('creates a project-bound node, server-stamps the actor/timestamps, and audits', async () => {
    const res = await request(buildApp())
      .post(NODE_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeId: 'member-node', node: { ...nodeInput, projectId: 'p2' } });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    const stored = H.db!._dump()[`nodes/${res.body.id}`];
    expect(stored).toMatchObject({
      type: 'Riesgo',
      title: 'Riesgo de caída',
      projectId: 'p1',
      metadata: { authorId: 'u1', probability: 4 },
    });
    expect(stored.createdAt).not.toBe(nodeInput.createdAt);
    expect(stored.updatedAt).not.toBe(nodeInput.updatedAt);
    expect(H.auditServerEvent).toHaveBeenCalledWith(
      expect.anything(),
      'zettelkasten.graph.node.create',
      'zettelkasten',
      expect.objectContaining({ nodeId: res.body.id }),
      { projectId: 'p1' },
    );
  });

  it('treats replay by the same actor as idempotent and audits only the first create', async () => {
    const body = { projectId: 'p1', nodeId: 'stable-replay', node: nodeInput };
    const first = await request(buildApp()).post(NODE_URL).set('x-test-uid', 'u1').send(body);
    const replay = await request(buildApp()).post(NODE_URL).set('x-test-uid', 'u1').send(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ id: 'stable-replay', created: false });
    expect(H.auditServerEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an existing node id by another actor', async () => {
    const body = { projectId: 'p1', nodeId: 'owned-id', node: nodeInput };
    await request(buildApp()).post(NODE_URL).set('x-test-uid', 'u1').send(body);
    const conflict = await request(buildApp()).post(NODE_URL).set('x-test-uid', 'u2').send(body);
    expect(conflict.status).toBe(409);
    const stored = H.db!._dump()['nodes/owned-id'];
    expect((stored.metadata as Record<string, unknown>).authorId).toBe('u1');
  });
});

describe('POST /graph/migrations (real zettelkasten router)', () => {
  it('returns 401 without verified auth', async () => {
    const res = await request(buildApp()).post(MIGRATION_URL).send({ projectId: 'p1', nodeIds: ['x'] });
    expect(res.status).toBe(401);
  });

  it('runs the server-owned migration over an in-project legacy node and audits', async () => {
    H.db!._seed('nodes/legacy-1', {
      type: 'Riesgo', title: 'Legacy', description: 'Nodo antiguo', projectId: 'p1',
      metadata: { authorId: 'u1' }, tags: 'altura, borde', createdAt: 'x', updatedAt: 'x',
    });

    const res = await request(buildApp())
      .post(MIGRATION_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeIds: ['legacy-1'] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ migrated: ['legacy-1'] });
    expect(H.db!._dump()['nodes/legacy-1']).toMatchObject({
      schemaVersion: 4,
      tags: ['altura', 'borde'],
      connections: [],
      metadata: { authorId: 'u1', geo: null },
    });
    expect(H.auditServerEvent).toHaveBeenCalledWith(
      expect.anything(),
      'zettelkasten.graph.nodes.migrate',
      'zettelkasten',
      { nodeIds: ['legacy-1'], count: 1 },
      { projectId: 'p1' },
    );
  });

  it('does not migrate a node belonging to another project', async () => {
    H.db!._seed('nodes/p2-node', {
      type: 'Riesgo', title: 'Tenant B', description: 'Privado', projectId: 'p2',
      metadata: { authorId: 'u2' }, tags: 'privado', createdAt: 'x', updatedAt: 'x',
    });
    const res = await request(buildApp())
      .post(MIGRATION_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', nodeIds: ['p2-node'] });
    expect(res.status).toBe(404);
    expect(H.db!._dump()['nodes/p2-node'].schemaVersion).toBeUndefined();
  });
});

describe('POST /graph/connections (real zettelkasten router)', () => {
  it('returns 403 for a non-member before reading either endpoint', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .post(CONNECTION_URL)
      .set('x-test-uid', 'u2')
      .send({ projectId: 'p1', fromId: 'risk-1', toId: 'control-1' });
    expect(res.status).toBe(403);
    expect(Object.keys(H.db!._dump()).filter((key) => key.startsWith('nodes/'))).toEqual([]);
  });

  it('returns 400 for a self-edge', async () => {
    const res = await request(buildApp())
      .post(CONNECTION_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', fromId: 'risk-1', toId: 'risk-1' });
    expect(res.status).toBe(400);
  });

  it('transactionally creates a reciprocal connection between two project nodes and audits', async () => {
    H.db!._seed('nodes/risk-1', { ...nodeInput, projectId: 'p1', metadata: { authorId: 'u1' } });
    H.db!._seed('nodes/control-1', {
      ...nodeInput, type: 'Control', title: 'Baranda', projectId: 'p1',
      metadata: { authorId: 'u1' }, connections: ['risk-1'],
    });

    const res = await request(buildApp())
      .post(CONNECTION_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', fromId: 'risk-1', toId: 'control-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true });
    expect(H.db!._dump()['nodes/risk-1'].connections).toEqual(['control-1']);
    expect(H.db!._dump()['nodes/control-1'].connections).toEqual(['risk-1']);
    expect(H.auditServerEvent).toHaveBeenCalledWith(
      expect.anything(),
      'zettelkasten.graph.nodes.connect',
      'zettelkasten',
      { fromId: 'risk-1', toId: 'control-1' },
      { projectId: 'p1' },
    );
  });

  it('rejects a cross-project endpoint without mutating either node', async () => {
    H.db!._seed('nodes/risk-1', { ...nodeInput, projectId: 'p1', connections: [] });
    H.db!._seed('nodes/p2-node', { ...nodeInput, projectId: 'p2', connections: [] });
    const res = await request(buildApp())
      .post(CONNECTION_URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', fromId: 'risk-1', toId: 'p2-node' });
    expect(res.status).toBe(404);
    expect(H.db!._dump()['nodes/risk-1'].connections).toEqual([]);
    expect(H.db!._dump()['nodes/p2-node'].connections).toEqual([]);
  });
});
