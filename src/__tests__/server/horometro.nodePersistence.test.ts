// Route-level persistence test for the horometro ZK flow (PR #730 follow-up).
//
// `zkServerWriter.test.ts` (contracts) is a STATIC wiring guard (the route
// imports makeServerWriteNodes, not the browser writer), and
// `serverZkNodeWriter.test.ts` exercises the writer in ISOLATION. Neither proves
// that booting the REAL horometro route end-to-end actually persists ZK nodes.
//
// This test boots the real `horometroRouter` with `getFirestore()` mocked by
// the in-memory FakeFirestore, lets the REAL flow (`onHorometroReading`) and the
// REAL Admin-SDK writer (`serverWriteNodes`) run, and asserts the node docs
// actually land in the canonical `zettelkasten_nodes` collection — closing the
// Codex P1 #650 bug class (browser writeNodes silently never persisted inside
// Express) with behavioral, not just structural, coverage.
//
// Only the edge store is mocked (out of scope here; edges are covered elsewhere).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── hoisted holder ────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin → in-memory FakeFirestore (the REAL serverWriteNodes calls
//    getFirestore() directly, so this captures its writes) ─────────────────

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
      email: req.header('x-test-email') ?? undefined,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    } as import('express').Request['user'];
    next();
  },
}));

// ── idempotencyKey: pass-through ─────────────────────────────────────────────

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
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// The real EdgeStore adapter and createEdge path run against the same fake database.


// NOTE: deliberately NOT mocking horometroMaintenanceFlow, serverZkNodeWriter,
// persistence/writeNode (nodeIdFor), horometroService, maintenanceScheduler, or
// equipmentFirestoreAdapter — they must run for real against the FakeFirestore.

// ── imports (after mocks) ─────────────────────────────────────────────────────

import horometroRouter from '../../server/routes/horometro.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

import { getFirestore } from 'firebase-admin/firestore';
import { getRelatedNodes } from '../../services/zettelkasten/edges.js';
import { buildEdgeStore, EDGE_PATH } from '../../services/zettelkasten/edgeStoreFirestore.js';
const PREFIX = '/api/sprint-k';
const UID = 'uid-1';
const PROJECT_ID = 'proj-1';
const TENANT_ID = 'tenant-1';
const EQUIPMENT_ID = 'eq-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, horometroRouter);
  return app;
}

function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    tenantId: TENANT_ID,
    members: [UID],
    createdBy: UID,
  });
}

