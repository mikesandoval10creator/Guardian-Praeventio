// Real-router supertest for the Knowledge Base endpoints (org knowledge graph
// — glossary/FAQ/procedures/lessons). Mounts the ACTUAL router
// (src/server/routes/knowledgeBase.ts) through the reusable fakeFirestore;
// the route had 0 tests. Covers all 4 endpoints: list, create, use
// (atomic viewCount increment), flag-obsolete — auth, validation, 404, and the
// state transitions.

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import kbRouter from '../../server/routes/knowledgeBase.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', kbRouter);
  return app;
}

const KB = '/api/sprint-k/p1/knowledge-base';
const KB_COLL = 'tenants/t1/projects/p1/knowledge_base';

function seedEntry(id: string, over: Record<string, unknown> = {}) {
  H.db!._seed(`${KB_COLL}/${id}`, {
    id, kind: 'guide', title: 'Procedimiento izaje', content: 'Pasos...',
    tags: ['izaje'], lastReviewedAt: '2025-01-01T00:00:00.000Z', viewCount: 0,
    isObsolete: false, authorUid: 'boss', createdAt: '2025-01-01T00:00:00.000Z', ...over,
  });
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['boss', 'w1'] });
});

describe('GET /knowledge-base', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(KB);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp()).get(KB).set('x-test-uid', 'stranger');
    expect(res.status).toBe(403);
  });

  it('paginates browsing by document ID, including after the cursor document disappears', async () => {
    for (const id of ['k4', 'k2', 'k1', 'k3']) seedEntry(id, { id: 'legacy-id' });
    H.db!._seed('tenants/t1/projects/p2/knowledge_base/k0', { title: 'Other project' });
    const app = buildApp();
    const first = await request(app).get(KB).query({ limit: 2 }).set('x-test-uid', 'w1');
    expect(first.status).toBe(200);
    expect(first.body.entries.map((e: { id: string }) => e.id)).toEqual(['k1', 'k2']);
    expect(first.body.nextCursor).toBe('k2');
    await H.db!.collection(KB_COLL).doc('k2').delete();
    const second = await request(app).get(KB).query({ limit: 2, cursor: first.body.nextCursor }).set('x-test-uid', 'w1');
    expect(second.status).toBe(200);
    expect(second.body.entries.map((e: { id: string }) => e.id)).toEqual(['k3', 'k4']);
    expect(second.body.nextCursor).toBeNull();
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: '2.5' }, { cursor: 'k1' },
    { limit: 2, cursor: 'a/b' }, { limit: 2, search: 'izaje' }, { limit: 2, category: 'guide' },
  ])('rejects invalid or incompatible pagination parameters %j', async (query) => {
    const res = await request(buildApp()).get(KB).query(query).set('x-test-uid', 'w1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_pagination');
  });

  it('caps a page of large articles without changing full-corpus search', async () => {
    for (let i = 0; i < 120; i += 1) {
      seedEntry(`k${String(i).padStart(3, '0')}`, { title: 'Article', content: 'x'.repeat(20_000) });
    }
    seedEntry('z-match', { title: 'Termografia', content: 'Revision tecnica' });
    const app = buildApp();
    const page = await request(app).get(KB).query({ limit: 50 }).set('x-test-uid', 'w1');
    expect(page.status).toBe(200);
    expect(page.body.entries).toHaveLength(50);
    expect(page.body.nextCursor).toBe('k049');
    const search = await request(app).get(KB).query({ search: 'termografia', category: 'guide' }).set('x-test-uid', 'w1');
    expect(search.status).toBe(200);
    expect(search.body.entries.map((e: { id: string }) => e.id)).toEqual(['z-match']);
  });

  it('200 returns seeded entries', async () => {
    seedEntry('k1', { title: 'LOTO bloqueo' });
    seedEntry('k2', { title: 'Trabajo en altura' });
    const res = await request(buildApp()).get(KB).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const titles = JSON.stringify(res.body);
    expect(titles).toContain('LOTO bloqueo');
    expect(titles).toContain('Trabajo en altura');
  });
});

describe('POST /knowledge-base (create)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(KB).send({ title: 'x', content: 'y' });
    expect(res.status).toBe(401);
  });

  it('400 when title is too short (schema min 3)', async () => {
    const res = await request(buildApp())
      .post(KB)
      .set('x-test-uid', 'boss')
      .send({ title: 'ab', content: 'contenido valido' });
    expect(res.status).toBe(400);
  });

  it('201 creates with an auto-id, viewCount 0, isObsolete false, server-stamped author', async () => {
    const res = await request(buildApp())
      .post(KB)
      .set('x-test-uid', 'boss')
      .send({ title: 'Procedimiento confinados', content: 'Protocolo MINSAL...', category: 'procedure' });
    expect(res.status).toBe(201);
    expect(res.body.entry.id).toBeTruthy();
    expect(res.body.entry.viewCount).toBe(0);
    expect(res.body.entry.isObsolete).toBe(false);
    expect(res.body.entry.authorUid).toBe('boss'); // from token, not body
    expect(res.body.entry.kind).toBe('procedure');
  });
});

describe('POST /knowledge-base/:id/use', () => {
  it('404 when the entry does not exist', async () => {
    const res = await request(buildApp()).post(`${KB}/ghost/use`).set('x-test-uid', 'w1');
    expect(res.status).toBe(404);
  });

  it('204 and atomically increments viewCount 0 -> 1', async () => {
    seedEntry('k1', { viewCount: 0 });
    const res = await request(buildApp()).post(`${KB}/k1/use`).set('x-test-uid', 'w1');
    expect(res.status).toBe(204);
    const stored = (await H.db!.collection(KB_COLL).doc('k1').get()).data() as Record<string, unknown>;
    expect(stored.viewCount).toBe(1);
  });
});

describe('POST /knowledge-base/:id/flag-obsolete', () => {
  it('404 when the entry does not exist', async () => {
    const res = await request(buildApp())
      .post(`${KB}/ghost/flag-obsolete`)
      .set('x-test-uid', 'boss')
      .send({ reason: 'normativa derogada' });
    expect(res.status).toBe(404);
  });

  it('400 when reason is too short', async () => {
    seedEntry('k1');
    const res = await request(buildApp())
      .post(`${KB}/k1/flag-obsolete`)
      .set('x-test-uid', 'boss')
      .send({ reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('204 marks obsolete + stamps reason/author', async () => {
    seedEntry('k1', { isObsolete: false });
    const res = await request(buildApp())
      .post(`${KB}/k1/flag-obsolete`)
      .set('x-test-uid', 'boss')
      .send({ reason: 'Reemplazado por DS 44/2024' });
    expect(res.status).toBe(204);
    const stored = (await H.db!.collection(KB_COLL).doc('k1').get()).data() as Record<string, unknown>;
    expect(stored.isObsolete).toBe(true);
    expect(stored.obsoleteReason).toBe('Reemplazado por DS 44/2024');
    expect(stored.obsoleteByUid).toBe('boss');
  });
});
