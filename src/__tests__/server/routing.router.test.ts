// Real-router supertest for the Routing engines HTTP surface
// (src/server/routes/routing.ts). Two life-safety endpoints:
//   POST /:projectId/routing/find-path-astar  → A* over a discretized grid
//   POST /:projectId/routing/assess-climate    → NASA POWER + EONET route risk
//
// What runs FOR REAL (only infra leaves are mocked):
//   • findPathAStar — the real deterministic A* engine (asserted shortest path,
//     null on unreachable, diagonal corner-cutting refusal).
//   • assessRouteClimate — the real engine: heuristics, aggregateSeries, the
//     wind/precip/frost/distance thresholds, worst-level combination AND the
//     `failedSources` degradation contract. Only the NASA POWER + EONET network
//     adapters (leaf I/O) are faked so the test is hermetic.
//   • validate(Zod) — the real schemas drive the 400 path.
//   • assertProjectMember — the REAL guard reads the seeded project doc from the
//     fake Firestore; the 403 is a genuine non-member rejection (not a seeded
//     gate field, not a mocked function).
//
// Mocked: firebase-admin (fakeFirestore), verifyAuth (token → req.user),
// captureRouteError, logger, and the two external climate adapters.
//
// Sibling pure-engine tests cover gridAStar/routeClimateAssessment directly;
// this covers the actual wired router + its guards.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  fetchAggregated: vi.fn(),
  fetchEvents: vi.fn(),
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

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Only the network leaves of the climate engine are faked — aggregateSeries +
// all threshold/combination logic in routeClimateAssessment run UNMOCKED.
vi.mock('../../services/external/nasaPower/nasaPowerAdapter.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual, // keep the real aggregateSeries the engine uses
    nasaPowerAdapter: { fetchAggregated: (...a: unknown[]) => H.fetchAggregated(...a) },
  };
});
vi.mock('../../services/external/eonet/eonetAdapter.js', () => ({
  eonetAdapter: { fetchEvents: (...a: unknown[]) => H.fetchEvents(...a) },
}));

import routingRouter from '../../server/routes/routing.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/routing', routingRouter);
  return app;
}

const PROJECT_ID = 'p1';
const MEMBER_UID = 'u1';
const OUTSIDER_UID = 'intruder9';
const asUser = (uid: string) => ({ 'x-test-uid': uid });

// Build a NASA POWER series in the shape the engine consumes (Map samples).
function series(parameter: string, values: Array<number | null>) {
  const samples = new Map<string, number | null>();
  values.forEach((v, i) => samples.set(`2026010100${i}`, v));
  return { parameter, unit: 'x', samples };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Real assertProjectMember reads this doc: u1 is a member, intruder9 is not.
  H.db._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: MEMBER_UID });
  // Default climate adapters: both respond OK with benign data.
  H.fetchAggregated.mockReset().mockResolvedValue({
    series: [series('WS10M', [1, 2]), series('PRECTOTCORR', [0, 0]), series('T2M', [12, 14])],
  });
  H.fetchEvents.mockReset().mockResolvedValue([]);
});

// ── find-path-astar ─────────────────────────────────────────────────────────

