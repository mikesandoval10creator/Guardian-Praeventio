// Real-router supertest for the CPHS monthly-minute draft endpoint
// (F.7 — comité paritario, a legal requirement). Mounts the ACTUAL router
// (src/server/routes/cphsMinute.ts) and drives it through the reusable
// fakeFirestore, so this is genuine coverage of the production handler — not
// a parallel copy. Validates: auth gate, tenant resolution, the multi-source
// month-window data assembly fed to buildMonthlyMinuteDraft, and error paths.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  build: vi.fn(),
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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/correctiveActions/correctiveActionsFirestoreAdapter.js', () => ({
  CorrectiveActionsAdapter: class {
    listByStatus = vi.fn(async () => [] as unknown[]);
  },
}));
vi.mock('../../services/cphs/cphsMinuteAutogenerator.js', () => ({
  buildMonthlyMinuteDraft: (...a: unknown[]) => H.build(...a),
}));

import cphsRouter from '../../server/routes/cphsMinute.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', cphsRouter);
  return app;
}

// A date inside the "last month" window the route computes.
const now = new Date();
const lastMonthISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)).toISOString();

beforeEach(() => {
  H.build.mockReset().mockReturnValue({ period: 'draft', sections: [] });
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', companyName: 'ACME Minería', complianceScore: 85 });
});

describe('GET /api/sprint-k/:projectId/cphs/draft-minute', () => {
  it('401 without an auth token', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/cphs/draft-minute');
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/cphs/draft-minute')
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 tenant_not_found when the project has no tenantId and no member row', async () => {
    H.db!._seed('projects/p1', { companyName: 'No Tenant' }); // no tenantId
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/cphs/draft-minute')
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 + assembles month-window data into the draft (happy path)', async () => {
    H.db!._seed('cphs_committees/c1', {
      projectId: 'p1',
      status: 'active',
      members: [{ fullName: 'Ana Líder' }, { fullName: 'Beto Vocal' }],
    });
    H.db!._seed('incidents/i1', {
      projectId: 'p1',
      occurredAt: lastMonthISO,
      severity: 'alta',
      description: 'Casi-accidente en altura',
    });
    H.db!._seed('training/t1', {
      projectId: 'p1',
      status: 'completed',
      completedAt: lastMonthISO,
      title: 'Charla de 5 minutos',
      participants: ['a', 'b', 'c'],
    });

    const res = await request(buildApp())
      .get('/api/sprint-k/p1/cphs/draft-minute')
      .set('x-test-uid', 'u1');

    expect(res.status).toBe(200);
    expect(res.body.draft).toBeTruthy();
    expect(H.build).toHaveBeenCalledTimes(1);
    const input = H.build.mock.calls[0]![0] as {
      companyName: string;
      expectedAttendees: string[];
      incidents: unknown[];
      trainingsCompleted: { title: string; participantsCount: number }[];
      complianceTrafficLightScore: number;
    };
    expect(input.companyName).toBe('ACME Minería');
    expect(input.expectedAttendees).toEqual(['Ana Líder', 'Beto Vocal']);
    expect(input.incidents).toHaveLength(1);
    expect(input.trainingsCompleted[0]).toMatchObject({ title: 'Charla de 5 minutos', participantsCount: 3 });
    expect(input.complianceTrafficLightScore).toBe(85);
  });

  it('excludes incidents outside the month window', async () => {
    H.db!._seed('incidents/old', {
      projectId: 'p1',
      occurredAt: '2020-01-01T00:00:00.000Z',
      severity: 'baja',
      description: 'viejo',
    });
    await request(buildApp()).get('/api/sprint-k/p1/cphs/draft-minute').set('x-test-uid', 'u1');
    const input = H.build.mock.calls[0]![0] as { incidents: unknown[] };
    expect(input.incidents).toHaveLength(0);
  });

  it('500 when the draft builder throws', async () => {
    H.build.mockImplementation(() => {
      throw new Error('builder boom');
    });
    const res = await request(buildApp())
      .get('/api/sprint-k/p1/cphs/draft-minute')
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
