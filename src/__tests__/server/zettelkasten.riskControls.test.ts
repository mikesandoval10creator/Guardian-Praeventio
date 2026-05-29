// Real-router supertest for POST /api/zettelkasten/risk-control-suggestions
// (Sprint 39 Fase B.8 wire, 2026-05-29). Mounts the ACTUAL zettelkasten
// router (src/server/routes/zettelkasten.ts) and drives it through the
// reusable fakeFirestore — genuine coverage of the production handler, NOT a
// parallel copy (unlike the legacy zettelkasten.test.ts / nlQuery.test.ts
// which mirror the handler in test-server.ts).
//
// The endpoint exposes the previously-orphan riskOrchestrator: a pure,
// deterministic (no-LLM) mapping risk -> required EPP + training + worker
// training-gaps per DS 594/132/78 + Ley 16.744/20.949 + MINSAL. Advisory
// only: no Firestore write, never blocks.

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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
// Heavy deps pulled in by sibling routes in the same router — stub so this
// unit test never loads genai / the embedding model.
vi.mock('../../services/ragService.js', () => ({ generateEmbedding: vi.fn(async () => [0.1]) }));
vi.mock('../../services/incidents/incidentRagService.js', () => ({
  searchIncidents: vi.fn(async () => ({ results: [] })),
}));

import zettelkastenRouter from '../../server/routes/zettelkasten.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zettelkasten', zettelkastenRouter);
  return app;
}

const URL = '/api/zettelkasten/risk-control-suggestions';

interface Suggestion {
  fromNodeId: string;
  toNodeRef: { kind: string; label: string };
  type: string;
  rationale: string;
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

describe('POST /api/zettelkasten/risk-control-suggestions (real router)', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .send({ projectId: 'p1', riskType: 'altura' });
    expect(res.status).toBe(401);
  });

  it('400 when riskType is missing (Zod)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', riskType: 'altura' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('matched rule (trabajo en altura) -> EPP + training requires, with rationale', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', riskType: 'Trabajo en altura sobre andamio' });
    expect(res.status).toBe(200);
    expect(res.body.advisory).toBe(true);
    const s = res.body.suggestions as Suggestion[];
    const eppLabels = s.filter((x) => x.toNodeRef.kind === 'EPP').map((x) => x.toNodeRef.label);
    expect(eppLabels).toContain('Arnés seguridad');
    const trainings = s
      .filter((x) => x.toNodeRef.kind === 'TRAINING')
      .map((x) => x.toNodeRef.label);
    expect(trainings).toContain('trabajo_altura_r1');
    // Explicabilidad: cada sugerencia trae rationale no vacío.
    expect(s.every((x) => typeof x.rationale === 'string' && x.rationale.length > 0)).toBe(true);
  });

  it('unmatched risk -> industry/default EPP fallback, no training suggestions', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({ projectId: 'p1', riskType: 'riesgo generico sin patron conocido xyz' });
    expect(res.status).toBe(200);
    const s = res.body.suggestions as Suggestion[];
    expect(s.length).toBeGreaterThan(0);
    // El fallback solo entrega EPP (requires), nunca trainings.
    expect(s.every((x) => x.toNodeRef.kind === 'EPP' && x.type === 'requires')).toBe(true);
  });

  it('assigned worker missing the required training -> assigned_to gap suggestion', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({
        projectId: 'p1',
        riskType: 'trabajo en altura',
        assignedWorkers: [{ uid: 'w1', activeTrainings: [] }],
      });
    expect(res.status).toBe(200);
    const s = res.body.suggestions as Suggestion[];
    const gap = s.find((x) => x.type === 'assigned_to' && x.fromNodeId === 'w1');
    expect(gap).toBeTruthy();
    expect(gap?.toNodeRef.label).toBe('trabajo_altura_r1');
  });

  it('worker WITH the training -> no gap suggestion for them', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'u1')
      .send({
        projectId: 'p1',
        riskType: 'trabajo en altura',
        assignedWorkers: [{ uid: 'w2', activeTrainings: ['trabajo_altura_r1', 'rescate_altura_basico'] }],
      });
    expect(res.status).toBe(200);
    const s = res.body.suggestions as Suggestion[];
    expect(s.some((x) => x.type === 'assigned_to' && x.fromNodeId === 'w2')).toBe(false);
  });
});