describe('POST /:projectId/routing/find-path-astar', () => {
  // A 4x1 open corridor: start (0,0) → goal (3,0). grid[y][x].
  const openGrid = { grid: [[0, 0, 0, 0]], start: { x: 0, y: 0 }, goal: { x: 3, y: 0 } };

  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .send(openGrid);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member (real assertProjectMember)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(OUTSIDER_UID))
      .send(openGrid);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('400 for an invalid body (real Zod schema — start missing)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({ grid: [[0, 0]], goal: { x: 1, y: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 rejects non-integer / negative cells (Zod cell schema)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({ grid: [[0, 0]], start: { x: -1, y: 0 }, goal: { x: 1, y: 0.5 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns the REAL shortest path through an open corridor', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send(openGrid);
    expect(res.status).toBe(200);
    // A* engine output — full ordered corridor, not a fake/truncated path.
    expect(res.body.path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('200 routes AROUND an obstacle (engine avoids grid value 1)', async () => {
    // 3x3 with a wall at (1,0)+(1,1); only path goes down then across.
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({
        grid: [
          [0, 1, 0],
          [0, 1, 0],
          [0, 0, 0],
        ],
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 0 },
      });
    expect(res.status).toBe(200);
    const path = res.body.path as Array<{ x: number; y: number }>;
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 2, y: 0 });
    // The wall column (x=1) is never stepped on at y=0 or y=1.
    expect(path.some((c) => c.x === 1 && (c.y === 0 || c.y === 1))).toBe(false);
  });

  it('200 with path: null when the goal is unreachable (honest, no fake path)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({
        // goal (2,0) fully walled off by a column of obstacles.
        grid: [
          [0, 1, 0],
          [0, 1, 0],
          [0, 1, 0],
        ],
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 0 },
      });
    expect(res.status).toBe(200);
    expect(res.body.path).toBeNull();
  });

  it('200 with allowDiagonals takes the diagonal shortcut on an open grid', async () => {
    // Octile heuristic on a fully open 3x3: start (0,0) → goal (2,2) is a
    // 2-hop diagonal run, strictly shorter than the 5-cell 4-connected path.
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({
        grid: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        start: { x: 0, y: 0 },
        goal: { x: 2, y: 2 },
        opts: { allowDiagonals: true },
      });
    expect(res.status).toBe(200);
    const path = res.body.path as Array<{ x: number; y: number }> | null;
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
    // 8-connected diagonal run = 3 cells (start + 2 hops), vs 5 for 4-connected.
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('200 refuses corner-cutting: the diagonal hop past a wall is never taken', async () => {
    // Wall at (1,0). The diagonal (0,0)->(1,1) would cut that wall's corner
    // (orthogonal neighbor (1,0) is a wall), so the engine must NOT take it as
    // the first hop — it routes orthogonally instead.
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/find-path-astar`)
      .set(asUser(MEMBER_UID))
      .send({
        grid: [
          [0, 1, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 2 },
        opts: { allowDiagonals: true },
      });
    expect(res.status).toBe(200);
    const path = res.body.path as Array<{ x: number; y: number }> | null;
    expect(path).not.toBeNull();
    // First step out of (0,0) must not be the corner-cut diagonal into (1,1).
    expect(path![1]).not.toEqual({ x: 1, y: 1 });
    // The wall at (1,0) is never stepped on.
    expect(path!.some((c) => c.x === 1 && c.y === 0)).toBe(false);
  });
});

// ── assess-climate ──────────────────────────────────────────────────────────

describe('POST /:projectId/routing/assess-climate', () => {
  const baseInput = {
    midpointLat: -33.4,
    midpointLng: -70.6,
    bbox: { minLat: -34, maxLat: -33, minLng: -71, maxLng: -70 },
    totalDistanceM: 50_000,
    totalDurationS: 3_000,
    summary: 'Ruta urbana corta',
  };

  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .send({ input: baseInput });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member (real assertProjectMember)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(OUTSIDER_UID))
      .send({ input: baseInput });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('400 for out-of-range latitude (real Zod schema)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: { ...baseInput, midpointLat: 999 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns status:safe when nothing crosses a threshold', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: baseInput });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.status).toBe('safe');
    expect(a.reasons).toEqual([]);
    expect(a.failedSources).toEqual([]);
    // metrics come from the real aggregateSeries over the seeded samples.
    expect(a.metrics.activeEventCount).toBe(0);
    expect(a.metrics.isMountainPass).toBe(false);
    expect(a.metrics.distanceKm).toBe(50);
  });

  it('200 escalates to danger from REAL wind/precip aggregation', async () => {
    H.fetchAggregated.mockResolvedValueOnce({
      series: [
        series('WS10M', [20, 22]), // max 22 m/s ≥ 15 danger threshold
        series('PRECTOTCORR', [0, 0]),
        series('T2M', [10, 12]),
      ],
    });
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: baseInput });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.status).toBe('danger');
    expect(a.reasons.some((r: { category: string; level: string }) =>
      r.category === 'wind' && r.level === 'danger')).toBe(true);
    expect(a.metrics.maxWindMs).toBe(22); // real aggregateSeries max
  });

  it('200 flags a mountain pass from the summary (real keyword heuristic)', async () => {
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: { ...baseInput, summary: 'Ruta CH-31 vía Los Libertadores' } });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.metrics.isMountainPass).toBe(true);
    expect(a.reasons.some((r: { category: string }) => r.category === 'mountain_pass')).toBe(true);
  });

  it('200 reports failedSources honestly when both adapters fail', async () => {
    H.fetchAggregated.mockRejectedValueOnce(new Error('NASA 503'));
    H.fetchEvents.mockRejectedValueOnce(new Error('EONET timeout'));
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: baseInput });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    // The degradation contract: "no podemos saber" is surfaced, not hidden.
    expect(a.failedSources.sort()).toEqual(['EONET', 'NASA_POWER']);
    expect(a.metrics.avgWindMs).toBeNull();
  });

  it('200 escalates to danger on an active EONET event in the bbox', async () => {
    H.fetchEvents.mockResolvedValueOnce([
      { id: 'EONET_1', title: 'Tormenta severa', categories: [], geometry: [] },
    ]);
    const res = await request(buildApp())
      .post(`/api/routing/${PROJECT_ID}/routing/assess-climate`)
      .set(asUser(MEMBER_UID))
      .send({ input: baseInput });
    expect(res.status).toBe(200);
    const a = res.body.assessment;
    expect(a.status).toBe('danger');
    expect(a.metrics.activeEventCount).toBe(1);
    expect(a.activeEvents).toHaveLength(1);
    expect(a.reasons.some((r: { category: string }) => r.category === 'active_event')).toBe(true);
  });
});
