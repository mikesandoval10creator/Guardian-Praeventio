// Real-router supertest for the Incident→Investigation→Lesson→Training PDCA
// HTTP surface (7 endpoints). The route is a thin orchestration boundary over
// the pure flow engine, so we mock the engine and assert the route's job:
// guard, prev-node-id derivation, flow dispatch, audit write, response shape,
// the assign-microtraining batch-skip, and the GET status reducer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  onReported: vi.fn(),
  onAssigned: vi.fn(),
  pdca: vi.fn(),
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
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/zettelkasten/persistence/writeNode.js', () => ({
  nodeIdFor: vi.fn(async () => 'prev-node-id'),
}));
vi.mock('../../services/zettelkasten/flows/incidentLessonTrainingFlow.js', () => {
  const node = vi.fn(() => ({}));
  return {
    createIncidentReportedNode: node,
    createInvestigationOpenedNode: node,
    createRootCauseNode: node,
    createLessonPublishedNode: node,
    createMicrotrainingAssignedNode: node,
    createMicrotrainingCompletedNode: node,
    createInvestigationClosedNode: node,
    onIncidentReported: (...a: unknown[]) => H.onReported(...a),
    onInvestigationOpened: vi.fn(async () => ({ ok: true, nodeIds: ['n'], edgeIds: ['e'] })),
    onInvestigationConcluded: vi.fn(async () => ({ ok: true, nodeIds: ['n'], edgeIds: ['e'] })),
    onLessonPublished: vi.fn(async () => ({ ok: true, nodeIds: ['n'], edgeIds: ['e'] })),
    onMicrotrainingAssigned: (...a: unknown[]) => H.onAssigned(...a),
    onMicrotrainingCompleted: vi.fn(async () => ({ ok: true, nodeIds: ['n'], edgeIds: ['e'] })),
    onInvestigationClosed: vi.fn(async () => ({ ok: true, nodeIds: ['n'], edgeIds: ['e'] })),
    computePdcaStatus: (...a: unknown[]) => H.pdca(...a),
  };
});

import incidentFlowRouter from '../../server/routes/incidentFlow.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', incidentFlowRouter);
  return app;
}
const uid = { 'x-test-uid': 'u1' };
const reportBody = {
  incidentId: 'inc1',
  occurredAtIso: '2026-05-01T10:00:00.000Z',
  description: 'Trabajador resbaló en plataforma húmeda',
  severity: 'high',
};

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.onReported.mockReset().mockResolvedValue({ ok: true, nodeIds: ['n1'], edgeIds: ['e1'] });
  H.onAssigned.mockReset().mockResolvedValue({ ok: true, nodeIds: ['na'], edgeIds: ['ea'] });
  H.pdca.mockReset().mockReturnValue({ phase: 'detection', closurePercent: 14 });
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('POST report', () => {
  it('401 / 403 / 404 gates', async () => {
    expect((await request(buildApp()).post('/api/sprint-k/p1/incident-flow/report').send(reportBody)).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).post('/api/sprint-k/p1/incident-flow/report').set(uid).send(reportBody)).status).toBe(403);
    H.db!._seed('projects/p1', { name: 'no-tenant' });
    expect((await request(buildApp()).post('/api/sprint-k/p1/incident-flow/report').set(uid).send(reportBody)).status).toBe(404);
  });

  it('201 dispatches the flow + writes a canonical audit_logs row', async () => {
    const res = await request(buildApp()).post('/api/sprint-k/p1/incident-flow/report').set(uid).send(reportBody);
    expect(res.status).toBe(201);
    expect(res.body.nodeIds).toEqual(['n1']);
    expect(H.onReported).toHaveBeenCalledTimes(1);
    // CLAUDE.md #3: the audit row must land in the canonical top-level
    // audit_logs collection (append-only rules), not the tenant-scoped path.
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
  });

  it('500 when the flow engine returns ok:false', async () => {
    H.onReported.mockResolvedValue({ ok: false, error: 'edge_write_failed' });
    const res = await request(buildApp()).post('/api/sprint-k/p1/incident-flow/report').set(uid).send(reportBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('edge_write_failed');
  });
});

describe('POST assign-microtraining — batch skip on per-worker failure', () => {
  it('skips a failed worker but completes the rest (no abort)', async () => {
    // worker w2 fails; w1 + w3 succeed → 2 assignments, not aborted.
    H.onAssigned.mockImplementation(async (input: { workerUid: string }) =>
      input.workerUid === 'w2'
        ? { ok: false, error: 'node_conflict' }
        : { ok: true, nodeIds: ['n'], edgeIds: ['e'] },
    );
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/incident-flow/inc1/assign-microtraining')
      .set(uid)
      .send({
        moduleId: 'mod1',
        workerUids: ['w1', 'w2', 'w3'],
        assignedAtIso: '2026-05-02T10:00:00.000Z',
        lesson: {
          lessonId: 'les1', publishedAtIso: '2026-05-02T09:00:00.000Z', summary: 'Resumen lección',
          audienceUids: ['w1'], tags: ['altura'], riskCategories: ['caida'], publishedByUid: 'prev1',
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.assignments.map((a: { workerUid: string }) => a.workerUid)).toEqual(['w1', 'w3']);
  });
});

describe('GET status', () => {
  it('reads chain nodes + returns the PDCA reducer output', async () => {
    H.db!._seed('tenants/t1/zettelkasten_nodes/n1', {
      type: 'incident-reported', metadata: { incidentId: 'inc1' }, createdAt: '2026-05-01',
    });
    H.db!._seed('tenants/t1/zettelkasten_nodes/n2', {
      type: 'lesson-published', metadata: { incidentId: 'inc1' }, createdAt: '2026-05-03',
    });
    H.db!._seed('tenants/t1/zettelkasten_nodes/other', {
      type: 'incident-reported', metadata: { incidentId: 'OTHER' }, createdAt: '2026-05-01',
    });
    const res = await request(buildApp()).get('/api/sprint-k/p1/incident-flow/inc1/status').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({ phase: 'detection' });
    // only inc1's two chain nodes were passed to the reducer.
    expect(res.body.nodeCount).toBe(2);
    expect(H.pdca).toHaveBeenCalledWith('inc1', expect.arrayContaining([
      expect.objectContaining({ nodeId: 'n1', type: 'incident-reported' }),
    ]));
  });
});
