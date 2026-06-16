// Real-router supertest for POST /api/zettelkasten/nl-query (NL incident search).
//
// REWRITE (2026-06-16): the previous version re-implemented the handler inline
// (a mini-app copy) AND baked in the bug it was meant to catch — it called
// `searchIncidents(projectId, …)` and seeded `incident_vectors/{projectId}`,
// so it was permanently green even though prod searched a never-written path.
// This version mounts the ACTUAL `router` (default export) and spies on
// `searchIncidents`, asserting the handler resolves the project's logical
// tenantId from `projects/{projectId}.tenantId` and passes THAT (not the
// projectId) to the RAG service — the real writer/reader contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  searchIncidents: null as
    | ((tenantId: string, query: string, topK: number, deps: unknown) => Promise<unknown>)
    | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

// Spy the RAG collaborator so we assert WHICH scope the handler passes it.
vi.mock('../../services/incidents/incidentRagService.js', () => ({
  searchIncidents: (...args: unknown[]) =>
    H.searchIncidents!(...(args as [string, string, number, unknown])),
}));

import zettelkastenRouter from '../../server/routes/zettelkasten.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zettelkasten', zettelkastenRouter);
  return app;
}

const UID = 'uid-1';
const PROJECT_ID = 'proj-A';
const TENANT_ID = 'tenant-X'; // intentionally != projectId — the bug-revealing part

/** Seed the project doc so assertProjectMember passes; optionally with a tenantId. */
function seedProject(opts: { member?: boolean; tenantId?: string } = {}) {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    members: [opts.member === false ? 'someone-else' : UID],
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.searchIncidents = vi.fn(async () => ({
    results: [{ incidentId: 'inc-1', projectId: PROJECT_ID, summary: 'Caída de altura.' }],
    citations: ['inc-1'],
  }));
});

describe('POST /api/zettelkasten/nl-query — validation', () => {
  it('401 without a token', async () => {
    seedProject({ tenantId: TENANT_ID });
    const res = await request(buildApp())
      .post('/api/zettelkasten/nl-query')
      .send({ query: 'altura', projectId: PROJECT_ID });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when query is empty', async () => {
    const res = await request(buildApp())
      .post('/api/zettelkasten/nl-query')
      .set('x-test-uid', UID)
      .send({ query: '', projectId: PROJECT_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a project member (search not attempted)', async () => {
    seedProject({ member: false, tenantId: TENANT_ID });
    const res = await request(buildApp())
      .post('/api/zettelkasten/nl-query')
      .set('x-test-uid', UID)
      .send({ query: 'altura', projectId: PROJECT_ID });
    expect(res.status).toBe(403);
    expect(H.searchIncidents).not.toHaveBeenCalled();
  });
});

describe('POST /api/zettelkasten/nl-query — real tenant scoping', () => {
  it('calls searchIncidents with the RESOLVED tenantId, NOT the projectId', async () => {
    seedProject({ tenantId: TENANT_ID });
    const res = await request(buildApp())
      .post('/api/zettelkasten/nl-query')
      .set('x-test-uid', UID)
      .send({ query: 'altura arnés', projectId: PROJECT_ID, topK: 3 });

    expect(res.status).toBe(200);
    expect(H.searchIncidents).toHaveBeenCalledTimes(1);
    const firstArg = (H.searchIncidents as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0];
    // The fix: the handler must pass the logical tenant, not the projectId
    // (which is what made the old code read a never-written vector path).
    expect(firstArg).toBe(TENANT_ID);
    expect(firstArg).not.toBe(PROJECT_ID);
    expect(res.body.results[0].incidentId).toBe('inc-1');
  });

  it('404 tenant_not_found when the project doc has no tenantId (search skipped)', async () => {
    seedProject({ tenantId: undefined }); // member, but no tenantId field
    const res = await request(buildApp())
      .post('/api/zettelkasten/nl-query')
      .set('x-test-uid', UID)
      .send({ query: 'altura', projectId: PROJECT_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
    expect(H.searchIncidents).not.toHaveBeenCalled();
  });
});
