// Real-router supertest for evacuationHeadcount endpoints.
// Mounts the REAL router so v8 coverage counts route code.
// Sprint 39 / Plan v3 coverage campaign.

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
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

// idempotencyKey uses Firestore + crypto internally. Mock it to be a passthrough
// so tests don't need idempotency-key headers and cache writes don't interfere.
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  IDEMPOTENCY_DEFAULT_TTL_SEC: 86400,
  IDEMPOTENCY_CACHE_COLLECTION: 'system_idempotency_cache',
  IDEMPOTENCY_HEADER: 'idempotency-key',
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// assertProjectMember reads Firestore via db.collection('projects')…
// We let it run against fakeFirestore — seeding the project doc with
// `members: [uid]` is enough to satisfy the check.
// We DO mock services/observability/index.js because idempotencyKey.ts
// (even though mocked) still gets imported for its const exports in
// some build paths — but the real issue is getErrorTracker used there.
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import evacuationRouter from '../../server/routes/evacuationHeadcount.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/evacuation', evacuationRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const TENANT_ID = 'tenant-test';
const PROJECT_ID = 'proj-test';
const MEMBER_UID = 'supervisor1';
const WORKER_UID = 'worker1';

/** Seed a project doc so assertProjectMember + tenantIdFor both pass. */
function seedProject(db: ReturnType<typeof createFakeFirestore>) {
  db._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [MEMBER_UID, WORKER_UID],
    createdBy: MEMBER_UID,
  });
}

