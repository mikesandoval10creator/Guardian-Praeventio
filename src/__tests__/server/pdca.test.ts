// Real-router supertest for §195-200 PDCA + non-conformities (ISO 45001 §10.2).
// 6 endpoints. Mounted via fakeFirestore; advanceStage mocked. Covers cycle
// CRUD, the P→D→C→A advance gate, NC creation, and the summary aggregation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  advance: vi.fn(),
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
vi.mock('../../services/pdca/pdcaCycleEngine.js', () => ({
  advanceStage: (...a: unknown[]) => H.advance(...a),
}));

import pdcaRouter from '../../server/routes/pdca.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', pdcaRouter);
  return app;
}
const CYCLES = 'tenants/t1/projects/p1/pdca_cycles';
const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.advance.mockReset();
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('pdca cycles', () => {
  it('401 / 403 gates', async () => {
    expect((await request(buildApp()).get('/api/sprint-k/p1/pdca/cycles')).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).get('/api/sprint-k/p1/pdca/cycles').set(uid)).status).toBe(403);
  });

  it('POST creates a cycle in the plan stage (201)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles')
      .set(uid)
      .send({ id: 'c1', nonConformityId: 'nc1', origin: 'audit', ownerUid: 'owner1' });
    expect(res.status).toBe(201);
    expect(res.body.cycle.currentStage).toBe('plan');
    expect(res.body.cycle.stages[0].kind).toBe('plan');
    expect(H.db!._store.has(`${CYCLES}/c1`)).toBe(true);
  });

  it('GET lists existing cycles', async () => {
    H.db!._seed(`${CYCLES}/c1`, { currentStage: 'do', cycleNumber: 1 });
    const res = await request(buildApp()).get('/api/sprint-k/p1/pdca/cycles').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.cycles).toHaveLength(1);
  });

  it('advance: 404 for a missing cycle', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles/missing/advance')
      .set(uid)
      .send({ evidence: ['foto.jpg'] });
    expect(res.status).toBe(404);
  });

  it('advance: 200 when the engine advances the stage', async () => {
    H.db!._seed(`${CYCLES}/c1`, {
      id: 'c1', currentStage: 'plan', cycleNumber: 1,
      stages: [{ kind: 'plan', activityId: 'a', notes: '', ownerUid: 'o', startedAt: 'now' }],
    });
    H.advance.mockReturnValue({
      advanced: true,
      project: { id: 'c1', currentStage: 'do', cycleNumber: 1, stages: [{ kind: 'plan' }, { kind: 'do' }] },
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles/c1/advance')
      .set(uid)
      .send({ evidence: ['evidencia.pdf'] });
    expect(res.status).toBe(200);
    expect(res.body.cycle.currentStage).toBe('do');
  });

  it('advance: 200 persists the new stage atomically (txn read-modify-write, #19)', async () => {
    H.db!._seed(`${CYCLES}/c1`, {
      id: 'c1', currentStage: 'plan', cycleNumber: 1,
      stages: [{ kind: 'plan', activityId: 'a', notes: '', ownerUid: 'o', startedAt: 'now' }],
    });
    H.advance.mockReturnValue({
      advanced: true,
      project: { id: 'c1', currentStage: 'do', cycleNumber: 1, stages: [{ kind: 'plan' }, { kind: 'do' }] },
    });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles/c1/advance')
      .set(uid)
      .send({ evidence: ['e.pdf'] });
    expect(res.status).toBe(200);
    // The transaction committed the advanced stage back to Firestore.
    expect(H.db!._store.get(`${CYCLES}/c1`)?.currentStage).toBe('do');
  });

  it('advance: 400 no_entry_for_current_stage when no stage entry matches currentStage', async () => {
    H.db!._seed(`${CYCLES}/c1`, { id: 'c1', currentStage: 'plan', cycleNumber: 1, stages: [] });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles/c1/advance')
      .set(uid)
      .send({ evidence: ['x'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_entry_for_current_stage');
    expect(H.advance).not.toHaveBeenCalled();
  });

  it('advance: 400 cannot_advance when the engine refuses', async () => {
    H.db!._seed(`${CYCLES}/c1`, {
      id: 'c1', currentStage: 'plan', cycleNumber: 1,
      stages: [{ kind: 'plan', activityId: 'a', notes: '', ownerUid: 'o', startedAt: 'now' }],
    });
    H.advance.mockReturnValue({ advanced: false, reason: 'evidence_insufficient' });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/cycles/c1/advance')
      .set(uid)
      .send({ evidence: ['x'] });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('evidence_insufficient');
  });
});

describe('pdca non-conformities + summary', () => {
  it('POST creates an NC in open status (201)', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/pdca/non-conformities')
      .set(uid)
      .send({ id: 'nc1', category: 'EPP', severity: 'major', description: 'Sin arnés', location: 'Nivel 3', responsibleUid: 'r1' });
    expect(res.status).toBe(201);
    expect(res.body.nonConformity.status).toBe('open');
  });

  it('GET summary aggregates cycles by phase + closure rate', async () => {
    H.db!._seed(`${CYCLES}/c1`, { currentStage: 'plan', cycleNumber: 1, stages: [] });
    H.db!._seed(`${CYCLES}/c2`, {
      currentStage: 'act', cycleNumber: 1,
      stages: [{ kind: 'act', completedAt: '2026-01-01' }],
    });
    const res = await request(buildApp()).get('/api/sprint-k/p1/pdca/summary').set(uid);
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.byPhase.plan).toBe(1);
    expect(res.body.summary.byPhase.act).toBe(1);
    expect(res.body.summary.closedCycles).toBe(1); // c2 has a completed act
    expect(res.body.summary.closureRate).toBe(50);
  });
});
