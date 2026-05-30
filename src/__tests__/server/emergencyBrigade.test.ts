// Real-router supertest for src/server/routes/emergencyBrigade.ts
// §74-78 Brigada de Emergencia — Plan v3 Fase 1, mounted at /api/sprint-k.
//
// Exercises the ACTUAL production router (verifyAuth mocked to read x-test-uid,
// validate middleware kept real for 400 paths, fakeFirestore for Firestore).
// The `guard()` helper calls assertProjectMember + resolveTenantId both via
// admin.firestore(), which the fakeFirestore mock intercepts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // No custom authImpl needed: the route never calls admin.auth().getUser();
  // it only reads admin.firestore() for guard / workerIsProjectMember.
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
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
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

// emergencyBrigadeService is a pure function module — let it run real (no side effects).
// No dynamic imports in this route; no rate limiter middleware in this router.

import emergencyBrigadeRouter from '../../server/routes/emergencyBrigade.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// Mount prefix matches server.ts: app.use('/api/sprint-k', emergencyBrigadeRouter)
const PREFIX = '/api/sprint-k';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, emergencyBrigadeRouter);
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';
const TENANT_ID = 'tenant-1';
const CALLER_UID = 'user-admin-1';
const WORKER_UID = 'worker-brigade-1';

// A past date safe for isoPastDate validation
const PAST_DATE = '2024-01-15';
// A future date safe for isoDate (nextExpirationAt / nextExpiration)
const FUTURE_DATE = '2027-12-31';

/** Seed the fakeFirestore with the minimum project + tenant docs needed by guard(). */
function seedProject() {
  // assertProjectMember reads projects/<id> for members[] / createdBy
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [CALLER_UID, WORKER_UID],
    createdBy: CALLER_UID,
  });
}

/** Seed a brigade member doc so the GET snapshot returns it. */
function seedBrigadeMember(id: string, overrides: Record<string, unknown> = {}) {
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade/${id}`,
    {
      docType: 'member',
      workerUid: WORKER_UID,
      role: 'first_aid',
      trainedAt: PAST_DATE,
      trainingValidYears: 2,
      active: true,
      ...overrides,
    },
  );
}

/** Seed a brigade resource doc. */
function seedBrigadeResource(id: string, overrides: Record<string, unknown> = {}) {
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade/${id}`,
    {
      docType: 'resource',
      kind: 'extinguisher',
      location: 'Bodega A',
      lastInspectedAt: PAST_DATE,
      nextExpirationAt: FUTURE_DATE,
      operational: true,
      ...overrides,
    },
  );
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ── GET /:projectId/emergency-brigade ─────────────────────────────────────

describe('GET /:projectId/emergency-brigade', () => {
  const endpoint = `${PREFIX}/${PROJECT_ID}/emergency-brigade`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(endpoint);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    // No project seeded → assertProjectMember throws ProjectMembershipError
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', 'outsider-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project exists but has no tenantId and no member subcollection', async () => {
    // Seed project without tenantId so resolveTenantId returns null
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
    });
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns empty brigade with readinessLevel=rose (no members, no resources)', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(Array.isArray(res.body.resources)).toBe(true);
    expect(res.body.members).toHaveLength(0);
    expect(res.body.resources).toHaveLength(0);
    // No members + no resources → multiple gaps → rose
    expect(res.body.readinessLevel).toBe('rose');
    expect(res.body.brigade).toBeDefined();
    expect(res.body.resourceReadiness).toBeDefined();
    expect(res.body.brigade.meetsMinimum).toBe(false);
  });

  it('200 returns seeded members and resources, computes readiness', async () => {
    seedProject();
    // trainedAt 2025-12-01 + 2 years validity → expires 2027-12-01, still valid today (2026-05-30)
    const RECENT_TRAINED = '2025-12-01';
    // Seed one member per minimum-required role
    seedBrigadeMember('m-chief', { role: 'brigade_chief', workerUid: 'w-chief', trainedAt: RECENT_TRAINED });
    seedBrigadeMember('m-first-aid', { role: 'first_aid', workerUid: 'w-first-aid', trainedAt: RECENT_TRAINED });
    seedBrigadeMember('m-fire', { role: 'fire_response', workerUid: 'w-fire', trainedAt: RECENT_TRAINED });
    // Seed one operational resource with expiry far future (no attention needed)
    seedBrigadeResource('r-ext-1', {
      nextExpirationAt: FUTURE_DATE,
      operational: true,
    });

    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(3);
    expect(res.body.resources).toHaveLength(1);
    expect(res.body.brigade.meetsMinimum).toBe(true);
    expect(res.body.brigade.uncoveredRoles).toHaveLength(0);
    // 1 resource but expiry > 30 days → no attention → readinessLevel = green
    expect(res.body.readinessLevel).toBe('green');
  });

  it('200 member with expired training is flagged in expiredTrainings', async () => {
    seedProject();
    // trainedAt 1990 + 2 years validity → expired
    seedBrigadeMember('m-expired', {
      role: 'brigade_chief',
      trainedAt: '1990-01-01',
      trainingValidYears: 2,
    });

    const res = await request(buildApp())
      .get(endpoint)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.brigade.expiredTrainings).toHaveLength(1);
    expect(res.body.brigade.expiredTrainings[0].workerUid).toBe(WORKER_UID);
  });
});