function seedEquipment(type = 'compresor') {
  H.db!._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment/${EQUIPMENT_ID}`,
    { id: EQUIPMENT_ID, type, status: 'active' },
  );
}

const url = `${PREFIX}/${PROJECT_ID}/horometro/reading`;

function postReading(hours: number) {
  return request(buildApp())
    .post(url)
    .set('x-test-uid', UID)
    .set('x-test-email', 'op@praeventio.test')
    .send({ equipmentId: EQUIPMENT_ID, hours, source: 'qr_entry' });
}

function postTaskCompletion(taskId: string) {
  return request(buildApp())
    .post(`${PREFIX}/${PROJECT_ID}/horometro/maintenance-task/${taskId}/complete`)
    .set('x-test-uid', UID)
    .set('x-test-email', 'op@praeventio.test')
    .send({ notes: 'Synthetic maintenance evidence', horometroAtCompletion: 300 });
}

/** All `zettelkasten_nodes/{id}` docs persisted to the fake Firestore. */
function dumpZkNodes(): Array<Record<string, unknown>> {
  const store = H.db!._dump();
  return Object.entries(store)
    .filter(([k]) => k.startsWith('zettelkasten_nodes/'))
    .map(([, v]) => v as Record<string, unknown>);
}

function dumpZkNodeDocs(): Array<{ docId: string; data: Record<string, unknown> }> {
  return Object.entries(H.db!._dump())
    .filter(([path]) => path.startsWith('zettelkasten_nodes/'))
    .map(([path, data]) => ({
      docId: path.slice('zettelkasten_nodes/'.length),
      data: data as Record<string, unknown>,
    }));
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();
});

describe('horometro route → REAL serverWriteNodes persists ZK nodes', () => {
  it('repeated HTTP readings preserve cancellation and create only the next threshold task', async () => {
    seedProject();
    seedEquipment();
    expect((await postReading(300)).status).toBe(201);
    const path = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/maintenance_tasks/mtask-${EQUIPMENT_ID}-250h-k1`;
    const cancelled = { ...H.db!._dump()[path], status: 'cancelled', notes: 'Supervisor cancelled this cycle' };
    H.db!._seed(path, cancelled);

    expect((await postReading(301)).status).toBe(201);
    expect(H.db!._dump()[path]).toEqual(cancelled);
    expect((await postReading(550)).status).toBe(201);
    expect(H.db!._dump()[path]).toEqual(cancelled);
    const nextPath = path.replace('250h-k1', '250h-k2');
    expect(H.db!._dump()[nextPath]).toMatchObject({ status: 'open', multiplier: 2, triggeredAtHours: 500 });
  });

  it('repeated HTTP readings preserve signed completion and its maintenance baseline', async () => {
    seedProject();
    seedEquipment();
    expect((await postReading(300)).status).toBe(201);
    const path = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/maintenance_tasks/mtask-${EQUIPMENT_ID}-250h-k1`;
    const completed = { ...H.db!._dump()[path], status: 'completed', completion: {
      completedByUid: UID, completedAt: '2026-10-01T12:00:00.000Z', notes: 'Signed maintenance', horometroAtCompletion: 300,
    } };
    H.db!._seed(path, completed);
    const repeated = await postReading(301);
    expect(repeated.status).toBe(201);
    expect(repeated.body.flow.crossesDetected).toBe(0);
    expect(H.db!._dump()[path]).toEqual(completed);
  });

  it('a plain reading (no threshold) persists the horometro-reading node to zettelkasten_nodes', async () => {
    seedProject();
    seedEquipment();

    const res = await postReading(100); // below the 250h compresor cycle → no cross

    expect(res.status).toBe(201);
    expect(res.body.flow).toMatchObject({ ok: true, crossesDetected: 0 });

    const nodes = dumpZkNodes();
    const readingNodes = nodes.filter((n) => n.type === 'horometro-reading');
    expect(readingNodes.length).toBe(1);

    const node = readingNodes[0];
    expect(node.projectId).toBe(PROJECT_ID);
    expect(node.createdBy).toBe(UID); // stamped server-side from the verified token
    expect(node.createdByEmail).toBe('op@praeventio.test');
    expect(typeof node.title).toBe('string');
    expect((node.title as string).length).toBeGreaterThan(0);
    expect(node.idempotencyKey).toBeDefined();

    // No false negatives: a non-crossing reading must NOT emit threshold/task nodes.
    expect(nodes.some((n) => n.type === 'maintenance-threshold-reached')).toBe(false);
    expect(nodes.some((n) => n.type === 'maintenance-task-created')).toBe(false);
  });

  it('a threshold-crossing reading persists reading + threshold + task nodes to zettelkasten_nodes', async () => {
    seedProject();
    seedEquipment();

    const res = await postReading(300); // crosses the 250h compresor cycle (k=1)

    expect(res.status).toBe(201);
    expect(res.body.flow).toMatchObject({ ok: true });
    expect((res.body.flow.crossesDetected as number)).toBeGreaterThanOrEqual(1);

    const nodes = dumpZkNodes();
    const byType = (t: string) => nodes.filter((n) => n.type === t);

    expect(byType('horometro-reading').length).toBe(1);
    expect(byType('maintenance-threshold-reached').length).toBeGreaterThanOrEqual(1);
    expect(byType('maintenance-task-created').length).toBeGreaterThanOrEqual(1);
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    // Every persisted node carries the project scope + server-stamped author.
    for (const n of nodes) {
      expect(n.projectId).toBe(PROJECT_ID);
      expect(n.createdBy).toBe(UID);
    }
  });

  it('persists and reads back reading → threshold → task → completion edges by canonical IDs', async () => {
    seedProject();
    seedEquipment();

    const res = await postReading(300);
    expect(res.status).toBe(201);

    const nodes = dumpZkNodeDocs();
    const reading = nodes.find((node) => node.data.type === 'horometro-reading');
    const threshold = nodes.find((node) => node.data.type === 'maintenance-threshold-reached');
    const task = nodes.find((node) => node.data.type === 'maintenance-task-created');
    expect(reading).toBeDefined();
    expect(threshold).toBeDefined();
    expect(task).toBeDefined();
    if (!reading || !threshold || !task) throw new Error('missing persisted chain node');

    const edges = Object.entries(H.db!._dump())
      .filter(([path]) => path.startsWith(`${EDGE_PATH(TENANT_ID)}/`))
      .map(([, edge]) => edge);
    expect(edges).toHaveLength(5);
    expect(edges).toContainEqual(expect.objectContaining({
      fromNodeId: reading.docId,
      toNodeId: threshold.docId,
      type: 'causes',
    }));
    expect(edges).toContainEqual(expect.objectContaining({
      fromNodeId: threshold.docId,
      toNodeId: task.docId,
      type: 'causes',
    }));

    const localIds = [reading.data, threshold.data, task.data]
      .map((node) => (node.metadata as Record<string, unknown>).zkLocalId)
      .filter((id): id is string => typeof id === 'string');
    const persistedEndpoints = new Set([...nodes.map((node) => node.docId), EQUIPMENT_ID]);
    expect(H.db!._dump()[`tenants/${TENANT_ID}/projects/${PROJECT_ID}/equipment/${EQUIPMENT_ID}`]).toBeDefined();
    for (const edge of edges) {
      const endpoints = [edge.fromNodeId, edge.toNodeId];
      for (const endpoint of endpoints) {
        expect(typeof endpoint).toBe('string');
        if (typeof endpoint !== 'string') throw new Error('edge endpoint must be a string');
        expect(persistedEndpoints.has(endpoint)).toBe(true);
      }
      for (const localId of localIds) expect(endpoints).not.toContain(localId);
    }

    const edgeStore = buildEdgeStore(getFirestore());
    const readingRelated = await getRelatedNodes(
      edgeStore,
      reading.docId,
      TENANT_ID,
      { projectId: PROJECT_ID, direction: 'outgoing' },
    );
    expect(readingRelated).toContainEqual(expect.objectContaining({
      nodeId: threshold.docId,
      via: 'causes',
    }));
    const thresholdRelated = await getRelatedNodes(
      edgeStore,
      threshold.docId,
      TENANT_ID,
      { projectId: PROJECT_ID, direction: 'outgoing' },
    );
    expect(thresholdRelated).toContainEqual(expect.objectContaining({
      nodeId: task.docId,
      via: 'causes',
    }));

    const metadata = task.data.metadata as Record<string, unknown>;
    expect(typeof metadata.taskId).toBe('string');
    if (typeof metadata.taskId !== 'string') throw new Error('task node must carry taskId');
    const completionResponse = await postTaskCompletion(metadata.taskId);
    expect(completionResponse.status).toBe(200);
    expect(completionResponse.body.flow.ok).toBe(true);

    const completedNodes = dumpZkNodeDocs();
    const completed = completedNodes.find((node) => node.data.type === 'maintenance-task-completed');
    expect(completed).toBeDefined();
    if (!completed) throw new Error('missing persisted completion evidence node');
    expect(completionResponse.body.flow.readingNodeId).toBe(completed.docId);

    const completeGraphEdges = Object.entries(H.db!._dump())
      .filter(([path]) => path.startsWith(`${EDGE_PATH(TENANT_ID)}/`))
      .map(([, edge]) => edge);
    expect(completeGraphEdges).toHaveLength(7);
    expect(completeGraphEdges).toContainEqual(expect.objectContaining({
      fromNodeId: task.docId,
      toNodeId: completed.docId,
      type: 'causes',
    }));
    expect(completeGraphEdges).toContainEqual(expect.objectContaining({
      fromNodeId: completed.docId,
      toNodeId: EQUIPMENT_ID,
      type: 'references',
    }));

    const allPersistedEndpoints = new Set([...completedNodes.map((node) => node.docId), EQUIPMENT_ID]);
    const completedLocalId = (completed.data.metadata as Record<string, unknown>).zkLocalId;
    for (const edge of completeGraphEdges) {
      for (const endpoint of [edge.fromNodeId, edge.toNodeId]) {
        expect(typeof endpoint).toBe('string');
        if (typeof endpoint !== 'string') throw new Error('edge endpoint must be a string');
        expect(allPersistedEndpoints.has(endpoint)).toBe(true);
        expect(endpoint).not.toBe(completedLocalId);
      }
    }

    const taskRelated = await getRelatedNodes(
      edgeStore,
      task.docId,
      TENANT_ID,
      { projectId: PROJECT_ID, direction: 'outgoing' },
    );
    expect(taskRelated).toContainEqual(expect.objectContaining({
      nodeId: completed.docId,
      via: 'causes',
    }));
  });
});
