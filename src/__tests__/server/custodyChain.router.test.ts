// Real-router supertest for the evidence chain-of-custody endpoints (audit H8).
// Mounts the REAL router + drives the REAL custody engine + adapter (which were
// inert dead-code before this route). Covers auth/validation/guard paths and the
// four mutating handlers' audit_logs trail + server-stamped identity (CLAUDE.md
// #3/#14). No mock-the-SUT: the engine hashes the bytes and the fakeFirestore
// persists under tenants/{tid}/evidence_artifacts/{hash}.

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
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? 'worker',
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import custodyChainRouter from '../../server/routes/custodyChain.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api/sprint-k', custodyChainRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const TENANT_ID = 'tenant-abc';
const PROJECT_ID = 'proj-alpha';
const MEMBER_UID = 'worker1';
const OUTSIDER_UID = 'intruder9';

const ART_PATH = `tenants/${TENANT_ID}/evidence_artifacts`;
// SHA-256 of "evidence-bytes-001" — content-addressed id the engine derives.
const CONTENT = Buffer.from('evidence-bytes-001').toString('base64');

function seedProject(db: ReturnType<typeof createFakeFirestore>, extra: Record<string, unknown> = {}) {
  db._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
    ...extra,
  });
}

function auditRows(): Record<string, unknown>[] {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith('audit_logs/'))
    .map(([, v]) => v as Record<string, unknown>);
}

function eventRows(hash: string): Record<string, unknown>[] {
  return Object.entries(H.db!._dump())
    .filter(([k]) => k.startsWith(`${ART_PATH}/${hash}/events/`))
    .map(([, v]) => v as Record<string, unknown>);
}

const validRegister = {
  kind: 'photo' as const,
  mimeType: 'image/jpeg',
  contentBase64: CONTENT,
  notes: 'Foto del andamio sin baranda nivel 3',
};