// ── POST /:projectId/emergency-brigade/members ────────────────────────────

describe('POST /:projectId/emergency-brigade/members', () => {
  const endpoint = `${PREFIX}/${PROJECT_ID}/emergency-brigade/members`;

  const validBody = {
    workerUid: WORKER_UID,
    role: 'first_aid',
    trainedAt: PAST_DATE,
    trainingValidYears: 2,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(endpoint).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when role is missing', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ workerUid: WORKER_UID, trainedAt: PAST_DATE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when trainedAt is a future date', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, trainedAt: '2099-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when trainedAt is not a date string', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, trainedAt: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', 'outsider')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 forbidden_role when caller lacks brigade write role', async () => {
    seedProject();
    // worker role is not in BRIGADE_WRITE_ROLES
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'worker')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect(Array.isArray(res.body.allowed)).toBe(true);
  });

  it('422 worker_not_in_project when workerUid is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, workerUid: 'unknown-worker-xyz' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('worker_not_in_project');
  });

  it('201 creates a brigade member and persists to Firestore', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');

    // Verify persisted doc in fakeFirestore
    const storedId = res.body.id;
    const doc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(storedId)
      .get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.docType).toBe('member');
    expect(data.workerUid).toBe(WORKER_UID);
    expect(data.role).toBe('first_aid');
    expect(data.createdBy).toBe(CALLER_UID);
    expect(data.active).toBe(true);
    expect(data.trainingValidYears).toBe(2);
  });

  it('201 brigade_chief role is accepted for admin caller', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, role: 'brigade_chief' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    // Deterministic id includes role
    expect(res.body.id).toMatch(/brigade_chief/);
  });

  it('409 worker_already_in_role on duplicate (same workerUid + role)', async () => {
    seedProject();
    // First insertion
    const firstRes = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(firstRes.status).toBe(201);

    // Second insertion with same workerUid + role
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('worker_already_in_role');
    expect(typeof res.body.existingId).toBe('string');
  });

  it('201 accepts prevencionista role as caller', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'prevencionista')
      .send(validBody);
    expect(res.status).toBe(201);
  });

  it('201 accepts supervisor role as caller', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'supervisor')
      .send(validBody);
    expect(res.status).toBe(201);
  });
});

// ── POST /:projectId/emergency-brigade/resources ──────────────────────────

describe('POST /:projectId/emergency-brigade/resources', () => {
  const endpoint = `${PREFIX}/${PROJECT_ID}/emergency-brigade/resources`;

  const validBody = {
    kind: 'extinguisher',
    location: 'Bodega principal',
    lastInspectedAt: PAST_DATE,
    nextExpirationAt: FUTURE_DATE,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(endpoint).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when kind is invalid enum', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, kind: 'rocket_launcher' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when lastInspectedAt is in the future', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, lastInspectedAt: '2099-06-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when location is empty', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, location: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', 'outsider')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 forbidden_role when caller role is not in BRIGADE_WRITE_ROLES', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'worker')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('201 creates a resource doc and persists to Firestore', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');

    const storedId = res.body.id;
    const doc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(storedId)
      .get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.docType).toBe('resource');
    expect(data.kind).toBe('extinguisher');
    expect(data.location).toBe('Bodega principal');
    expect(data.operational).toBe(true);
    expect(data.createdBy).toBe(CALLER_UID);
  });

  it('201 operational defaults to true when not supplied', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody); // no `operational` key
    expect(res.status).toBe(201);
    const doc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(res.body.id)
      .get();
    expect(doc.data()!.operational).toBe(true);
  });

  it('201 accepts all valid resource kind enum values', async () => {
    seedProject();
    const kinds = ['first_aid_kit', 'aed', 'eyewash', 'safety_shower', 'fire_hose', 'spill_kit'];
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(endpoint)
        .set('x-test-uid', CALLER_UID)
        .set('x-test-role', 'admin')
        .send({ ...validBody, kind });
      expect(res.status).toBe(201);
    }
  });
});

