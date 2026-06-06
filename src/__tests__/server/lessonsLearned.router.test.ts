// Real-router supertest for src/server/routes/lessonsLearned.ts (B4).
//
// Security contract: a new lesson's `adoptionCount` is server-owned and always
// starts at 0. Previously the create endpoint accepted `adoptionCount` from the
// request body and saved it verbatim, so any member could inflate a lesson's
// adoption count to game the `listTopAdopted` ranking. This pins that the saved
// lesson is forced to 0 regardless of what the body sends.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  saveMock: vi.fn(async (..._args: unknown[]) => {}),
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
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../server/middleware/auditLog.js', () => ({ auditServerEvent: vi.fn(async () => true) }));
vi.mock('../../services/lessonsLearned/lessonsFirestoreAdapter.js', () => ({
  LessonsAdapter: class {
    save(...args: unknown[]) { return H.saveMock(...args); }
    listTopAdopted() { return Promise.resolve([]); }
    listByScope() { return Promise.resolve([]); }
    listByRiskCategory() { return Promise.resolve([]); }
  },
}));

import lessonsRouter from '../../server/routes/lessonsLearned.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PID = 'proj-lessons';
const CALLER = 'u-author';
const URL = `/api/sprint-k/${PID}/lessons`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', lessonsRouter);
  return app;
}
const as = (uid: string) => ({ 'x-test-uid': uid });

const validLesson = {
  id: 'lesson-1',
  summary: 'Usar arnés en altura',
  preventiveAction: 'Inspeccionar arnés antes de cada uso',
  riskCategories: ['caida_altura'],
  tags: ['epp'],
  scope: 'project' as const,
  publishedAt: '2026-06-06T00:00:00Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.saveMock.mockClear();
  H.db._seed(`projects/${PID}`, { createdBy: CALLER, members: [CALLER], tenantId: 't1' });
});

describe('POST /:projectId/lessons — adoptionCount is server-owned (B4)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(validLesson);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the project', async () => {
    const res = await request(buildApp()).post(URL).set(as('outsider')).send(validLesson);
    expect(res.status).toBe(403);
    expect(H.saveMock).not.toHaveBeenCalled();
  });

  it('201 saves the lesson with adoptionCount forced to 0, ignoring a forged body value', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(as(CALLER))
      // Attacker tries to seed the lesson with a huge adoption count.
      .send({ ...validLesson, adoptionCount: 99999 });
    expect(res.status).toBe(201);
    expect(H.saveMock).toHaveBeenCalledTimes(1);
    const saved = H.saveMock.mock.calls[0][0] as { adoptionCount: number; id: string };
    expect(saved.id).toBe('lesson-1');
    expect(saved.adoptionCount).toBe(0); // NOT 99999
  });

  it('201 also forces 0 when the body omits adoptionCount entirely', async () => {
    const res = await request(buildApp()).post(URL).set(as(CALLER)).send(validLesson);
    expect(res.status).toBe(201);
    const saved = H.saveMock.mock.calls[0][0] as { adoptionCount: number };
    expect(saved.adoptionCount).toBe(0);
  });
});
