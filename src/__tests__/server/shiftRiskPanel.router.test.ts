// Real-router supertest for the Shift Risk Panel (Pre-Turno) HTTP surface
// (src/server/routes/shiftRiskPanel.ts). One stateless POST endpoint over the
// pure engine in src/services/shiftRiskPanel/preShiftRiskComposer.ts:
//
//   POST /:projectId/shift-risk-panel/compose → { report }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the composer engine runs UNMOCKED so every 200 asserts the real deterministic
// score/factors/recommendations rather than reimplementing the composer.
//
// The expected scores below are re-derived from the engine's published weight
// tables (FATIGUE/SEVERITY/SHIFT_BASE + per-factor literals), not copied from
// the handler — each assertion pins what the real composer must produce for the
// given inputs.

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

import shiftRiskPanelRouter from '../../server/routes/shiftRiskPanel.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  composeShiftRiskPanel,
  type ShiftRiskInputs,
} from '../../services/shiftRiskPanel/preShiftRiskComposer.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', shiftRiskPanelRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A fully benign day-shift payload: no adverse factor crosses any threshold, so
// the engine produces score 0 / green / no factors.
function benignBody() {
  return {
    shift: 'day' as const,
    date: '2026-06-20',
    weather: {
      rainProbability: 0.1,
      windSpeedMs: 3,
      uvIndex: 4,
      temperatureC: 20,
      visibilityKm: 10,
    },
    workers: [
      { uid: 'w1', fullName: 'Ana Veterana', fatigueRisk: 'low' as const, daysSinceHire: 900 },
    ],
    plannedTasks: [{ id: 't1', category: 'inspection', isCriticalTask: false }],
    equipment: [{ id: 'e1', code: 'EXC-01', overdueMaintenance: false }],
    recentIncidents: [],
    activePermitsCount: 2,
    emergencyBrigadeReady: true,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/shift-risk-panel/compose', () => {
  const url = '/api/p1/shift-risk-panel/compose';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(benignBody());
    expect(res.status).toBe(401);
  });

  it('200 returns the real green report for a benign day shift', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(benignBody());
    expect(res.status).toBe(200);
    // projectId is stamped from the URL param, not the body.
    expect(res.body.report.projectId).toBe('p1');
    expect(res.body.report.shift).toBe('day');
    expect(res.body.report.date).toBe('2026-06-20');
    // No factor crosses a threshold → score 0, green, nothing to recommend.
    expect(res.body.report.riskScore).toBe(0);
    expect(res.body.report.level).toBe('green');
    expect(res.body.report.factors).toEqual([]);
    expect(res.body.report.topRecommendations).toEqual([]);
    expect(res.body.report.recommendDelayShiftStart).toBe(false);
  });

  it('200 output matches the real composer for a high-risk night shift', async () => {
    // Build a payload that trips many factors, then re-derive the expected
    // report by running the REAL engine on the same logical inputs. The route
    // must return byte-identical output (projectId comes from the URL).
    const body = {
      shift: 'night' as const, // SHIFT_BASE night = +12
      date: '2026-06-20',
      weather: {
        rainProbability: 0.9, // rain >0.7 → +10
        windSpeedMs: 15, // wind >11 → +15
        uvIndex: 12, // uv >=11 → +8 (night UV is academic but engine still scores it)
        temperatureC: 35, // heat >=32 → +10
        visibilityKm: 0.5, // visibility <1 → +12
        lightningRiskWithinHours: 2, // <=3 → +25
      },
      workers: [
        { uid: 'w1', fullName: 'Boris Cansado', fatigueRisk: 'critical' as const, daysSinceHire: 3 },
        { uid: 'w2', fullName: 'Carla Novata', fatigueRisk: 'high' as const, daysSinceHire: 5 },
      ],
      plannedTasks: [
        { id: 't1', category: 'confined-space', isCriticalTask: true, requiresPermit: true },
        { id: 't2', category: 'hot-work', isCriticalTask: true },
      ],
      equipment: [{ id: 'e1', code: 'GRU-09', overdueMaintenance: true }],
      recentIncidents: [
        { id: 'i1', severity: 'critical' as const, occurredAt: '2026-06-18T10:00:00Z' },
        { id: 'i2', severity: 'high' as const, occurredAt: '2026-06-19T10:00:00Z' },
      ],
      activePermitsCount: 1,
      emergencyBrigadeReady: false, // not ready → +15
    };

    const expected = composeShiftRiskPanel({ ...body, projectId: 'p1' } as ShiftRiskInputs);
    // Sanity-anchor the re-derivation: this payload is engineered past the
    // delay threshold so the test fails loudly if the engine's score model drifts.
    expect(expected.riskScore).toBe(100);
    expect(expected.level).toBe('red');
    expect(expected.recommendDelayShiftStart).toBe(true);

    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.report).toEqual(expected);
    // The factor for the night base must carry through (proves shift weighting,
    // not just a saturated clamp).
    expect(res.body.report.factors.map((f: { id: string }) => f.id)).toContain('shift-base');
  });

  it('200 stamps projectId from the URL, ignoring any body-supplied projectId', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      // projectId is not part of the schema; even if a client smuggles one it
      // must be stripped by Zod and overridden by the URL param.
      .send({ ...benignBody(), projectId: 'attacker-controlled' });
    expect(res.status).toBe(200);
    expect(res.body.report.projectId).toBe('p1');
  });

  it('400 on invalid body (missing required fields)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ shift: 'day' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on out-of-range weather (rainProbability > 1)', async () => {
    const body = benignBody();
    body.weather.rainProbability = 5; // schema: max(1)
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on an unknown shift enum value', async () => {
    const body = { ...benignBody(), shift: 'graveyard' };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/shift-risk-panel/compose')
      .set(uid)
      .send(benignBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/shift-risk-panel/compose')
      .set(uid)
      .send(benignBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('validation runs before the membership gate (400 even for a non-member project)', async () => {
    // Defense-in-depth: a malformed body to a project the caller cannot access
    // should fail validation (400) rather than leak the 403 membership signal,
    // because `validate` is mounted before the in-handler `guard`.
    const res = await request(buildApp())
      .post('/api/p2/shift-risk-panel/compose')
      .set(uid)
      .send({ shift: 'day' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});