/** Register one artifact and return its server-derived hash. */
async function register(uid = MEMBER_UID): Promise<string> {
  const res = await request(buildApp())
    .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
    .set(asUser(uid))
    .send(validRegister);
  expect(res.status).toBe(201);
  return (res.body as { artifact: { id: string } }).artifact.id;
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// POST /:projectId/evidence  (register)
// =============================================================================
describe('POST /api/sprint-k/:projectId/evidence', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
      .send(validRegister);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
      .set(asUser(OUTSIDER_UID))
      .send(validRegister);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID] });
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
      .set(asUser(MEMBER_UID))
      .send(validRegister);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('tenant_not_found');
  });

  it('400 when payload is invalid (bad kind enum)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
      .set(asUser(MEMBER_UID))
      .send({ ...validRegister, kind: 'banana' });
    expect(res.status).toBe(400);
  });

  it('201 content-addresses the artifact + server-stamps uploadedByUid + audit + append-only event', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence`)
      .set(asUser(MEMBER_UID))
      .set({ 'x-test-role': 'supervisor' })
      .send(validRegister);
    expect(res.status).toBe(201);
    const artifact = (res.body as { artifact: Record<string, unknown> }).artifact;
    expect(typeof artifact.id).toBe('string');
    // uploadedByUid comes from the VERIFIED token, never the body.
    expect(artifact.uploadedByUid).toBe(MEMBER_UID);

    const stored = H.db!._store.get(`${ART_PATH}/${artifact.id}`);
    expect(stored).toBeDefined();
    expect(stored?.uploadedByUid).toBe(MEMBER_UID);

    // Append-only custody event written with the enriched caller role.
    const events = eventRows(artifact.id as string);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventKind: 'upload', actorUid: MEMBER_UID, actorRole: 'supervisor' });

    // Rule #3 — audit trail
    const a = auditRows().find((r) => r.action === 'custody.register');
    expect(a).toMatchObject({ module: 'evidenceChain', userId: MEMBER_UID, projectId: PROJECT_ID });
  });
});

// =============================================================================
// GET /:projectId/evidence/:hash
// =============================================================================
describe('GET /api/sprint-k/:projectId/evidence/:hash', () => {
  it('401 when no auth token', async () => {
    const res = await request(buildApp()).get(`/api/sprint-k/${PROJECT_ID}/evidence/somehash`);
    expect(res.status).toBe(401);
  });

  it('404 when the artifact does not exist', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/evidence/${'f'.repeat(64)}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('artifact_not_found');
  });

  it('200 returns the artifact + chain summary', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .get(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    const body = res.body as { artifact: { id: string }; events: unknown[]; summary: { totalEvents: number } };
    expect(body.artifact.id).toBe(hash);
    expect(body.summary.totalEvents).toBe(1);
  });
});

// =============================================================================
// POST /:projectId/evidence/:hash/replace
// =============================================================================
describe('POST /api/sprint-k/:projectId/evidence/:hash/replace', () => {
  const replaceBody = { newArtifactHash: 'b'.repeat(64), reason: 'Reemplazo por foto nítida del mismo punto' };

  it('401 when no auth token', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/x/replace`)
      .send(replaceBody);
    expect(res.status).toBe(401);
  });

  it('400 when reason is too short', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/replace`)
      .set(asUser(MEMBER_UID))
      .send({ newArtifactHash: 'b'.repeat(64), reason: 'short' });
    expect(res.status).toBe(400);
  });

  it('404 when the original artifact is missing', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${'c'.repeat(64)}/replace`)
      .set(asUser(MEMBER_UID))
      .send(replaceBody);
    expect(res.status).toBe(404);
  });

  it('200 marks replaced (chain-preserving) + audit + replacement event', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/replace`)
      .set(asUser(MEMBER_UID))
      .send(replaceBody);
    expect(res.status).toBe(200);
    const stored = H.db!._store.get(`${ART_PATH}/${hash}`);
    expect(stored?.replacedByHash).toBe(replaceBody.newArtifactHash);
    // original NOT deleted — chain preserved
    expect(stored).toBeDefined();
    const events = eventRows(hash);
    expect(events.some((e) => e.eventKind === 'replacement' && e.actorUid === MEMBER_UID)).toBe(true);
    expect(auditRows().some((r) => r.action === 'custody.replace')).toBe(true);
  });

  it('409 when replacing an already-replaced artifact (engine invariant)', async () => {
    seedProject(H.db!);
    const hash = await register();
    await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/replace`)
      .set(asUser(MEMBER_UID))
      .send(replaceBody);
    const res2 = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/replace`)
      .set(asUser(MEMBER_UID))
      .send({ newArtifactHash: 'd'.repeat(64), reason: 'Otro reemplazo distinto del primero' });
    expect(res2.status).toBe(409);
    expect((res2.body as Record<string, unknown>).code).toBe('ALREADY_REPLACED');
  });
});

// =============================================================================
// POST /:projectId/evidence/:hash/access  and  /export
// =============================================================================
describe('POST access + export', () => {
  it('access 200 appends an access event + audit (server-stamped actor)', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/access`)
      .set(asUser(MEMBER_UID))
      .send({});
    expect(res.status).toBe(200);
    const events = eventRows(hash);
    expect(events.some((e) => e.eventKind === 'access' && e.actorUid === MEMBER_UID)).toBe(true);
    expect(auditRows().some((r) => r.action === 'custody.access')).toBe(true);
  });

  it('access 403 for a non-member', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/access`)
      .set(asUser(OUTSIDER_UID))
      .send({});
    expect(res.status).toBe(403);
  });

  it('export 400 without exportTarget', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/export`)
      .set(asUser(MEMBER_UID))
      .send({});
    expect(res.status).toBe(400);
  });

  it('export 200 appends an export event + audit', async () => {
    seedProject(H.db!);
    const hash = await register();
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/evidence/${hash}/export`)
      .set(asUser(MEMBER_UID))
      .send({ exportTarget: 'expediente-PDF-incidente-42' });
    expect(res.status).toBe(200);
    const events = eventRows(hash);
    expect(events.some((e) => e.eventKind === 'export')).toBe(true);
    expect(auditRows().some((r) => r.action === 'custody.export')).toBe(true);
  });
});