// ── POST /:projectId/emergency-brigade/resources/:id/inspect ─────────────

describe('POST /:projectId/emergency-brigade/resources/:id/inspect', () => {
  const RESOURCE_ID = 'r-ext-existing';
  const endpoint = `${PREFIX}/${PROJECT_ID}/emergency-brigade/resources/${RESOURCE_ID}/inspect`;

  const validBody = {
    inspectedAt: PAST_DATE,
    operational: true,
    nextExpirationAt: FUTURE_DATE,
    notes: 'Extintor en buen estado',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(endpoint).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when inspectedAt is in the future', async () => {
    seedProject();
    seedBrigadeResource(RESOURCE_ID);
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ ...validBody, inspectedAt: '2099-06-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when operational field is missing', async () => {
    seedProject();
    seedBrigadeResource(RESOURCE_ID);
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ inspectedAt: PAST_DATE }); // missing operational
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', 'outsider')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 forbidden_role when caller lacks brigade write role', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'worker')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('404 resource_not_found when resource doc does not exist', async () => {
    seedProject();
    // No resource seeded
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('resource_not_found');
  });

  it('404 resource_not_found when doc exists but has wrong docType', async () => {
    seedProject();
    // Seed a doc with docType='member' at the resource path
    H.db!._seed(
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade/${RESOURCE_ID}`,
      { docType: 'member', workerUid: WORKER_UID },
    );
    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('resource_not_found');
  });

  it('201 creates inspection record and updates resource via batch', async () => {
    seedProject();
    seedBrigadeResource(RESOURCE_ID);

    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.inspectionId).toBe('string');

    // The resource doc should have been patched (lastInspectedAt, operational, lastInspectedBy)
    const resourceDoc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(RESOURCE_ID)
      .get();
    const resourceData = resourceDoc.data()!;
    expect(resourceData.lastInspectedAt).toBe(PAST_DATE);
    expect(resourceData.operational).toBe(true);
    expect(resourceData.lastInspectedBy).toBe(CALLER_UID);
    expect(resourceData.nextExpirationAt).toBe(FUTURE_DATE);

    // The inspection audit doc should have been created
    const inspectionDoc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(res.body.inspectionId)
      .get();
    expect(inspectionDoc.exists).toBe(true);
    const inspData = inspectionDoc.data()!;
    expect(inspData.docType).toBe('inspection');
    expect(inspData.resourceId).toBe(RESOURCE_ID);
    expect(inspData.inspectedBy).toBe(CALLER_UID);
    expect(inspData.operational).toBe(true);
    expect(inspData.notes).toBe('Extintor en buen estado');
  });

  it('201 inspection without optional nextExpirationAt does not overwrite field', async () => {
    seedProject();
    seedBrigadeResource(RESOURCE_ID, { nextExpirationAt: FUTURE_DATE });

    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ inspectedAt: PAST_DATE, operational: false }); // no nextExpirationAt

    expect(res.status).toBe(201);

    const resourceDoc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(RESOURCE_ID)
      .get();
    const resourceData = resourceDoc.data()!;
    // operational should be updated to false
    expect(resourceData.operational).toBe(false);
    // nextExpirationAt should remain from original seed (not overwritten)
    expect(resourceData.nextExpirationAt).toBe(FUTURE_DATE);

    const inspectionDoc = await H.db!
      .collection(`tenants/${TENANT_ID}/projects/${PROJECT_ID}/emergency_brigade`)
      .doc(res.body.inspectionId)
      .get();
    expect(inspectionDoc.data()!.notes).toBeNull();
  });

  it('201 brigade_chief role caller can inspect resources', async () => {
    seedProject();
    seedBrigadeResource(RESOURCE_ID);

    const res = await request(buildApp())
      .post(endpoint)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'brigade_chief')
      .send(validBody);
    expect(res.status).toBe(201);
  });
});

// ── Cross-cutting: tenant isolation via resolveTenantId fallback ──────────

describe('resolveTenantId fallback via members subcollection', () => {
  it('GET 200 resolves tenant from members subcollection when project doc has no tenantId', async () => {
    // Project doc exists (for assertProjectMember) but no tenantId
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
    });
    // Seed the tenantId into members subcollection doc
    H.db!._seed(`projects/${PROJECT_ID}/members/q0`, {
      uid: CALLER_UID,
      tenantId: TENANT_ID,
    });

    const res = await request(buildApp())
      .get(`${PREFIX}/${PROJECT_ID}/emergency-brigade`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.readinessLevel).toBeDefined();
  });
});
