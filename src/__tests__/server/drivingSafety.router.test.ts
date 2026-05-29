// Real-router supertest for §69-71 Driving Safety (critical routes + driver
// fitness). 6 endpoints. Relevant to "accidente de trayecto" + the directive
// that we RECOMMEND (canOperate/blockers) rather than block. Mounted via
// fakeFirestore; computeDriverScore mocked. (Sibling drivingSafety.test.ts
// covers the pure service; this covers the actual router.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  score: vi.fn(),
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
vi.mock('../../services/drivingSafety/drivingSafetyService.js', () => ({
  computeDriverScore: (...a: unknown[]) => H.score(...a),
}));

import drivingRouter from '../../server/routes/drivingSafety.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', drivingRouter);
  return app;
}
const ROUTES = 'tenants/t1/projects/p1/driving_routes';
const DRIVERS = 'tenants/t1/projects/p1/driving_drivers';
const uid = (u = 'u1') => ({ 'x-test-uid': u });

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.score.mockReset().mockReturnValue({ safetyScore: 70, level: 'B', canOperate: true, blockers: [] });
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('driving routes', () => {
  it('401 / 403 / 404 gates on GET routes', async () => {
    expect((await request(buildApp()).get('/api/sprint-k/p1/driving/routes')).status).toBe(401);
    vi.mocked(assertProjectMember).mockRejectedValueOnce(new ProjectMembershipError('nope'));
    expect((await request(buildApp()).get('/api/sprint-k/p1/driving/routes').set(uid())).status).toBe(403);
    H.db!._seed('projects/p1', { name: 'no-tenant' });
    expect((await request(buildApp()).get('/api/sprint-k/p1/driving/routes').set(uid())).status).toBe(404);
  });

  it('GET routes?status=critical returns only high/extreme criticality', async () => {
    H.db!._seed(`${ROUTES}/r1`, { name: 'Bajada', criticality: 'extreme', activeAlert: null });
    H.db!._seed(`${ROUTES}/r2`, { name: 'Plana', criticality: 'low', activeAlert: null });
    const res = await request(buildApp()).get('/api/sprint-k/p1/driving/routes?status=critical').set(uid());
    expect(res.status).toBe(200);
    expect(res.body.routes.map((r: { id: string }) => r.id)).toEqual(['r1']);
  });

  it('POST routes creates a route (201) and sanitizes hazards', async () => {
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/driving/routes')
      .set(uid())
      .send({ name: 'R', origin: 'A', destination: 'B', distanceKm: 12, criticality: 'high', hazards: ['cliff', 'BOGUS'] });
    expect(res.status).toBe(201);
    expect(res.body.route.hazards).toEqual(['cliff']); // BOGUS dropped
  });

  it('POST alert raises and then resolves an alert; 404 for a missing route', async () => {
    H.db!._seed(`${ROUTES}/r1`, { name: 'R', criticality: 'high', activeAlert: null, alertHistory: [] });
    const raise = await request(buildApp())
      .post('/api/sprint-k/p1/driving/routes/r1/alert')
      .set(uid())
      .send({ kind: 'icy', note: 'hielo en la curva' });
    expect(raise.status).toBe(200);
    expect(raise.body.activeAlert.kind).toBe('icy');

    const resolve = await request(buildApp())
      .post('/api/sprint-k/p1/driving/routes/r1/alert')
      .set(uid())
      .send({ kind: 'icy', resolve: true });
    expect(resolve.body.activeAlert).toBeNull();

    const missing = await request(buildApp())
      .post('/api/sprint-k/p1/driving/routes/nope/alert')
      .set(uid())
      .send({ kind: 'fog' });
    expect(missing.status).toBe(404);
  });
});

describe('drivers + ranking', () => {
  it('POST journey end accumulates hoursThisWeek and writes a journey audit', async () => {
    H.db!._seed(`${DRIVERS}/w1`, { hoursThisWeek: 5, licenseClass: 'B' });
    const res = await request(buildApp())
      .post('/api/sprint-k/p1/driving/drivers/w1/journey')
      .set(uid())
      .send({ action: 'end', journeyId: 'j1', hours: 3 });
    expect(res.status).toBe(200);
    expect(res.body.driver.hoursThisWeek).toBe(8);
    const journeyKeys = [...H.db!._store.keys()].filter((k) => k.startsWith(`${DRIVERS}/w1/journeys/`));
    expect(journeyKeys.length).toBe(1);
  });

  it('GET ranking scores drivers and sorts by safetyScore desc (recommend, not block)', async () => {
    H.db!._seed(`${DRIVERS}/low`, { licenseClass: 'B', incidents12m: 4 });
    H.db!._seed(`${DRIVERS}/high`, { licenseClass: 'A', incidents12m: 0 });
    H.score.mockImplementation((d: { workerUid: string }) =>
      d.workerUid === 'high'
        ? { safetyScore: 95, level: 'A', canOperate: true, blockers: [] }
        : { safetyScore: 40, level: 'D', canOperate: false, blockers: ['too_many_incidents'] },
    );
    const res = await request(buildApp()).get('/api/sprint-k/p1/driving/ranking').set(uid());
    expect(res.status).toBe(200);
    expect(res.body.ranking.map((r: { workerUid: string }) => r.workerUid)).toEqual(['high', 'low']);
    expect(res.body.ranking[1]).toMatchObject({ canOperate: false, blockers: ['too_many_incidents'] });
  });
});
