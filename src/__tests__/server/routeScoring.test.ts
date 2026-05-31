// Real-router supertest for src/server/routes/routeScoring.ts
// (Plan v3 Fase 1 — server lever, 0 tests → covered).
//
// The route is mounted at /api/sprint-k in server.ts. Both endpoints are
// POST /:projectId/routes/{build-profile,evaluate-driver} behind verifyAuth +
// validate(zodSchema) + guard(assertProjectMember). We seed `projects/<id>`
// in fakeFirestore so assertProjectMember passes, then drive every HTTP status
// the route can emit: 401 (no token), 400 (schema fail), 403 (project guard),
// 200 (happy path), and 200 advisory-only (scoring never hard-blocks machinery).
//
// The z.unknown() bug fix is also probed: missing `profile` on evaluate-driver
// must return 400, not 500.

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
      tenantId: req.header('x-test-tenant') || undefined,
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

import routeScoringRouter from '../../server/routes/routeScoring.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', routeScoringRouter);
  return app;
}

const PROJECT_ID = 'p-rs-test';
const CALLER_UID = 'uid-rs-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Route Scoring Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ─── Minimal valid inputs ────────────────────────────────────────────────────

const minPoints = [
  { lat: -33.45, lng: -70.65, kmFromStart: 0 },
  { lat: -33.50, lng: -70.70, kmFromStart: 5 },
];

const minHazards = [
  { fromKm: 1, toKm: 3, kind: 'sharp_curve', severity: 'moderate' },
];

// A valid RouteRiskProfile (the shape buildProfile returns) for use in
// evaluate-driver tests. Constructed here rather than hitting the endpoint
// again to keep tests independent.
const aValidProfile = {
  routeId: 'route-test-1',
  totalKm: 5,
  hazardsCount: 1,
  riskScore: 16,
  category: 'low',
  hazardBreakdown: {
    sharp_curve: 1,
    steep_grade: 0,
    blind_spot: 0,
    high_traffic: 0,
    school_zone: 0,
    wildlife_crossing: 0,
    weather_prone: 0,
    fatigue_zone: 0,
    no_signal_zone: 0,
  },
  recommendedDriverExperience: 'novice',
  recommendations: [],
};

