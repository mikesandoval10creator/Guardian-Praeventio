// Real-router supertest for the Aggregate Telemetry HTTP surface
// (src/server/routes/aggregateTelemetry.ts). Two GET endpoints over the pure
// engine in src/services/telemetry/{aggregator,eventCollector}.ts:
//
//   GET /:projectId/telemetry/aggregate?window=7d|30d|90d  → { feed, velocities }
//   GET /tenants/:tenantId/telemetry/rollup?window=...&projects=p1,p2 → { rollup }
//
// The router's `guard` (project endpoint) and the per-project loop (rollup
// endpoint) call the REAL `assertProjectMember` against the fakeFirestore, so
// 403 is exercised by NOT seeding the caller into the project — never by
// mocking the gate. verifyAuth + logger + observability are mocked; the
// aggregator, eventCollector and assertProjectMember all run UNMOCKED so every
// 200 asserts the real engine output (re-derived below, not copied from the
// handler).
//
// Time: events are seeded with `occurredAt` a couple of days before `now`, so
// they fall inside the 7d window regardless of the wall clock when the suite
// runs (the engine uses `new Date()` internally).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  role: 'admin' as string | undefined,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    verifyIdToken: async () => ({ uid: 'test' }),
    // Tenant-rollup is admin-only; the caller's role drives the guard.
    getUser: async (uid: string) => ({ uid, customClaims: { role: H.role } }),
  });
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
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import aggregateTelemetryRouter from '../../server/routes/aggregateTelemetry.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', aggregateTelemetryRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A timestamp ~2 days ago: inside the 7d/30d/90d windows under any wall clock.
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeEach(() => {
  H.role = 'admin'; // default: rollup tests assume an admin caller
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1 (tenant t1). p2 exists, excludes u1.
  H.db!._seed('projects/p1', { members: ['u1'], createdBy: 'owner', tenantId: 't1' });
  H.db!._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner', tenantId: 't1' });
  // A project that is a member but has NO tenantId → 404 from the guard.
  H.db!._seed('projects/p3', { members: ['u1'], createdBy: 'owner' });
});

describe('GET /:projectId/telemetry/aggregate', () => {
  const url = '/api/p1/telemetry/aggregate';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp()).get('/api/p2/telemetry/aggregate').set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp()).get('/api/ghost/telemetry/aggregate').set(uid);
    expect(res.status).toBe(403);
  });

  it('404 when the project has no tenantId', async () => {
    const res = await request(buildApp()).get('/api/p3/telemetry/aggregate').set(uid);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 empty feed when no operational events exist', async () => {
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.feed.projectId).toBe('p1');
    expect(res.body.feed.tenantId).toBe('t1');
    expect(res.body.feed.window).toBe('7d');
    expect(res.body.feed.totalEvents).toBe(0);
    expect(res.body.feed.countByKind).toEqual({});
    expect(res.body.feed.countBySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
    expect(res.body.velocities).toEqual([]);
  });

  it('200 aggregates real seeded events and re-derives velocities', async () => {
    // 2 incidents (top-level, scoped by projectId) — one high, one critical.
    H.db!._seed('incidents/i1', {
      projectId: 'p1',
      occurredAt: isoDaysAgo(2),
      severity: 'high',
    });
    H.db!._seed('incidents/i2', {
      projectId: 'p1',
      occurredAt: isoDaysAgo(1),
      severity: 'critica', // Spanish form → normalizes to 'critical'
    });
    // Incident for a DIFFERENT project → must be excluded by the projectId where().
    H.db!._seed('incidents/i3', {
      projectId: 'other',
      occurredAt: isoDaysAgo(1),
      severity: 'high',
    });
    // 1 inspection (tenant-scoped subcollection) within window.
    H.db!._seed('tenants/t1/projects/p1/inspections/insp1', {
      completedAt: isoDaysAgo(3),
    });
    // An incident OUTSIDE the 7d window → excluded.
    H.db!._seed('incidents/old1', {
      projectId: 'p1',
      occurredAt: isoDaysAgo(40),
      severity: 'low',
    });

    const res = await request(buildApp()).get(`${url}?window=7d`).set(uid);
    expect(res.status).toBe(200);

    // Re-derive the engine output (NOT copied from the handler):
    //   incidents i1 (high) + i2 (critical) → incident_recorded: 2
    //   inspection insp1 → inspection_done: 1
    //   i3 (other project) + old1 (out of window) excluded.
    expect(res.body.feed.totalEvents).toBe(3);
    expect(res.body.feed.countByKind).toEqual({
      incident_recorded: 2,
      inspection_done: 1,
    });
    expect(res.body.feed.countBySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 1,
      critical: 1,
    });

    // computeVelocities: perDay = round(count / 7 * 100) / 100, sorted by count desc.
    const byKind: Record<string, { count: number; perDay: number }> = {};
    for (const v of res.body.velocities) byKind[v.kind] = v;
    expect(byKind.incident_recorded).toEqual({
      kind: 'incident_recorded',
      count: 2,
      perDay: Math.round((2 / 7) * 100) / 100, // 0.29
    });
    expect(byKind.inspection_done).toEqual({
      kind: 'inspection_done',
      count: 1,
      perDay: Math.round((1 / 7) * 100) / 100, // 0.14
    });
    // Sorted: the higher count first.
    expect(res.body.velocities[0].kind).toBe('incident_recorded');
  });

  it('200 with an invalid window falls back to the 7d default', async () => {
    const res = await request(buildApp()).get(`${url}?window=bogus`).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.feed.window).toBe('7d');
  });

  it('200 respects an explicit 90d window', async () => {
    // An event 40 days back is inside 90d but was outside 7d.
    H.db!._seed('incidents/i90', {
      projectId: 'p1',
      occurredAt: isoDaysAgo(40),
      severity: 'medium',
    });
    const res = await request(buildApp()).get(`${url}?window=90d`).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.feed.window).toBe('90d');
    expect(res.body.feed.totalEvents).toBe(1);
    expect(res.body.feed.countByKind).toEqual({ incident_recorded: 1 });
    expect(res.body.feed.countBySeverity.medium).toBe(1);
  });
});

