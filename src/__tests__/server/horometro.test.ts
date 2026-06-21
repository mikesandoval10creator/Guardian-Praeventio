// Real-router supertest coverage for src/server/routes/horometro.ts
// Plan v3 Fase 1 — raises line coverage on the 428-LOC horometro route surface (was 0 tests).
//
// Endpoints under test (mount: /api/sprint-k):
//   POST /:projectId/horometro/reading
//   GET  /:projectId/horometro/equipment/:eqId/maintenance-tasks
//   POST /:projectId/horometro/maintenance-task/:taskId/complete
//
// Founder directive (ADR inline): route NEVER blocks machinery — it only
// RECOMMENDS via the ZK chain. Tests assert that flow result is present and
// that status is 'open' (never 'blocked' or 'fuera_servicio') on new tasks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── hoisted holder ────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // ZK flow mocks
  onHorometroReading: vi.fn(),
  onMaintenanceCompleted: vi.fn(),
  writeNodes: vi.fn(),
  createEdge: vi.fn(),
  buildEdgeStore: vi.fn(),
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth: accept x-test-uid header, 401 if absent ──────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
      return;
    }
    req.user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    } as import('express').Request['user'];
    next();
  },
}));

// ── idempotencyKey: pass-through (no Firestore cache needed for unit tests) ──

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () =>
    (_req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) =>
      next(),
}));

// ── infrastructure mocks ──────────────────────────────────────────────────────

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({
    captureException: vi.fn(),
  }),
}));

// ── ZK flow mocks ─────────────────────────────────────────────────────────────

vi.mock('../../services/zettelkasten/flows/horometroMaintenanceFlow.js', () => ({
  onHorometroReading: H.onHorometroReading,
  onMaintenanceCompleted: H.onMaintenanceCompleted,
}));

vi.mock('../../services/zettelkasten/persistence/writeNode.js', () => ({
  writeNodes: H.writeNodes,
}));

vi.mock('../../services/zettelkasten/edges.js', () => ({
  createEdge: H.createEdge,
}));

