// Integration test — the incident-flow route must PERSIST EDGES, not just nodes.
//
// `incidentFlow.test.ts` (the sibling real-router test) mocks the ENTIRE flow
// engine, so it asserts the route's guard/audit/response shape but can NEVER
// see whether `flowDepsFor` actually wires the edge layer. That blind spot let
// a real bug live: `flowDepsFor` injected `writeNodes` (server-side, #652) but
// NOT `createEdge`, so `writeOneEdge` returned null and EVERY edge was silently
// dropped → the incident→investigation→lesson→training graph was DISCONNECTED
// on the server (ISO 45001 §10.2 traceability broken).
//
// This test boots the REAL flow engine + REAL edge layer (`edges.ts` +
// `edgeStoreFirestore`) against a fake Firestore. Only the node writer is
// stubbed (we are testing edges, not nodes). It fails RED on the old route and
// passes once `flowDepsFor` injects a working `createEdge`.

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
    (req as Request & { user: { uid: string; email: string | null } }).user = {
      uid,
      email: 'u1@praeventio.cl',
    };
    next();
  },
}));
// Validation is not under test here — pass the body through; we send a valid one.
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Stub the server node writer so node persistence "succeeds" deterministically.
// The node id still comes from the REAL `nodeIdFor`; we only need the write to
// report ok so the flow proceeds to materialize the edge via the REAL edge layer.
vi.mock('../../server/services/serverZkNodeWriter.js', () => ({
  makeServerWriteNodes: () => async () => ({ ok: true }),
}));

import incidentFlowRouter from '../../server/routes/incidentFlow.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', incidentFlowRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
const report = {
  incidentId: 'inc1',
  occurredAtIso: '2026-05-01T10:00:00.000Z',
  description: 'Trabajador resbaló en plataforma húmeda sin señalización',
  severity: 'high' as const,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Real assertProjectMember: u1 must be a member; resolveTenantId reads tenantId.
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('incident-flow keeps the ZK graph connected (real edge persistence)', () => {
  it('open-investigation materializes an edge in tenants/{tid}/zettelkasten_edges', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/incident-flow/inc1/open-investigation')
      .set(uid)
      .send({
        investigatorUid: 'inv1',
        openedAtIso: '2026-05-02T09:00:00.000Z',
        scopeNotes: 'Revisión del estado de la plataforma y del procedimiento de limpieza.',
        report,
      });

    expect(res.status).toBe(201);
    // The investigation node MUST link back to the incident node via a real
    // edge. A flowDepsFor that forgets createEdge returns ok:true with an EMPTY
    // edgeIds and writes no edge doc → silently disconnected trail.
    expect(Array.isArray(res.body.edgeIds)).toBe(true);
    expect(res.body.edgeIds.length).toBeGreaterThan(0);

    const edgeDocs = [...H.db!._store.keys()].filter((k) =>
      k.startsWith('tenants/t1/zettelkasten_edges/'),
    );
    expect(edgeDocs.length).toBeGreaterThan(0);
  });
});