describe('GET /tenants/:tenantId/telemetry/rollup', () => {
  const url = '/api/tenants/t1/telemetry/rollup';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(`${url}?projects=p1`);
    expect(res.status).toBe(401);
  });

  it('400 when the projects query is missing', async () => {
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('projects_query_required');
  });

  it('400 when the projects query is empty / only commas', async () => {
    const res = await request(buildApp()).get(`${url}?projects=,,`).set(uid);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('projects_query_required');
  });

  it('403 when caller is not a member of one of the requested projects', async () => {
    // u1 is a member of p1 but NOT p2 → the loop denies on p2.
    const res = await request(buildApp())
      .get(`${url}?projects=p1,p2`)
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(res.body.projectId).toBe('p2');
  });

  it('403 admin-only: a non-admin member cannot roll up the tenant', async () => {
    H.role = 'supervisor'; // member of p1 but not an admin
    const res = await request(buildApp())
      .get(`${url}?projects=p1`)
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_admin_only');
  });

  it('403 SECURITY: an admin cannot roll up own projects under an arbitrary tenant', async () => {
    // p1 really belongs to tenant t1; the caller requests tenant t99 with their
    // own project p1. Membership passes, but the project is not owned by t99.
    const res = await request(buildApp())
      .get('/api/tenants/t99/telemetry/rollup?projects=p1')
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_project_mismatch');
    expect(res.body.projectId).toBe('p1');
  });

  it('200 rolls up multiple member projects and re-derives the totals', async () => {
    // u1 is also a member of p1b under tenant t1.
    H.db!._seed('projects/p1b', { members: ['u1'], createdBy: 'owner', tenantId: 't1' });

    // p1: 2 incidents (1 high) + 1 inspection within window.
    H.db!._seed('incidents/a1', { projectId: 'p1', occurredAt: isoDaysAgo(1), severity: 'high' });
    H.db!._seed('incidents/a2', { projectId: 'p1', occurredAt: isoDaysAgo(2) });
    H.db!._seed('tenants/t1/projects/p1/inspections/insp1', { completedAt: isoDaysAgo(3) });
    // p1b: 1 incident (critical).
    H.db!._seed('incidents/b1', { projectId: 'p1b', occurredAt: isoDaysAgo(1), severity: 'critical' });

    const res = await request(buildApp())
      .get(`${url}?projects=p1,p1b&window=7d`)
      .set(uid);
    expect(res.status).toBe(200);

    // Re-derive rollupTenant output:
    //   p1 feed: incident_recorded 2, inspection_done 1 (total 3); sev high:1
    //   p1b feed: incident_recorded 1 (total 1); sev critical:1
    const rollup = res.body.rollup;
    expect(rollup.tenantId).toBe('t1');
    expect(rollup.window).toBe('7d');
    expect(rollup.totalProjects).toBe(2);
    expect(rollup.totalEvents).toBe(4);
    expect(rollup.countByKind).toEqual({
      incident_recorded: 3,
      inspection_done: 1,
    });
    expect(rollup.countBySeverity).toEqual({
      low: 0,
      medium: 0,
      high: 1,
      critical: 1,
    });
    // topProjects sorted by totalEvents desc: p1 (3) before p1b (1).
    expect(rollup.topProjects).toEqual([
      { projectId: 'p1', totalEvents: 3 },
      { projectId: 'p1b', totalEvents: 1 },
    ]);
  });

  it('200 returns a zeroed rollup when the member project has no events', async () => {
    const res = await request(buildApp())
      .get(`${url}?projects=p1`)
      .set(uid);
    expect(res.status).toBe(200);
    expect(res.body.rollup.tenantId).toBe('t1');
    expect(res.body.rollup.totalProjects).toBe(1);
    expect(res.body.rollup.totalEvents).toBe(0);
    expect(res.body.rollup.topProjects).toEqual([
      { projectId: 'p1', totalEvents: 0 },
    ]);
  });
});
