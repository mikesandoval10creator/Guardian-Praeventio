// Real-router supertest for F.16 worker-readiness ("torniquete virtual" —
// the NON-BLOCKING assistant that scores whether a worker is prepared for a
// task: trainings, EPP, medical aptitude, signed docs, experience). Vital
// safety logic, 289 lines, previously ~1%. Mounts the actual router via
// fakeFirestore and asserts the multi-collection profile assembly fed to the
// pure computeReadiness() engine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  compute: vi.fn(),
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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/workerReadiness/readinessScore.js', () => ({
  computeReadiness: (...a: unknown[]) => H.compute(...a),
}));

import readinessRouter from '../../server/routes/workerReadiness.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', readinessRouter);
  return app;
}
const get = (path = 'p1/worker-readiness/w1') =>
  request(buildApp()).get(`/api/sprint-k/${path}`).set('x-test-uid', 'caller');

beforeEach(() => {
  H.compute.mockReset().mockReturnValue({ score: 88, decision: 'apto', gaps: [] });
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('GET /api/sprint-k/:projectId/worker-readiness/:workerUid', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/worker-readiness/w1');
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await get();
    expect(res.status).toBe(403);
  });

  it('404 when the tenant cannot be resolved', async () => {
    H.db!._seed('projects/p1', { name: 'no-tenant' });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('404 worker_not_found when the worker doc is missing', async () => {
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('worker_not_found');
  });

  it('200 + assembles the worker profile from trainings/EPP/medical/signed docs', async () => {
    H.db!._seed('projects/p1/workers/w1', {
      medicalAptitudeStatus: 'vigente',
      signedDocuments: ['ODI'],
      odiSigned: true,
      experienceByCategory: { general: 3 },
    });
    H.db!._seed('projects/p1/training_assignments/ta1', {
      workerUid: 'w1',
      status: 'completed',
      code: 'Trabajo en altura',
    });
    H.db!._seed('projects/p1/epp_assignments/e1', { workerId: 'w1', category: 'arnés' });

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ score: 88, decision: 'apto' });
    expect(H.compute).toHaveBeenCalledTimes(1);

    const profile = H.compute.mock.calls[0]![0] as {
      activeTrainings: string[];
      activeEpp: string[];
      medicalAptitudeStatus: string;
      signedDocuments: string[];
    };
    expect(profile.activeTrainings).toContain('Trabajo en altura');
    expect(profile.activeEpp).toContain('arnés');
    expect(profile.medicalAptitudeStatus).toBe('vigente');
    expect(profile.signedDocuments).toContain('ODI');
  });

  it('excludes a training whose status is not completed (anti false-positive)', async () => {
    H.db!._seed('projects/p1/workers/w1', { medicalAptitudeStatus: 'sin_aptitud' });
    H.db!._seed('projects/p1/training_assignments/ta1', {
      workerUid: 'w1',
      status: 'scheduled', // NOT completed
      code: 'Espacios confinados',
    });
    await get();
    const profile = H.compute.mock.calls[0]![0] as { activeTrainings: string[] };
    expect(profile.activeTrainings).not.toContain('Espacios confinados');
  });

  it('derives requirements from the process-type baseline when a task is provided', async () => {
    H.db!._seed('projects/p1/workers/w1', { medicalAptitudeStatus: 'vigente' });
    H.db!._seed('tasks/tk1', { projectId: 'p1', processId: 'pr1', riskCategory: 'soldadura' });
    H.db!._seed('processes/pr1', { projectId: 'p1', type: 'soldadura' });
    await get('p1/worker-readiness/w1?taskId=tk1');
    const task = H.compute.mock.calls[0]![1] as { requiredTrainings: string[]; requiredEpp: string[] };
    // soldadura baseline injects welding trainings + EPP.
    expect(task.requiredEpp).toEqual(expect.arrayContaining(['casco']));
    expect(task.requiredTrainings.length).toBeGreaterThan(0);
  });
});
