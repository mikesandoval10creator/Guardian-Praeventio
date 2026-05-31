// Praeventio Guard — Plan v3 Fase 1: real-router supertest coverage for
// src/server/routes/restrictedZones.ts (was 109 uncovered lines, ~11%).
//
// Mounts the ACTUAL router at /api/zones (the prefix declared in the route
// file header). Exercises all 5 endpoints:
//
//   POST /api/zones/define
//   GET  /api/zones/by-site/:projectId
//   POST /api/zones/check
//   POST /api/zones/entry-event
//   GET  /api/zones/entry-permissions/:projectId/:workerUid
//
// Founder directive (no-bloqueo): entry-event always persists, even with
// allowed:false. Never a 4xx/block on "denied" evaluation.
//
// Pattern:
//   H.db hoisted → adminMock → verifyAuth shim → idempotencyKey noop →
//   observability noop → seed projects/<id> with members → assert HTTP +
//   Firestore side-effects.

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
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.example`,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import restrictedZonesRouter from '../../server/routes/restrictedZones.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zones', restrictedZonesRouter);
  return app;
}

// ── Shared fixtures ────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-alpha';
const TENANT_ID = 'tenant-1';
const WORKER_UID = 'worker-1';
const SUPERVISOR_UID = 'supervisor-1';

/** Minimal zone fixture — kind 'hot' requires 'caliente' permit. */
const ZONE_HOT = {
  id: 'zone-hot-1',
  kind: 'hot',
  name: 'Soldadura principal',
  rules: {
    requiredEpp: ['casco', 'guantes_calor'],
    requiredTrainings: ['loto'],
    requiresPermit: true,
    responsibleUid: SUPERVISOR_UID,
  },
  activeFrom: '2024-01-01T00:00:00Z',
};

/** Zone that is not yet active (activeFrom in the future). */
const ZONE_FUTURE = {
  id: 'zone-future-1',
  kind: 'confined',
  name: 'Tanque B (futuro)',
  rules: {
    requiredEpp: [],
    requiredTrainings: [],
    responsibleUid: SUPERVISOR_UID,
  },
  activeFrom: '2099-01-01T00:00:00Z',
};

/** Zone that has expired. */
const ZONE_EXPIRED = {
  id: 'zone-expired-1',
  kind: 'lifting',
  name: 'Grúa antigua',
  rules: {
    requiredEpp: [],
    requiredTrainings: [],
    requiresPermit: false,
    responsibleUid: SUPERVISOR_UID,
  },
  activeFrom: '2020-01-01T00:00:00Z',
  activeUntil: '2021-01-01T00:00:00Z',
};

function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [WORKER_UID, SUPERVISOR_UID],
    createdBy: SUPERVISOR_UID,
  });
}

function seedZone(zone: typeof ZONE_HOT | typeof ZONE_FUTURE | typeof ZONE_EXPIRED) {
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/restricted_zones/${zone.id}`,
    zone,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. POST /api/zones/define
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/zones/define', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  it('401 without an auth token', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .send({ projectId: PROJECT_ID, zone: ZONE_HOT });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', 'outsider-uid')
      .send({ projectId: PROJECT_ID, zone: ZONE_HOT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when projectId is missing from body', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ zone: ZONE_HOT }); // no projectId
    expect(res.status).toBe(400);
  });

  it('400 when zone kind is invalid', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({
        projectId: PROJECT_ID,
        zone: { ...ZONE_HOT, kind: 'unknown_kind' },
      });
    expect(res.status).toBe(400);
  });

  it('400 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      // no tenantId field
      members: [WORKER_UID, SUPERVISOR_UID],
      createdBy: SUPERVISOR_UID,
    });
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ projectId: PROJECT_ID, zone: ZONE_HOT });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('400 when project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ projectId: 'nonexistent-project', zone: ZONE_HOT });
    // non-member because project missing → 403 from assertProjectMember
    expect(res.status).toBe(403);
  });

  it('201/200 defines a zone and persists it to Firestore', async () => {
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ projectId: PROJECT_ID, zone: ZONE_HOT });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.zoneId).toBe(ZONE_HOT.id);

    // Verify Firestore side-effect: zone was written under the tenant path.
    const stored = (
      await H.db!
        .collection('tenants')
        .doc(TENANT_ID)
        .collection('projects')
        .doc(PROJECT_ID)
        .collection('restricted_zones')
        .doc(ZONE_HOT.id)
        .get()
    ).data() as Record<string, unknown>;
    expect(stored.kind).toBe('hot');
    expect(stored.name).toBe('Soldadura principal');
    expect(stored.createdBy).toBe(SUPERVISOR_UID);
  });

  it('defines a zone with optional perimeter coords', async () => {
    const zoneWithPerimeter = {
      ...ZONE_HOT,
      id: 'zone-perim',
      perimeter: [
        [-70.5, -33.4],
        [-70.51, -33.4],
        [-70.51, -33.41],
        [-70.5, -33.41],
      ],
    };
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ projectId: PROJECT_ID, zone: zoneWithPerimeter });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).zoneId).toBe('zone-perim');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. GET /api/zones/by-site/:projectId
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/zones/by-site/:projectId', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  it('401 without an auth token', async () => {
    const res = await request(buildApp()).get(`/api/zones/by-site/${PROJECT_ID}`);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`/api/zones/by-site/${PROJECT_ID}`)
      .set('x-test-uid', 'outsider-uid');
    expect(res.status).toBe(403);
  });

  it('400 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [WORKER_UID],
      createdBy: WORKER_UID,
    });
    const res = await request(buildApp())
      .get(`/api/zones/by-site/${PROJECT_ID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('200 returns empty zones array when none defined', async () => {
    const res = await request(buildApp())
      .get(`/api/zones/by-site/${PROJECT_ID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.zones)).toBe(true);
    expect((body.zones as unknown[]).length).toBe(0);
  });

  it('200 returns all zones when multiple are seeded', async () => {
    seedZone(ZONE_HOT);
    seedZone(ZONE_FUTURE);
    const res = await request(buildApp())
      .get(`/api/zones/by-site/${PROJECT_ID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const zones = body.zones as Array<Record<string, unknown>>;
    expect(zones.length).toBe(2);
    const ids = zones.map((z) => z.id).sort();
    expect(ids).toEqual([ZONE_FUTURE.id, ZONE_HOT.id].sort());
  });

  it('200 zone shape includes id, kind, name, rules, activeFrom', async () => {
    seedZone(ZONE_HOT);
    const res = await request(buildApp())
      .get(`/api/zones/by-site/${PROJECT_ID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const zone = (res.body as Record<string, unknown>).zones as Array<Record<string, unknown>>;
    expect(zone[0].id).toBe(ZONE_HOT.id);
    expect(zone[0].kind).toBe('hot');
    expect(zone[0].name).toBe('Soldadura principal');
    expect(zone[0].rules).toBeDefined();
    expect(zone[0].activeFrom).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POST /api/zones/check (pure-compute, no write)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/zones/check', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  const baseCheckBody = {
    projectId: PROJECT_ID,
    workerUid: WORKER_UID,
    workerEppLabels: ['casco', 'guantes_calor'],
    workerTrainings: ['loto'],
    workerActivePermitKinds: ['caliente'],
    zone: ZONE_HOT,
  };

  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post('/api/zones/check').send(baseCheckBody);
    expect(res.status).toBe(401);
  });

  it('400 on invalid body (missing zone)', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({ projectId: PROJECT_ID, workerUid: WORKER_UID });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', 'outsider-uid')
      .send(baseCheckBody);
    expect(res.status).toBe(403);
  });

  it('200 allowed:true when worker meets all requirements', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send(baseCheckBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const result = body.result as Record<string, unknown>;
    expect(result.allowed).toBe(true);
    expect((result.missing as unknown[]).length).toBe(0);
  });

  it('200 allowed:false + missing EPP when worker lacks required EPP', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseCheckBody,
        workerEppLabels: [], // missing casco + guantes_calor
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allowed).toBe(false);
    const missing = result.missing as string[];
    expect(missing.some((m) => m.includes('casco'))).toBe(true);
    expect(missing.some((m) => m.includes('guantes_calor'))).toBe(true);
  });

  it('200 allowed:false + missing training when worker lacks required training', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseCheckBody,
        workerTrainings: [], // missing loto
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allowed).toBe(false);
    const missing = result.missing as string[];
    expect(missing.some((m) => m.includes('loto'))).toBe(true);
  });

  it('200 allowed:false + missing permit when hot zone requires caliente permit', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseCheckBody,
        workerActivePermitKinds: [], // missing caliente
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allowed).toBe(false);
    const missing = result.missing as string[];
    expect(missing.some((m) => m.includes('caliente'))).toBe(true);
  });

  it('200 allowed:true with warning for a not-yet-active zone', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseCheckBody,
        zone: ZONE_FUTURE,
        workerEppLabels: [],
        workerTrainings: [],
        workerActivePermitKinds: [],
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    // Engine returns allowed:true + warning when zone is not active yet.
    expect(result.allowed).toBe(true);
    expect((result.warnings as string[]).length).toBeGreaterThan(0);
  });

  it('200 allowed:true with warning for an expired zone', async () => {
    const res = await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseCheckBody,
        zone: ZONE_EXPIRED,
        workerEppLabels: [],
        workerTrainings: [],
        workerActivePermitKinds: [],
      });
    expect(res.status).toBe(200);
    const result = (res.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result.allowed).toBe(true);
    const warnings = result.warnings as string[];
    expect(warnings.some((w) => /expir/i.test(w))).toBe(true);
  });

  it('200 pure-compute: does NOT write to Firestore', async () => {
    await request(buildApp())
      .post('/api/zones/check')
      .set('x-test-uid', WORKER_UID)
      .send(baseCheckBody);
    // zone_entry_events collection must remain empty.
    const events = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/zone_entry_events`)
      .get();
    expect(events.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. POST /api/zones/entry-event
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/zones/entry-event', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  const allowedEval = {
    allowed: true,
    missing: [],
    warnings: [],
  };
  const deniedEval = {
    allowed: false,
    missing: ['EPP: casco', 'Training: loto'],
    warnings: [],
  };

  const baseEntryBody = {
    projectId: PROJECT_ID,
    zoneId: ZONE_HOT.id,
    workerUid: WORKER_UID,
    evaluation: allowedEval,
  };

  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post('/api/zones/entry-event').send(baseEntryBody);
    expect(res.status).toBe(401);
  });

  it('400 on invalid body (missing projectId)', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send({ zoneId: ZONE_HOT.id, workerUid: WORKER_UID, evaluation: allowedEval });
    expect(res.status).toBe(400);
  });

  it('403 when workerUid differs from caller uid (anti-blame guard)', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', SUPERVISOR_UID) // caller is supervisor
      .send({
        ...baseEntryBody,
        workerUid: WORKER_UID, // but declares entry for worker (different uid)
      });
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', 'outsider-uid')
      .send({ ...baseEntryBody, workerUid: 'outsider-uid' });
    expect(res.status).toBe(403);
  });

  it('400 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [WORKER_UID],
      createdBy: WORKER_UID,
    });
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send(baseEntryBody);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('200 persists allowed entry event + audit log (founder directive: always records)', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send(baseEntryBody);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.recorded).toBe(true);
    expect(typeof body.eventId).toBe('string');
    expect(String(body.eventId)).toMatch(/^zev_\d+_/);

    const evaluation = body.evaluation as Record<string, unknown>;
    expect(evaluation.allowed).toBe(true);

    // Verify event persisted to Firestore.
    const events = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/zone_entry_events`)
      .get();
    expect(events.size).toBe(1);
    const stored = events.docs[0].data() as Record<string, unknown>;
    expect(stored.zoneId).toBe(ZONE_HOT.id);
    expect(stored.workerUid).toBe(WORKER_UID);
    expect(stored.allowed).toBe(true);
    expect(stored.createdBy).toBe(WORKER_UID);

    // Audit log written.
    const auditLogs = await H.db!.collection('audit_logs').get();
    expect(auditLogs.size).toBe(1);
    const auditDoc = auditLogs.docs[0].data() as Record<string, unknown>;
    expect(auditDoc.action).toBe('zone.entry_declared');
    expect(auditDoc.module).toBe('restricted_zones');
    expect(auditDoc.userId).toBe(WORKER_UID);
  });

  // ── FOUNDER DIRECTIVE: no-bloqueo ───────────────────────────────────────
  // A denied evaluation (allowed:false) MUST STILL be persisted and return
  // HTTP 200 — this is the "informed entry" semantic, not gatekeeping.
  it('200 persists denied evaluation too (no-bloqueo directive)', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseEntryBody,
        evaluation: deniedEval,
        acknowledgedAt: new Date().toISOString(),
        notes: 'Comprendo el riesgo y entro',
      });
    expect(res.status).toBe(200); // NOT 4xx/blocked
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.recorded).toBe(true);

    // Verify denied event stored as-is.
    const events = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/zone_entry_events`)
      .get();
    expect(events.size).toBe(1);
    const stored = events.docs[0].data() as Record<string, unknown>;
    expect(stored.allowed).toBe(false);
    expect(stored.acknowledgedAt).toBeTruthy();
    expect(stored.notes).toBe('Comprendo el riesgo y entro');
  });

  it('200 stores clientEvaluation alongside server evaluation', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseEntryBody,
        evaluation: deniedEval,
      });
    expect(res.status).toBe(200);
    const events = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/zone_entry_events`)
      .get();
    const stored = events.docs[0].data() as Record<string, unknown>;
    const clientEval = stored.clientEvaluation as Record<string, unknown>;
    expect(clientEval.allowed).toBe(false);
    expect(Array.isArray(clientEval.missing)).toBe(true);
  });

  it('200 server re-evaluates and wins when zoneSnapshot + workerSnapshot provided', async () => {
    // Client says allowed:false (missing EPP), but server re-evaluates with
    // full EPP list → allowed:true. Server value must be persisted.
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseEntryBody,
        evaluation: deniedEval, // client-side says not allowed
        zoneSnapshot: ZONE_HOT,
        workerSnapshot: {
          workerEppLabels: ['casco', 'guantes_calor'],
          workerTrainings: ['loto'],
          workerActivePermitKinds: ['caliente'],
        },
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const evaluation = body.evaluation as Record<string, unknown>;
    // Server re-evaluation with full EPP → allowed:true overrides client
    expect(evaluation.allowed).toBe(true);

    // Persisted event uses server evaluation, not client's.
    const events = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/zone_entry_events`)
      .get();
    const stored = events.docs[0].data() as Record<string, unknown>;
    expect(stored.allowed).toBe(true);
    // clientEvaluation preserved forensically.
    const clientEval = stored.clientEvaluation as Record<string, unknown>;
    expect(clientEval.allowed).toBe(false);
  });

  it('200 falls back to client evaluation when only zoneSnapshot provided (no workerSnapshot)', async () => {
    // Server skips re-evaluation if EITHER snapshot is absent.
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send({
        ...baseEntryBody,
        evaluation: allowedEval,
        zoneSnapshot: ZONE_HOT,
        // workerSnapshot omitted → no server re-evaluation
      });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const evaluation = body.evaluation as Record<string, unknown>;
    expect(evaluation.allowed).toBe(true);
  });

  it('eventId shape matches zev_<ts>_<uuid> contract', async () => {
    const res = await request(buildApp())
      .post('/api/zones/entry-event')
      .set('x-test-uid', WORKER_UID)
      .send(baseEntryBody);
    expect(res.status).toBe(200);
    const eventId = String((res.body as Record<string, unknown>).eventId);
    expect(eventId).toMatch(
      /^zev_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. GET /api/zones/entry-permissions/:projectId/:workerUid
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/zones/entry-permissions/:projectId/:workerUid', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  const baseQuery = `?eppLabels=casco,guantes_calor&trainings=loto&permits=caliente`;

  it('401 without an auth token', async () => {
    const res = await request(buildApp()).get(
      `/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}${baseQuery}`,
    );
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}${baseQuery}`)
      .set('x-test-uid', 'outsider-uid');
    expect(res.status).toBe(403);
  });

  it('400 when project has no tenantId', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [WORKER_UID],
      createdBy: WORKER_UID,
    });
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('project_missing_tenant');
  });

  it('200 returns empty permissions when no zones defined', async () => {
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.permissions)).toBe(true);
    expect((body.permissions as unknown[]).length).toBe(0);
  });

  it('200 returns allowed:true for each zone when worker has full credentials', async () => {
    seedZone(ZONE_HOT);
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}${baseQuery}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const perms = (res.body as Record<string, unknown>).permissions as Array<Record<string, unknown>>;
    expect(perms.length).toBe(1);
    expect(perms[0].zoneId).toBe(ZONE_HOT.id);
    const result = perms[0].result as Record<string, unknown>;
    expect(result.allowed).toBe(true);
    expect((result.missing as unknown[]).length).toBe(0);
  });

  it('200 returns allowed:false + missing items when worker lacks credentials', async () => {
    seedZone(ZONE_HOT);
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}`) // no query params → empty EPP/trainings
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const perms = (res.body as Record<string, unknown>).permissions as Array<Record<string, unknown>>;
    expect(perms.length).toBe(1);
    const result = perms[0].result as Record<string, unknown>;
    expect(result.allowed).toBe(false);
    const missing = result.missing as string[];
    expect(missing.length).toBeGreaterThan(0);
  });

  it('200 evaluates multiple zones independently per zone rules', async () => {
    seedZone(ZONE_HOT);
    seedZone(ZONE_FUTURE); // not-yet-active → allowed:true regardless
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}`) // no EPP
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const perms = (res.body as Record<string, unknown>).permissions as Array<Record<string, unknown>>;
    expect(perms.length).toBe(2);
    // Find each zone's result.
    const hotResult = perms.find((p) => p.zoneId === ZONE_HOT.id)?.result as Record<string, unknown>;
    const futureResult = perms.find((p) => p.zoneId === ZONE_FUTURE.id)?.result as Record<string, unknown>;
    expect(hotResult.allowed).toBe(false); // missing EPP + training + permit
    expect(futureResult.allowed).toBe(true); // not yet active → no restriction
  });

  it('200 each permission entry carries zone + result fields', async () => {
    seedZone(ZONE_HOT);
    const res = await request(buildApp())
      .get(`/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}${baseQuery}`)
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const perm = ((res.body as Record<string, unknown>).permissions as Array<Record<string, unknown>>)[0];
    expect(perm.zoneId).toBeDefined();
    expect(perm.zone).toBeDefined();
    expect(perm.result).toBeDefined();
  });

  it('200 query params are correctly parsed: multi-value eppLabels/trainings/permits', async () => {
    seedZone(ZONE_HOT);
    // Provide all required credentials via query string.
    const res = await request(buildApp())
      .get(
        `/api/zones/entry-permissions/${PROJECT_ID}/${WORKER_UID}` +
          `?eppLabels=casco,guantes_calor&trainings=loto&permits=caliente`,
      )
      .set('x-test-uid', WORKER_UID);
    expect(res.status).toBe(200);
    const result = ((res.body as Record<string, unknown>).permissions as Array<Record<string, unknown>>)[0]
      .result as Record<string, unknown>;
    expect(result.allowed).toBe(true);
  });
});