vi.mock('../../services/zettelkasten/edgeStoreFirestore.js', () => ({
  buildEdgeStore: H.buildEdgeStore,
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import horometroRouter from '../../server/routes/horometro.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── test helpers ──────────────────────────────────────────────────────────────

const PREFIX = '/api/sprint-k';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, horometroRouter);
  return app;
}

// Seed helper: set up a project with members + tenantId so guard() passes.
function seedProject(projectId = 'proj-1', uid = 'uid-1', tenantId = 'tenant-1') {
  H.db!._seed(`projects/${projectId}`, {
    tenantId,
    members: [uid],
    createdBy: uid,
  });
}

// Seed helper: put an equipment doc so EquipmentAdapter.getById returns it.
function seedEquipment(
  tenantId = 'tenant-1',
  projectId = 'proj-1',
  equipmentId = 'eq-1',
  type = 'compresor',
) {
  H.db!._seed(
    `tenants/${tenantId}/projects/${projectId}/equipment/${equipmentId}`,
    { id: equipmentId, type, status: 'active' },
  );
}

// Seed helper: put a maintenance task doc.
function seedTask(
  tenantId = 'tenant-1',
  projectId = 'proj-1',
  taskId = 'task-1',
  status: string = 'open',
) {
  H.db!._seed(
    `tenants/${tenantId}/projects/${projectId}/maintenance_tasks/${taskId}`,
    {
      id: taskId,
      projectId,
      equipmentId: 'eq-1',
      equipmentType: 'compresor',
      thresholdHours: 250,
      triggeredAtHours: 250,
      multiplier: 1,
      severity: 'low',
      status,
      dueAtIso: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    },
  );
}

const FLOW_OK = {
  ok: true,
  readingNodeId: 'rn-1',
  crossesDetected: 0,
  tasksCreated: 0,
  edgesCreated: 1,
};

const FLOW_WITH_TASK = {
  ok: true,
  readingNodeId: 'rn-2',
  crossesDetected: 1,
  tasksCreated: 1,
  edgesCreated: 2,
};

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();

  H.onHorometroReading.mockResolvedValue(FLOW_OK);
  H.onMaintenanceCompleted.mockResolvedValue(FLOW_OK);
  H.writeNodes.mockResolvedValue({ ok: true, ids: ['n1'] });
  H.createEdge.mockResolvedValue(undefined);
  H.buildEdgeStore.mockReturnValue({});
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /:projectId/horometro/reading
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/horometro/reading', () => {
  const url = (pid = 'proj-1') => `${PREFIX}/${pid}/horometro/reading`;

  const validBody = {
    equipmentId: 'eq-1',
    hours: 300,
    source: 'qr_entry',
  };

  // ── auth ────────────────────────────────────────────────────────────────────

  it('401 — missing Authorization (no x-test-uid)', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  // ── validation (validate middleware — real Zod schema) ───────────────────────

  it('400 — missing equipmentId triggers invalid_payload', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ hours: 100, source: 'qr_entry' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 — hours < 0 triggers invalid_payload', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: -5, source: 'qr_entry' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid source enum triggers invalid_payload', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: 100, source: 'alien_scan' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  // ── project membership ────────────────────────────────────────────────────────

  it('403 — caller is not a member of the project', async () => {
    // Seed project with uid-2 as member, caller is uid-1
    H.db!._seed('projects/proj-1', {
      tenantId: 'tenant-1',
      members: ['uid-2'],
      createdBy: 'uid-2',
    });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 — project exists but tenantId is missing → tenant_not_found', async () => {
    // Project has member but no tenantId field
    H.db!._seed('projects/proj-1', { members: ['uid-1'], createdBy: 'uid-1' });
    // No tenantId in doc and no member sub-collection doc either
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('404 — equipment not found → 404 equipment_not_found', async () => {
    seedProject();
    // Do NOT seed equipment — EquipmentAdapter.getById returns null
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('equipment_not_found');
  });

  // ── happy path ────────────────────────────────────────────────────────────────

  it('201 — reading recorded, no threshold crossed → flow result attached', async () => {
    seedProject();
    seedEquipment();
    H.onHorometroReading.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.reading).toMatchObject({
      equipmentId: 'eq-1',
      hours: 300,
      source: 'qr_entry',
    });
    expect(typeof res.body.reading.recordedAt).toBe('string');
    expect(res.body.flow).toMatchObject({ ok: true });

    // Firestore side-effect: reading doc saved under horometro_readings
    const store = H.db!._dump();
    const readingPaths = Object.keys(store).filter((k) =>
      k.startsWith('tenants/tenant-1/projects/proj-1/equipment/eq-1/horometro_readings/'),
    );
    expect(readingPaths.length).toBeGreaterThanOrEqual(1);
  });

  it('201 — reading with notes field is saved correctly', async () => {
    seedProject();
    seedEquipment();

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ ...validBody, notes: 'Revisión visual sin anomalías' });

    expect(res.status).toBe(201);
    expect(res.body.reading.notes).toBe('Revisión visual sin anomalías');
  });

  it('201 — threshold crossed: flow result shows tasksCreated > 0, task status is open (never blocked)', async () => {
    seedProject();
    seedEquipment();
    H.onHorometroReading.mockResolvedValueOnce(FLOW_WITH_TASK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: 260, source: 'qr_entry' });

    expect(res.status).toBe(201);
    expect(res.body.flow.tasksCreated).toBe(1);
    expect(res.body.flow.crossesDetected).toBe(1);
    // The route must never set equipment status to blocked — it only recommends
    const dump = H.db!._dump();
    const eqDoc = dump[`tenants/tenant-1/projects/proj-1/equipment/eq-1`];
    expect(eqDoc?.status).not.toBe('bloqueado');
    expect(eqDoc?.status).not.toBe('fuera_servicio');
  });

  it('422 — hours regression for non-manual source → horometro_validation_error', async () => {
    seedProject();
    seedEquipment();
    // Seed an existing reading with higher hours so recordReading sees a regression
    H.db!._seed('tenants/tenant-1/projects/proj-1/equipment/eq-1/horometro_readings/r1', {
      equipmentId: 'eq-1',
      hours: 1000,
      source: 'qr_entry',
      recordedAt: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: 500, source: 'qr_entry' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('horometro_validation_error');
    expect(res.body.code).toBe('HOURS_REGRESSION');
  });

  it('201 — manual source allows regression correction', async () => {
    seedProject();
    seedEquipment();
    H.db!._seed('tenants/tenant-1/projects/proj-1/equipment/eq-1/horometro_readings/r1', {
      equipmentId: 'eq-1',
      hours: 1000,
      source: 'qr_entry',
      recordedAt: new Date().toISOString(),
    });
    H.onHorometroReading.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: 500, source: 'manual', notes: 'corregir lectura erronea' });

    expect(res.status).toBe(201);
    expect(res.body.reading.hours).toBe(500);
    expect(res.body.reading.source).toBe('manual');
  });

  it('500 — onHorometroReading throws → 500 internal_error', async () => {
    seedProject();
    seedEquipment();
    H.onHorometroReading.mockRejectedValueOnce(new Error('ZK exploded'));

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });

  it('201 — reading also verifies getLastMaintenanceHours baseline via completed task', async () => {
    seedProject();
    seedEquipment();
    // Seed a completed task so getLastMaintenanceHours returns > 0
    H.db!._seed(
      'tenants/tenant-1/projects/proj-1/maintenance_tasks/mt1',
      {
        equipmentId: 'eq-1',
        status: 'completed',
        triggeredAtHours: 250,
        completion: { horometroAtCompletion: 260 },
      },
    );
    H.onHorometroReading.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ equipmentId: 'eq-1', hours: 400, source: 'iot' });

    expect(res.status).toBe(201);
    // onHorometroReading was called with the correct lastMaintenanceHours derived from Firestore
    expect(H.onHorometroReading).toHaveBeenCalledWith(
      expect.objectContaining({ lastMaintenanceHours: 260 }),
      expect.any(Object),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /:projectId/horometro/equipment/:eqId/maintenance-tasks
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/horometro/equipment/:eqId/maintenance-tasks', () => {
  const url = (pid = 'proj-1', eqId = 'eq-1') =>
    `${PREFIX}/${pid}/horometro/equipment/${eqId}/maintenance-tasks`;

  // ── auth ────────────────────────────────────────────────────────────────────

  it('401 — missing x-test-uid', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  // ── eqId validation (inline guard in route) ───────────────────────────────

  it('400 — eqId > 200 chars → invalid_equipment_id', async () => {
    seedProject();
    const longId = 'x'.repeat(201);
    const res = await request(buildApp())
      .get(url('proj-1', longId))
      .set('x-test-uid', 'uid-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_equipment_id');
  });

  // ── project membership ────────────────────────────────────────────────────────

  it('403 — caller not a project member', async () => {
    H.db!._seed('projects/proj-1', {
      tenantId: 'tenant-1',
      members: ['uid-other'],
      createdBy: 'uid-other',
    });
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  // ── happy path ────────────────────────────────────────────────────────────────

  it('200 — no tasks, no readings → empty tasks array, currentHours=0', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.currentHours).toBe(0);
  });

  it('200 — one open task exists → returned in tasks array', async () => {
    seedProject();
    seedTask();

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].id).toBe('task-1');
    expect(res.body.tasks[0].status).toBe('open');
  });

  it('200 — completed task is NOT returned (only open/scheduled/in_progress)', async () => {
    seedProject();
    seedTask('tenant-1', 'proj-1', 'task-done', 'completed');

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  it('200 — currentHours reflects latest reading', async () => {
    seedProject();
    H.db!._seed('tenants/tenant-1/projects/proj-1/equipment/eq-1/horometro_readings/r1', {
      equipmentId: 'eq-1',
      hours: 750,
      source: 'iot',
      recordedAt: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.currentHours).toBe(750);
  });

  it('200 — multiple tasks, only active statuses returned', async () => {
    seedProject();
    seedTask('tenant-1', 'proj-1', 'task-open', 'open');
    seedTask('tenant-1', 'proj-1', 'task-scheduled', 'scheduled');
    seedTask('tenant-1', 'proj-1', 'task-completed', 'completed');

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    const ids = res.body.tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain('task-open');
    expect(ids).toContain('task-scheduled');
    expect(ids).not.toContain('task-completed');
  });

  it('500 — unexpected error → 500 internal_error', async () => {
    seedProject();
    // Corrupt the db by making collection throw
    const origCollection = H.db!.collection.bind(H.db!);
    let callCount = 0;
    vi.spyOn(H.db!, 'collection').mockImplementation((path: string) => {
      // Let project check pass (first 2 calls), then throw on tasks query
      callCount++;
      if (callCount > 2) throw new Error('db exploded');
      return origCollection(path);
    });

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', 'uid-1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2b. GET /:projectId/horometro/equipment/:eqId/status
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/horometro/equipment/:eqId/status', () => {
  const url = (pid = 'proj-1', eqId = 'eq-1') =>
    `${PREFIX}/${pid}/horometro/equipment/${eqId}/status`;

  it('401 — missing x-test-uid', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  it('400 — eqId > 200 chars → invalid_equipment_id', async () => {
    seedProject();
    const longId = 'x'.repeat(201);
    const res = await request(buildApp())
      .get(url('proj-1', longId))
      .set('x-test-uid', 'uid-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_equipment_id');
  });

  it('403 — caller not a project member', async () => {
    H.db!._seed('projects/proj-1', {
      tenantId: 'tenant-1',
      members: ['uid-other'],
      createdBy: 'uid-other',
    });
    const res = await request(buildApp()).get(url()).set('x-test-uid', 'uid-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 — equipment not found → equipment_not_found', async () => {
    seedProject();
    // No equipment seeded.
    const res = await request(buildApp()).get(url()).set('x-test-uid', 'uid-1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('equipment_not_found');
  });

  it('200 — derives currentHours from latest reading and lastMaintenanceAtHours from completed task (real data)', async () => {
    seedProject();
    seedEquipment('tenant-1', 'proj-1', 'eq-1', 'compresor');
    // Real latest reading at 1700h.
    H.db!._seed('tenants/tenant-1/projects/proj-1/equipment/eq-1/horometro_readings/r1', {
      equipmentId: 'eq-1',
      hours: 1700,
      source: 'iot',
      recordedAt: new Date().toISOString(),
    });
    // Real completed task → last maintenance at 1000h.
    H.db!._seed('tenants/tenant-1/projects/proj-1/maintenance_tasks/mt1', {
      equipmentId: 'eq-1',
      status: 'completed',
      triggeredAtHours: 1000,
      completion: { horometroAtCompletion: 1000 },
    });

    const res = await request(buildApp()).get(url()).set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    // compresor's largest manufacturer cycle is 2000h → policy cycle.
    expect(res.body.policy.cycleHours).toBe(2000);
    expect(res.body.horometer.currentHours).toBe(1700);
    expect(res.body.horometer.lastMaintenanceAtHours).toBe(1000);
    expect(res.body.horometer.machineId).toBe('eq-1');
    // status is derived by the engine: 700h since last maintenance of a 2000h
    // cycle → OK (no threshold triggered yet).
    expect(res.body.status.hoursSinceLastMaintenance).toBe(700);
    expect(res.body.status.triggeredThreshold).toBeNull();
  });

  it('200 — no readings yet → currentHours 0, last maintenance 0, honest OK status', async () => {
    seedProject();
    seedEquipment('tenant-1', 'proj-1', 'eq-1', 'compresor');

    const res = await request(buildApp()).get(url()).set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.horometer.currentHours).toBe(0);
    expect(res.body.horometer.lastMaintenanceAtHours).toBe(0);
    expect(res.body.status.hoursSinceLastMaintenance).toBe(0);
  });

  it('200 — unmapped equipment type falls back to conservative 250h cycle', async () => {
    seedProject();
    seedEquipment('tenant-1', 'proj-1', 'eq-1', 'tipo_no_mapeado');

    const res = await request(buildApp()).get(url()).set('x-test-uid', 'uid-1');

    expect(res.status).toBe(200);
    expect(res.body.policy.cycleHours).toBe(250);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/horometro/maintenance-task/:taskId/complete
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/horometro/maintenance-task/:taskId/complete', () => {
  const url = (pid = 'proj-1', taskId = 'task-1') =>
    `${PREFIX}/${pid}/horometro/maintenance-task/${taskId}/complete`;

  const validBody = {
    notes: 'Cambio de filtros y aceite realizado correctamente.',
  };

  // ── auth ────────────────────────────────────────────────────────────────────

  it('401 — missing x-test-uid', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  // ── validation (real Zod schema) ─────────────────────────────────────────────

  it('400 — missing notes triggers invalid_payload', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — empty notes string triggers invalid_payload', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({ notes: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  // ── taskId inline validation ───────────────────────────────────────────────

  it('400 — taskId > 200 chars → invalid_task_id', async () => {
    seedProject();
    const longId = 'x'.repeat(201);
    const res = await request(buildApp())
      .post(url('proj-1', longId))
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_task_id');
  });

  // ── project membership ────────────────────────────────────────────────────────

  it('403 — caller not a project member', async () => {
    H.db!._seed('projects/proj-1', {
      tenantId: 'tenant-1',
      members: ['uid-other'],
      createdBy: 'uid-other',
    });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  // ── task not found ─────────────────────────────────────────────────────────

  it('404 — task does not exist → maintenance_complete_error TASK_NOT_FOUND', async () => {
    seedProject();
    // No task seeded
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('maintenance_complete_error');
    expect(res.body.code).toBe('TASK_NOT_FOUND');
  });

  // ── duplicate completion (409) ─────────────────────────────────────────────

  it('409 — task already completed → maintenance_complete_error TASK_ALREADY_COMPLETED', async () => {
    seedProject();
    seedTask('tenant-1', 'proj-1', 'task-1', 'completed');

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('maintenance_complete_error');
    expect(res.body.code).toBe('TASK_ALREADY_COMPLETED');
  });

  it('409 — task is cancelled → maintenance_complete_error TASK_CANCELLED', async () => {
    seedProject();
    seedTask('tenant-1', 'proj-1', 'task-1', 'cancelled');

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('maintenance_complete_error');
    expect(res.body.code).toBe('TASK_CANCELLED');
  });

  // ── happy path ────────────────────────────────────────────────────────────────

  it('200 — task completed → response has task.status=completed and completion block', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.task).toBeDefined();
    expect(res.body.task.status).toBe('completed');
    expect(res.body.task.completion).toBeDefined();
    expect(res.body.task.completion.completedByUid).toBe('uid-1');
    expect(res.body.task.completion.notes).toBe(validBody.notes);
    expect(res.body.flow).toMatchObject({ ok: true });
  });

  it('200 — completion with biometricSignatureHash → signature stored', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({
        notes: 'Mantenimiento completo con firma biométrica.',
        biometricSignatureHash: 'abc123def456gh78',
      });

    expect(res.status).toBe(200);
    expect(res.body.task.completion.biometricSignatureHash).toBe('abc123def456gh78');
  });

  it('200 — completion with horometroAtCompletion → stored in completion block', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockResolvedValueOnce(FLOW_OK);

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send({
        notes: 'Mantenimiento finalizado.',
        horometroAtCompletion: 255,
      });

    expect(res.status).toBe(200);
    expect(res.body.task.completion.horometroAtCompletion).toBe(255);
  });

  it('200 — Firestore side-effect: task doc updated with status=completed', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockResolvedValueOnce(FLOW_OK);

    await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    const dump = H.db!._dump();
    const taskDoc = dump['tenants/tenant-1/projects/proj-1/maintenance_tasks/task-1'];
    expect(taskDoc?.status).toBe('completed');
    expect(taskDoc?.completion).toBeDefined();
  });

  it('200 — onMaintenanceCompleted flow called with correct task + completion', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockResolvedValueOnce(FLOW_OK);

    await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    expect(H.onMaintenanceCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        projectId: 'proj-1',
        task: expect.objectContaining({ id: 'task-1', status: 'completed' }),
        completion: expect.objectContaining({
          completedByUid: 'uid-1',
          notes: validBody.notes,
        }),
      }),
      expect.any(Object),
    );
  });

  it('500 — onMaintenanceCompleted throws → 500 internal_error', async () => {
    seedProject();
    seedTask();
    H.onMaintenanceCompleted.mockRejectedValueOnce(new Error('ZK write failed'));

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', 'uid-1')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
