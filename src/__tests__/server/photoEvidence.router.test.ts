// Real-router supertest for the Photo Evidence HTTP endpoints
// (src/server/routes/photoEvidence.ts). The router persists evidence metadata
// + linkages so the graph (incidents, inspections, audits) can render evidence
// cards. 3 endpoints:
//   POST /:projectId/photo-evidence                       → record metadata (201)
//   GET  /:projectId/photo-evidence/by-node/:kind/:id     → list for parent
//   POST /:projectId/photo-evidence/:artifactId/linkage   → append linkage (204)
//
// Mounts the REAL router over a faithful fakeFirestore. The engine
// (buildArtifact), the adapter (PhotoEvidenceAdapter), assertProjectMember and
// auditServerEvent run REAL — only firebase-admin, verifyAuth and the logger
// are mocked. The adapter persists at
//   tenants/{tid}/projects/{pid}/photo_evidence/{contentHash}
// and audit rows land in audit_logs/ via the real auditServerEvent.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import photoEvidenceRouter from '../../server/routes/photoEvidence.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', photoEvidenceRouter);
  return app;
}

const member = { 'x-test-uid': 'u1' };
const TENANT = 't1';
const PROJECT = 'p1';
const COL = `tenants/${TENANT}/projects/${PROJECT}/photo_evidence`;
// 64-char lowercase SHA-256 hex.
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

function recentISO(): string {
  // Within the engine's 30-day freshness window, not in the future.
  return new Date(Date.now() - 60_000).toISOString();
}

function validRecordBody() {
  return {
    contentHash: HASH,
    payload: {
      originalFilename: 'arnes.jpg',
      mimeType: 'image/jpeg',
      byteSize: 1024,
      capturedAt: recentISO(),
      capturedByUid: 'someoneElse', // server must overwrite with caller uid
      notes: 'Arnés en mal estado',
    },
    linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
  };
}