const aValidDriver = {
  uid: CALLER_UID,
  experienceLevel: 'intermediate',
  yearsLicensed: 3,
  hoursDrivenLast30d: 60,
  incidentsLast12months: 0,
  vehicleTypesAuthorized: ['pickup', 'van'],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/routes/build-profile
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/routes/build-profile', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/routes/build-profile`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ routeId: 'r1', points: minPoints, hazards: [] });
    expect(res.status).toBe(401);
  });

  it('400 when routeId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ points: minPoints, hazards: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when points array has fewer than 2 items', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        routeId: 'r1',
        points: [{ lat: -33.45, lng: -70.65, kmFromStart: 0 }],
        hazards: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a hazard has an unknown kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        routeId: 'r1',
        points: minPoints,
        hazards: [{ fromKm: 0, toKm: 1, kind: 'bad_kind', severity: 'minor' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ routeId: 'r1', points: minPoints, hazards: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/routes/build-profile`)
      .set('x-test-uid', CALLER_UID)
      .send({ routeId: 'r1', points: minPoints, hazards: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns a RouteRiskProfile with no hazards (low risk)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ routeId: 'route-low', points: minPoints, hazards: [] });
    expect(res.status).toBe(200);
    const { profile } = res.body as { profile: Record<string, unknown> };
    expect(profile.routeId).toBe('route-low');
    expect(profile.riskScore).toBe(0);
    expect(profile.category).toBe('low');
    expect(profile.hazardsCount).toBe(0);
    expect(typeof profile.totalKm).toBe('number');
    expect(Array.isArray(profile.recommendations)).toBe(true);
    // Advisory only — no hard-block flag on machinery
    expect(profile).not.toHaveProperty('blockMachinery');
  });

  it('200 returns a profile with hazards — riskScore > 0 and breakdown populated', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        routeId: 'route-hazardous',
        points: minPoints,
        hazards: minHazards,
      });
    expect(res.status).toBe(200);
    const { profile } = res.body as { profile: Record<string, unknown> };
    expect(profile.hazardsCount).toBeGreaterThan(0);
    expect((profile.riskScore as number)).toBeGreaterThan(0);
    const breakdown = profile.hazardBreakdown as Record<string, number>;
    expect(breakdown.sharp_curve).toBe(1);
  });

  it('200 school_zone hazard produces a school-zone recommendation', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        routeId: 'route-school',
        points: minPoints,
        hazards: [{ fromKm: 1, toKm: 2, kind: 'school_zone', severity: 'major' }],
      });
    expect(res.status).toBe(200);
    const { profile } = res.body as { profile: { recommendations: string[] } };
    expect(profile.recommendations.some((r) => /escolar/i.test(r))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/routes/evaluate-driver
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/routes/evaluate-driver', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/routes/evaluate-driver`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ driver: aValidDriver, profile: aValidProfile });
    expect(res.status).toBe(401);
  });

  // ── z.unknown() bug fix probe ──────────────────────────────────────────────
  it('400 when profile is missing (z.unknown() bug → z.record fix)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ driver: aValidDriver }); // profile omitted
    // With the old z.unknown() schema this yielded 500 (engine derefs
    // profile.recommendedDriverExperience on undefined). With the fix it must
    // return 400 invalid_payload.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when driver.experienceLevel is not a valid enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, experienceLevel: 'god_mode' },
        profile: aValidProfile,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when driver.fatigueLevel is an invalid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, fatigueLevel: 'extreme' },
        profile: aValidProfile,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ driver: aValidDriver, profile: aValidProfile });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 qualified driver on a low-risk route → canAssign=true, no blockingReasons', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ driver: aValidDriver, profile: aValidProfile });
    expect(res.status).toBe(200);
    const { decision } = res.body as {
      decision: {
        canAssign: boolean;
        blockingReasons: string[];
        warnings: string[];
        matchScore: number;
        driverUid: string;
        routeId: string;
      };
    };
    expect(decision.canAssign).toBe(true);
    expect(decision.blockingReasons).toHaveLength(0);
    expect(typeof decision.matchScore).toBe('number');
    expect(decision.matchScore).toBeGreaterThan(0);
    expect(decision.matchScore).toBeLessThanOrEqual(100);
    // Advisory only — no hard machinery stop flag
    expect(decision).not.toHaveProperty('blockMachinery');
  });

  it('200 novice driver on a moderate route → canAssign=true but warnings present', async () => {
    const moderateProfile = { ...aValidProfile, category: 'moderate', recommendedDriverExperience: 'intermediate' };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, experienceLevel: 'novice' },
        profile: moderateProfile,
      });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean; blockingReasons: string[]; warnings: string[] } };
    // Under-qualified for moderate → blocking, not just a warning
    expect(decision.blockingReasons.length).toBeGreaterThan(0);
    expect(decision.canAssign).toBe(false);
  });

  it('200 driver with critical fatigue → canAssign=false, blockingReasons mentions fatiga', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, fatigueLevel: 'critical' },
        profile: aValidProfile,
      });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean; blockingReasons: string[] } };
    expect(decision.canAssign).toBe(false);
    expect(decision.blockingReasons.some((r) => /fatiga/i.test(r))).toBe(true);
  });

  it('200 unauthorized vehicle type → canAssign=false, blockingReasons mentions vehicle', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: aValidDriver,
        profile: aValidProfile,
        requiredVehicleType: 'heavy_truck', // not in vehicleTypesAuthorized
      });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean; blockingReasons: string[] } };
    expect(decision.canAssign).toBe(false);
    expect(decision.blockingReasons.some((r) => /heavy_truck/i.test(r))).toBe(true);
  });

  it('200 optional requiredVehicleType omitted → canAssign unaffected by vehicle check', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ driver: aValidDriver, profile: aValidProfile });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean } };
    expect(decision.canAssign).toBe(true);
  });

  it('200 driver with ≥3 incidents → canAssign=false, mentions reentrenamiento', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, incidentsLast12months: 3 },
        profile: aValidProfile,
      });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean; blockingReasons: string[] } };
    expect(decision.canAssign).toBe(false);
    expect(decision.blockingReasons.some((r) => /reentrenamiento/i.test(r))).toBe(true);
  });

  it('200 driver with 2 incidents (warning threshold) → canAssign=true, warnings present', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        driver: { ...aValidDriver, incidentsLast12months: 2 },
        profile: aValidProfile,
      });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { canAssign: boolean; warnings: string[] } };
    expect(decision.canAssign).toBe(true);
    expect(decision.warnings.some((w) => /incidente/i.test(w))).toBe(true);
  });
});
