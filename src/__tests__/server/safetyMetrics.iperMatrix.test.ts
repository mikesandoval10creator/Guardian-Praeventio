// Real-router supertest for the IPER matrix GET endpoint in
// src/server/routes/safetyMetrics.ts:
//
//   GET /:projectId/iper-assessments/matrix → 200 { nodes: RiskMatrixNode[] }
//
// Auth chain: verifyAuth → guard(assertProjectMember) → handler. The handler
// reads the REAL `iper_assessments` collection (no mock of the projection
// logic — only firebase-admin/verifyAuth/logger/captureRouteError are mocked).

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
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
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

import safetyMetricsRouter from '../../server/routes/safetyMetrics.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mounted at /api/sprint-k per server.ts.
  app.use('/api/sprint-k', safetyMetricsRouter);
  return app;
}

const PROJECT_ID = 'proj-iper';
const CALLER_UID = 'user-1';
const URL = `/api/sprint-k/${PROJECT_ID}/iper-assessments/matrix`;

function seedProject(db: ReturnType<typeof createFakeFirestore>, uid = CALLER_UID) {
  db._seed(`projects/${PROJECT_ID}`, { members: [uid], createdBy: uid });
}

/** Seed a real-shaped iper_assessments doc. */
function seedAssessment(
  db: ReturnType<typeof createFakeFirestore>,
  id: string,
  over: Record<string, unknown> = {},
) {
  db._seed(`iper_assessments/${id}`, {
    description: 'Caída de altura en andamio',
    projectId: PROJECT_ID,
    inputs: { probability: 4, severity: 5 },
    level: 'extremo',
    rawScore: 20,
    recommendation: 'Eliminar o sustituir',
    suggestedControls: [],
    computedAt: '2026-06-20T00:00:00.000Z',
    metadata: { author: CALLER_UID, signedAt: null },
    ...over,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('GET /:projectId/iper-assessments/matrix', () => {
  it('401 when no token is supplied', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: ['stranger'], createdBy: 'stranger' });
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 honest empty-state — project member, no assessments → nodes:[]', async () => {
    seedProject(H.db!);
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([]);
  });

  it('200 — projects a real assessment into a RiskMatrix node (probability×severity)', async () => {
    seedProject(H.db!);
    seedAssessment(H.db!, 'a1');
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    const node = res.body.nodes[0];
    expect(node.id).toBe('a1');
    expect(node.probability).toBe(4);
    expect(node.impact).toBe(5); // severity → impact
    expect(node.label).toBe('Caída de altura en andamio');
    expect(node.kind).toBe('risk');
  });

  it('200 — excludes assessments belonging to a different project', async () => {
    seedProject(H.db!);
    seedAssessment(H.db!, 'mine', { description: 'Mío' });
    seedAssessment(H.db!, 'other', { projectId: 'another-project', description: 'Ajeno' });
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].id).toBe('mine');
  });

  it('200 — skips malformed docs (out-of-range probability) rather than fabricating a cell', async () => {
    seedProject(H.db!);
    seedAssessment(H.db!, 'good', { inputs: { probability: 2, severity: 3 } });
    seedAssessment(H.db!, 'bad', { inputs: { probability: 9, severity: 3 } });
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].id).toBe('good');
  });

  it('200 — falls back to level as label when description is blank', async () => {
    seedProject(H.db!);
    seedAssessment(H.db!, 'a1', { description: '   ', level: 'moderado' });
    const res = await request(buildApp()).get(URL).set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.nodes[0].label).toBe('moderado');
  });
});
