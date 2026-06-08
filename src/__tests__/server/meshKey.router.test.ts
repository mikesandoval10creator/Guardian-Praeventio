// Real-router supertest for GET /api/mesh/key.
// Mounts the REAL mesh router so v8 coverage counts route code, and drives the
// REAL assertProjectMember + runTransaction key-minting path against
// fakeFirestore. Pins the security contract: 401 no token, 403 non-member,
// 200 member returns {keyId,key}, key minted once + reused, audit row written.

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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import meshRouter from '../../server/routes/mesh.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mesh', meshRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const PROJECT_ID = 'proj-test';
const MEMBER_UID = 'member1';
const OUTSIDER_UID = 'outsider9';

function seedProject(db: ReturnType<typeof createFakeFirestore>) {
  db._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('GET /api/mesh/key', () => {
  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).get(`/api/mesh/key?projectId=${PROJECT_ID}`);
    expect(res.status).toBe(401);
  });

  it('400 invalid query — missing projectId', async () => {
    seedProject(H.db!);
    const res = await request(buildApp()).get('/api/mesh/key').set(asUser(MEMBER_UID));
    expect(res.status).toBe(400);
  });

  it('403 caller not a project member', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/mesh/key?projectId=${PROJECT_ID}`)
      .set(asUser(OUTSIDER_UID));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a project member/);
  });

  it('200 member — mints + returns {keyId, key} and persists to mesh_keys', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/mesh/key?projectId=${PROJECT_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    expect(res.body.keyId).toBe(`${PROJECT_ID}:v1`);
    expect(typeof res.body.key).toBe('string');
    // 256-bit base64 key → 44 chars.
    expect(res.body.key.length).toBeGreaterThanOrEqual(43);
    const stored = H.db!._store.get(`mesh_keys/${PROJECT_ID}`);
    expect(stored).toBeDefined();
    expect(stored?.keyId).toBe(`${PROJECT_ID}:v1`);
    expect(stored?.createdBy).toBe(MEMBER_UID);
  });

  it('200 idempotent — second fetch reuses the same key (no re-mint)', async () => {
    seedProject(H.db!);
    const first = await request(buildApp())
      .get(`/api/mesh/key?projectId=${PROJECT_ID}`)
      .set(asUser(MEMBER_UID));
    const second = await request(buildApp())
      .get(`/api/mesh/key?projectId=${PROJECT_ID}`)
      .set(asUser(MEMBER_UID));
    expect(first.body.key).toBe(second.body.key);
    expect(first.body.keyId).toBe(second.body.keyId);
  });

  it('writes an audit row on key fetch', async () => {
    seedProject(H.db!);
    await request(buildApp())
      .get(`/api/mesh/key?projectId=${PROJECT_ID}`)
      .set(asUser(MEMBER_UID));
    const auditRows = [...H.db!._store.entries()].filter(([k]) =>
      k.startsWith('audit_logs/'),
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0][1].action).toBe('mesh.key.fetch');
    expect(auditRows[0][1].module).toBe('mesh');
    expect(auditRows[0][1].userId).toBe(MEMBER_UID);
  });
});