function seedMemberProject() {
  H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['u1'] });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('POST /:projectId/photo-evidence (record)', () => {
  it('401 without a token', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .send(validRecordBody());
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member of the project', async () => {
    H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['someone-else'] });
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(validRecordBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the project has no tenantId (tenant_not_found)', async () => {
    H.db!._seed(`projects/${PROJECT}`, { members: ['u1'] }); // member, but no tenantId
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(validRecordBody());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('400 on schema violation (bad contentHash)', async () => {
    seedMemberProject();
    const body = validRecordBody();
    body.contentHash = 'not-a-sha256';
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on empty linkages (schema requires min 1)', async () => {
    seedMemberProject();
    const body = validRecordBody();
    body.linkages = [];
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('201 persists the artifact at the tenant-scoped path with real fields', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(validRecordBody());
    expect(res.status).toBe(201);
    // Response shape — the real engine artifact.
    expect(res.body.artifact.id).toBe(HASH); // content-addressed by hash
    expect(res.body.artifact.mimeType).toBe('image/jpeg');
    expect(res.body.artifact.originalFilename).toBe('arnes.jpg');
    expect(res.body.artifact.linkages).toEqual([{ nodeKind: 'incident', nodeId: 'inc-1' }]);
    // Caller uid wins over the body uid (defensive against client tampering).
    expect(res.body.artifact.capturedByUid).toBe('u1');

    // Actually persisted to Firestore at the tenant-scoped collection.
    const stored = H.db!._dump()[`${COL}/${HASH}`] as {
      id: string;
      capturedByUid: string;
      linkageKeys: string[];
    };
    expect(stored).toBeDefined();
    expect(stored.id).toBe(HASH);
    expect(stored.capturedByUid).toBe('u1');
    // The route adds the array-contains projection at the boundary.
    expect(stored.linkageKeys).toEqual(['incident:inc-1']);
  });

  it('201 writes a photoEvidence.record audit_log stamped from the token (CLAUDE.md #3)', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(validRecordBody());
    expect(res.status).toBe(201);
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const log = H.db!._store.get(auditKeys[0]) as {
      action: string;
      module: string;
      userId: string;
      projectId: string | null;
      details: { artifactId: string; linkageKeys: string[] };
    };
    expect(log.action).toBe('photoEvidence.record');
    expect(log.module).toBe('photoEvidence');
    expect(log.userId).toBe('u1'); // stamped from token, not body
    expect(log.projectId).toBe(PROJECT);
    expect(log.details.artifactId).toBe(HASH);
    expect(log.details.linkageKeys).toEqual(['incident:inc-1']);
  });

  it('422 when the engine rejects a stale/invalid payload (invalid_payload + code)', async () => {
    seedMemberProject();
    const body = validRecordBody();
    // Passes the zod schema (capturedAt only requires min length 10), but the
    // engine's freshness window rejects evidence older than 30 days.
    body.payload.capturedAt = '2000-01-01T00:00:00.000Z';
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence`)
      .set(member)
      .send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_payload');
    expect(res.body.code).toBe('invalid_capture_date');
  });
});

describe('GET /:projectId/photo-evidence/by-node/:kind/:id (list)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`/api/${PROJECT}/photo-evidence/by-node/incident/inc-1`);
    expect(res.status).toBe(401);
  });

  it('400 on an invalid node kind', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .get(`/api/${PROJECT}/photo-evidence/by-node/bogus/inc-1`)
      .set(member);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_node_kind');
  });

  it('403 when the caller is not a member', async () => {
    H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['someone-else'] });
    const res = await request(buildApp())
      .get(`/api/${PROJECT}/photo-evidence/by-node/incident/inc-1`)
      .set(member);
    expect(res.status).toBe(403);
  });

  it('200 returns only the artifacts linked to the requested node', async () => {
    seedMemberProject();
    // Two artifacts linked to inc-1, one linked elsewhere — must be excluded.
    H.db!._seed(`${COL}/${HASH}`, {
      id: HASH, mimeType: 'image/jpeg', capturedAt: '2026-06-10T08:00:00Z',
      linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
      linkageKeys: ['incident:inc-1'],
    });
    H.db!._seed(`${COL}/${HASH2}`, {
      id: HASH2, mimeType: 'image/png', capturedAt: '2026-06-11T08:00:00Z',
      linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
      linkageKeys: ['incident:inc-1'],
    });
    H.db!._seed(`${COL}/${'c'.repeat(64)}`, {
      id: 'c'.repeat(64), mimeType: 'image/jpeg', capturedAt: '2026-06-12T08:00:00Z',
      linkages: [{ nodeKind: 'audit', nodeId: 'aud-9' }],
      linkageKeys: ['audit:aud-9'],
    });
    const res = await request(buildApp())
      .get(`/api/${PROJECT}/photo-evidence/by-node/incident/inc-1`)
      .set(member);
    expect(res.status).toBe(200);
    const ids = (res.body.artifacts as Array<{ id: string }>).map((a) => a.id).sort();
    expect(ids).toEqual([HASH, HASH2]);
  });

  it('200 honest empty list when nothing is linked (not fabricated)', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .get(`/api/${PROJECT}/photo-evidence/by-node/inspection/insp-7`)
      .set(member);
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toEqual([]);
  });
});

describe('POST /:projectId/photo-evidence/:artifactId/linkage (append)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence/${HASH}/linkage`)
      .send({ nodeKind: 'audit', nodeId: 'aud-1' });
    expect(res.status).toBe(401);
  });

  it('400 on an invalid artifactId (not a SHA-256)', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence/not-a-hash/linkage`)
      .set(member)
      .send({ nodeKind: 'audit', nodeId: 'aud-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_artifact_id');
  });

  it('400 on a schema-invalid linkage body (bad nodeKind)', async () => {
    seedMemberProject();
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence/${HASH}/linkage`)
      .set(member)
      .send({ nodeKind: 'bogus', nodeId: 'aud-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member', async () => {
    H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: ['someone-else'] });
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence/${HASH}/linkage`)
      .set(member)
      .send({ nodeKind: 'audit', nodeId: 'aud-1' });
    expect(res.status).toBe(403);
  });

  it('204 appends the linkage (deduped) and refreshes linkageKeys; audit logged', async () => {
    seedMemberProject();
    H.db!._seed(`${COL}/${HASH}`, {
      id: HASH, mimeType: 'image/jpeg', capturedAt: '2026-06-10T08:00:00Z',
      linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
      linkageKeys: ['incident:inc-1'],
    });
    const res = await request(buildApp())
      .post(`/api/${PROJECT}/photo-evidence/${HASH}/linkage`)
      .set(member)
      .send({ nodeKind: 'audit', nodeId: 'aud-9' });
    expect(res.status).toBe(204);
    const stored = H.db!._dump()[`${COL}/${HASH}`] as {
      linkages: Array<{ nodeKind: string; nodeId: string }>;
      linkageKeys: string[];
    };
    expect(stored.linkages).toEqual([
      { nodeKind: 'incident', nodeId: 'inc-1' },
      { nodeKind: 'audit', nodeId: 'aud-9' },
    ]);
    expect(stored.linkageKeys.sort()).toEqual(['audit:aud-9', 'incident:inc-1']);

    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const log = H.db!._store.get(auditKeys[0]) as {
      action: string; userId: string; projectId: string | null;
      details: { artifactId: string; nodeKind: string; nodeId: string };
    };
    expect(log.action).toBe('photoEvidence.appendLinkage');
    expect(log.userId).toBe('u1');
    expect(log.projectId).toBe(PROJECT);
    expect(log.details.artifactId).toBe(HASH);
    expect(log.details.nodeKind).toBe('audit');
    expect(log.details.nodeId).toBe('aud-9');
  });
});
