// Route-level persistence test for the horometro ZK flow (PR #730 follow-up).
//
// `zkServerWriter.test.ts` (contracts) is a STATIC wiring guard (the route
// imports makeServerWriteNodes, not the browser writer), and
// `serverZkNodeWriter.test.ts` exercises the writer in ISOLATION. Neither proves
// that booting the REAL horometro route end-to-end actually persists ZK nodes.
//
// This test boots the real `horometroRouter` with `admin.firestore()` mocked by
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
//    admin.firestore() directly, so this captures its writes) ─────────────────

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

// ── edge store: out of scope here (covered by edge tests). The REAL flow + REAL
//    node writer run; only edge materialization is stubbed to a no-op. ────────

vi.mock('../../services/zettelkasten/edges.js', () => ({
  createEdge: vi.fn(async () => undefined),
}));

vi.mock('../../services/zettelkasten/edgeStoreFirestore.js', () => ({
  buildEdgeStore: vi.fn(() => ({})),
}));

// NOTE: deliberately NOT mocking horometroMaintenanceFlow, serverZkNodeWriter,
// persistence/writeNode (nodeIdFor), horometroService, maintenanceScheduler, or
// equipmentFirestoreAdapter — they must run for real against the FakeFirestore.

// ── imports (after mocks) ─────────────────────────────────────────────────────

import horometroRouter from '../../server/routes/horometro.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

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

/** All `zettelkasten_nodes/{id}` docs persisted to the fake Firestore. */
function dumpZkNodes(): Array<Record<string, unknown>> {
  const store = H.db!._dump();
  return Object.entries(store)
    .filter(([k]) => k.startsWith('zettelkasten_nodes/'))
    .map(([, v]) => v as Record<string, unknown>);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();
});

describe('horometro route → REAL serverWriteNodes persists ZK nodes', () => {
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
});