const DRILL_ID = 'drill_test_001';
const DRILLS_PATH = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/evacuations`;
const SCANS_PATH = `${DRILLS_PATH}/${DRILL_ID}/scans`;

/** Minimal EvacuationDrill doc (no scans). */
function drillData(overrides: Record<string, unknown> = {}) {
  return {
    id: DRILL_ID,
    projectId: PROJECT_ID,
    kind: 'drill',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    startedByUid: MEMBER_UID,
    meetingPointId: 'mp-1',
    expectedWorkers: [
      { uid: WORKER_UID, fullName: 'Worker One' },
      { uid: 'worker2', fullName: 'Worker Two' },
    ],
    endedAt: null,
    ...overrides,
  };
}

/** Seed a drill doc into the fake store. */
function seedDrill(db: ReturnType<typeof createFakeFirestore>, overrides: Record<string, unknown> = {}) {
  db._seed(`${DRILLS_PATH}/${DRILL_ID}`, drillData(overrides));
}

/** Seed a scan subdoc. */
function seedScan(db: ReturnType<typeof createFakeFirestore>, workerUid: string) {
  db._seed(`${SCANS_PATH}/${workerUid}`, {
    workerUid,
    scannedAt: new Date().toISOString(),
    meetingPointId: 'mp-1',
    scannedByUid: MEMBER_UID,
  });
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/evacuation/start
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/evacuation/start', () => {
  const validBody = {
    projectId: PROJECT_ID,
    kind: 'drill',
    meetingPointId: 'mp-1',
    expectedWorkers: [{ uid: WORKER_UID, fullName: 'Worker One' }],
  };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post('/api/evacuation/start').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid body — missing expectedWorkers', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .send({ projectId: PROJECT_ID, kind: 'drill', meetingPointId: 'mp-1' });
    expect(res.status).toBe(400);
  });

  it('400 invalid body — bad kind value', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .send({ ...validBody, kind: 'unknown_kind' });
    expect(res.status).toBe(400);
  });

  it('403 caller not a project member', async () => {
    // Project exists but outsider is not in members[] or createdBy
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: ['other-user'],
      createdBy: 'other-user',
    });
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('403 member without elevated role — forbidden_role', async () => {
    // WORKER_UID is a project member but has no supervisor/coordinator role,
    // so it must not be able to start a drill with an arbitrary roster.
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(WORKER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('200 happy path — drill doc written to Firestore', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send({ ...validBody, id: DRILL_ID });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill.id).toBe(DRILL_ID);
    expect(res.body.drill.startedByUid).toBe(MEMBER_UID);
    expect(res.body.drill.kind).toBe('drill');
    // Verify the drill doc was persisted in fakeFirestore
    const stored = H.db!._store.get(`${DRILLS_PATH}/${DRILL_ID}`);
    expect(stored).toBeDefined();
    expect(stored?.id).toBe(DRILL_ID);
  });

  it('200 uses client-supplied id when provided', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send({ ...validBody, id: 'custom-drill-id-99' });
    expect(res.status).toBe(200);
    expect(res.body.drill.id).toBe('custom-drill-id-99');
    expect(H.db!._store.has(`${DRILLS_PATH}/custom-drill-id-99`)).toBe(true);
  });

  it('200 auto-generates drill id when none supplied', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/start')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(typeof res.body.drill.id).toBe('string');
    expect(res.body.drill.id.startsWith('drill_')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/evacuation/scan-qr
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/evacuation/scan-qr', () => {
  const validBody = {
    projectId: PROJECT_ID,
    drillId: DRILL_ID,
    workerUid: WORKER_UID,
    meetingPointId: 'mp-1',
  };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post('/api/evacuation/scan-qr').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid body — missing drillId', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .send({ projectId: PROJECT_ID, workerUid: WORKER_UID, meetingPointId: 'mp-1' });
    expect(res.status).toBe(400);
  });

  it('403 caller not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: ['other'],
      createdBy: 'other',
    });
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 project missing tenant', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('404 drill not found', async () => {
    seedProject(H.db!);
    // No drill seeded
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('drill_not_found');
  });

  it('409 drill already ended', async () => {
    seedProject(H.db!);
    seedDrill(H.db!, { endedAt: new Date().toISOString() });
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('drill_already_ended');
  });

  it('400 worker not in drill expectedWorkers', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send({ ...validBody, workerUid: 'ghost-worker-uid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('worker_not_in_drill');
  });

  it('200 happy path — supervisor scans another worker + status returned', async () => {
    // MEMBER_UID (supervisor1) scans WORKER_UID — scanning SOMEONE ELSE, so
    // an elevated role is required.
    seedProject(H.db!);
    seedDrill(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBeDefined();
    expect(typeof res.body.status.coveragePercent).toBe('number');
    // scannedByUid forced to caller (MEMBER_UID), not body
    const scanDoc = H.db!._store.get(`${SCANS_PATH}/${WORKER_UID}`);
    expect(scanDoc).toBeDefined();
    expect(scanDoc?.scannedByUid).toBe(MEMBER_UID);
    expect(scanDoc?.workerUid).toBe(WORKER_UID);
  });

  it('403 forbidden_scan — member scans ANOTHER worker without elevated role', async () => {
    // WORKER_UID (a plain member) tries to mark worker2 safe. No supervisor
    // role → must be rejected so nobody can forge a clean headcount.
    seedProject(H.db!);
    seedDrill(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(WORKER_UID))
      .send({ ...validBody, workerUid: 'worker2' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_scan');
    // No scan should have been written for the forged target.
    expect(H.db!._store.has(`${SCANS_PATH}/worker2`)).toBe(false);
  });

  it('200 self-scan — worker marks THEMSELVES safe without any role', async () => {
    // workerUid === callerUid → a worker checking in at the assembly point.
    // This is the common path on the worker's own phone; no role needed.
    seedProject(H.db!);
    seedDrill(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(WORKER_UID))
      .send(validBody); // workerUid === WORKER_UID === caller
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const scanDoc = H.db!._store.get(`${SCANS_PATH}/${WORKER_UID}`);
    expect(scanDoc).toBeDefined();
    expect(scanDoc?.scannedByUid).toBe(WORKER_UID);
    expect(scanDoc?.workerUid).toBe(WORKER_UID);
  });

  it('200 idempotent second scan returns same drill without error', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    seedScan(H.db!, WORKER_UID); // pre-existing scan
    const res = await request(buildApp())
      .post('/api/evacuation/scan-qr')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/evacuation/status
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/evacuation/status', () => {
  it('401 without x-test-uid', async () => {
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`);
    expect(res.status).toBe(401);
  });

  it('400 invalid query — missing drillId', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(400);
  });

  it('400 invalid query — missing projectId', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/evacuation/status?drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(400);
  });

  it('403 caller not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: ['other'],
      createdBy: 'other',
    });
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(403);
  });

  it('400 project missing tenant', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('404 drill not found', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('drill_not_found');
  });

  it('200 happy path — returns drill + status', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    seedScan(H.db!, WORKER_UID);
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill.id).toBe(DRILL_ID);
    expect(res.body.status.safe).toHaveLength(1);
    expect(res.body.status.safe[0].uid).toBe(WORKER_UID);
    expect(res.body.status.missing).toHaveLength(1);
    expect(res.body.status.missing[0].uid).toBe('worker2');
    expect(res.body.status.coveragePercent).toBe(50);
    expect(res.body.status.isComplete).toBe(false);
  });

  it('200 complete drill — all workers scanned', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    seedScan(H.db!, WORKER_UID);
    seedScan(H.db!, 'worker2');
    const res = await request(buildApp())
      .get(`/api/evacuation/status?projectId=${PROJECT_ID}&drillId=${DRILL_ID}`)
      .set(asUser(MEMBER_UID));
    expect(res.status).toBe(200);
    expect(res.body.status.isComplete).toBe(true);
    expect(res.body.status.coveragePercent).toBe(100);
    expect(res.body.status.missing).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/evacuation/end
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/evacuation/end', () => {
  const validBody = { projectId: PROJECT_ID, drillId: DRILL_ID };

  it('401 without x-test-uid', async () => {
    const res = await request(buildApp()).post('/api/evacuation/end').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid body — missing drillId', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .send({ projectId: PROJECT_ID });
    expect(res.status).toBe(400);
  });

  it('403 caller not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      tenantId: TENANT_ID,
      members: ['other'],
      createdBy: 'other',
    });
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 project missing tenant', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('404 drill not found', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('drill_not_found');
  });

  it('403 member without elevated role — forbidden_role', async () => {
    // A plain project member must not be able to close an active drill.
    seedProject(H.db!);
    seedDrill(H.db!);
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(WORKER_UID))
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    // Drill must remain open.
    const stored = H.db!._store.get(`${DRILLS_PATH}/${DRILL_ID}`);
    expect(stored?.endedAt).toBeFalsy();
  });

  it('200 idempotent — already-ended drill returns existing postmortem', async () => {
    const endedAt = new Date(Date.now() - 10_000).toISOString();
    seedProject(H.db!);
    seedDrill(H.db!, { endedAt });
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill.endedAt).toBe(endedAt);
    expect(res.body.postmortem.drillId).toBe(DRILL_ID);
  });

  it('200 happy path — drill ended + postmortem returned', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    seedScan(H.db!, WORKER_UID);
    const endedAt = new Date().toISOString();
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send({ ...validBody, endedAt });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.drill.endedAt).toBe(endedAt);
    // Postmortem shape
    const pm = res.body.postmortem;
    expect(pm.drillId).toBe(DRILL_ID);
    expect(pm.kind).toBe('drill');
    expect(pm.totalExpected).toBe(2);
    expect(pm.totalSafe).toBe(1);
    expect(pm.missingWorkers).toHaveLength(1);
    expect(pm.missingWorkers[0].uid).toBe('worker2');
    expect(typeof pm.finalCoveragePercent).toBe('number');
    // Firestore doc updated with endedAt
    const stored = H.db!._store.get(`${DRILLS_PATH}/${DRILL_ID}`);
    expect(stored?.endedAt).toBe(endedAt);
  });

  it('200 accepts client-supplied endedAt timestamp', async () => {
    seedProject(H.db!);
    seedDrill(H.db!);
    const customEndedAt = '2026-05-31T12:00:00.000Z';
    const res = await request(buildApp())
      .post('/api/evacuation/end')
      .set(asUser(MEMBER_UID))
      .set('x-test-role', 'supervisor')
      .send({ ...validBody, endedAt: customEndedAt });
    expect(res.status).toBe(200);
    expect(res.body.drill.endedAt).toBe(customEndedAt);
  });
});
