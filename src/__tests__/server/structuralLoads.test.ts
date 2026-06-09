// Real-router supertest for src/server/routes/structuralLoads.ts.
//
// Mounts the ACTUAL structuralLoadsRouter on a real express app (mirrors
// residualRisk.test.ts). Mocks only firebase-admin (fakeFirestore), verifyAuth,
// logger, captureRouteError, and externalClimate (to inject a REAL-shaped
// Open-Meteo HOURLY forecast without a network call — the route's own probe
// math + cadence logic run for real).
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
      admin: req.header('x-test-admin') === 'true',
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

// Inject a REAL-shaped Open-Meteo HOURLY forecast (no network). The route's
// probe math + cadence run for real against these hourly wind values.
const climate = vi.hoisted(() => ({ forecast: null as unknown }));
vi.mock('../../services/b2d/externalClimate.js', () => ({
  fetchOpenMeteoHourlyWind: vi.fn(async () => climate.forecast),
}));

import structuralLoadsRouter from '../../server/routes/structuralLoads.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', structuralLoadsRouter);
  return app;
}

const PID = 'p-sl-test';
const TID = 'tenant-sl';
const UID = 'uid-sl-member';

function seedProject(db: NonNullable<typeof H.db>, coords = true) {
  db._seed(`projects/${PID}`, {
    name: 'SL Project',
    tenantId: TID,
    members: [UID],
    createdBy: UID,
    ...(coords ? { latitude: -33.45, longitude: -70.66 } : {}),
  });
}
const colPath = `tenants/${TID}/projects/${PID}/structural_loads`;
const body = {
  id: 'wall-1',
  label: 'Fachada barlovento',
  areaM2: 20,
  pressureCoefficient: 0.8,
  maxForceN: 5000,
  reference: 'NCh 432 Of.71',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
  // Hourly wind (km/h) at +1h, +2h, +3h. 110 km/h on 20 m² @ Cp 0.8 crosses
  // the 5 kN limit.
  climate.forecast = {
    data: { time: ['2026-06-08T10:00', '2026-06-08T11:00', '2026-06-08T12:00'], windKmh: [30, 70, 110] },
    source: 'openmeteo',
  };
});

describe('POST /:projectId/structural-loads', () => {
  const url = `/api/sprint-k/${PID}/structural-loads`;
  it('401 without token', async () => {
    expect((await request(buildApp()).post(url).send(body)).status).toBe(401);
  });
  it('403 for non-member', async () => {
    const res = await request(buildApp()).post(url).set('x-test-uid', 'stranger').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
  it('400 on invalid payload (areaM2 <= 0)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', UID)
      .send({ ...body, areaM2: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
  it('400 on invalid payload (maxForceN missing)', async () => {
    const { maxForceN: _omit, ...noLimit } = body;
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(noLimit);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
  it('201 persists the record with createdBy == caller', async () => {
    const res = await request(buildApp()).post(url).set('x-test-uid', UID).send(body);
    expect(res.status).toBe(201);
    expect(res.body.record.createdBy).toBe(UID);
    const stored = H.db!._dump()[`${colPath}/wall-1`];
    expect(stored).toBeDefined();
    expect(stored.areaM2).toBe(20);
    expect(stored.maxForceN).toBe(5000);
  });
  it('201 writes an audit_logs entry (compliance trail)', async () => {
    await request(buildApp()).post(url).set('x-test-uid', UID).send(body);
    const dump = H.db!._dump();
    const auditWritten = Object.entries(dump).some(
      ([path, d]) =>
        path.startsWith('audit_logs/') && (d as { action?: string }).action === 'structuralLoads.create',
    );
    expect(auditWritten).toBe(true);
  });
});

describe('GET /:projectId/structural-loads', () => {
  const url = `/api/sprint-k/${PID}/structural-loads`;
  it('401 without token', async () => {
    expect((await request(buildApp()).get(url)).status).toBe(401);
  });
  it('403 for non-member', async () => {
    const res = await request(buildApp()).get(url).set('x-test-uid', 'stranger');
    expect(res.status).toBe(403);
  });
  it('200 lists stored records', async () => {
    H.db!._seed(`${colPath}/wall-1`, {
      ...body,
      createdAt: '2026-06-08T00:00:00Z',
      createdBy: UID,
    });
    const res = await request(buildApp()).get(url).set('x-test-uid', UID);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].id).toBe('wall-1');
  });
});

describe('GET /:projectId/structural-loads/build-probes', () => {
  const url = `/api/sprint-k/${PID}/structural-loads/build-probes`;
  it('401 without token', async () => {
    expect((await request(buildApp()).get(url)).status).toBe(401);
  });
  it('403 for non-member', async () => {
    const res = await request(buildApp()).get(url).set('x-test-uid', 'stranger');
    expect(res.status).toBe(403);
  });
  it('200 probes:[] when no inputs captured (honest, no fabricated probe)', async () => {
    const res = await request(buildApp()).get(url).set('x-test-uid', UID);
    expect(res.status).toBe(200);
    expect(res.body.probes).toEqual([]);
    expect(res.body.window).toBeNull();
  });
  it('200 returns a REAL probe from stored inputs × Open-Meteo HOURLY wind, with cadence window', async () => {
    H.db!._seed(`${colPath}/wall-1`, {
      ...body,
      createdAt: '2026-06-08T00:00:00Z',
      createdBy: UID,
    });
    const res = await request(buildApp()).get(url).set('x-test-uid', UID);
    expect(res.status).toBe(200);
    expect(res.body.probes).toHaveLength(1);
    const p = res.body.probes[0];
    expect(p.id).toBe('structural-wind');
    expect(p.threshold).toBe(5000);
    // 110 km/h on 20 m² @ Cp 0.8 → forecast force crosses the 5 kN limit.
    expect(Math.max(...p.forecastValues)).toBeGreaterThan(p.threshold);
    expect(res.body.wind.source).toBe('openmeteo');
    expect(res.body.wind.minutesPerStep).toBe(60);
    // The window matches the HOURLY cadence: 3 samples × 60 min = 360 min span,
    // one-step (60 min) lead time. This is what makes the scheduler fire on an
    // hourly forecast (a per-minute walk over the real minute span).
    expect(res.body.window).toEqual({ windowMinutes: 180, minLeadTimeMin: 60 });
  });
  it('200 probes:[] when the project has no coordinates (no real wind)', async () => {
    H.db = createFakeFirestore();
    seedProject(H.db, false);
    H.db._seed(`${colPath}/wall-1`, {
      ...body,
      createdAt: '2026-06-08T00:00:00Z',
      createdBy: UID,
    });
    const res = await request(buildApp()).get(url).set('x-test-uid', UID);
    expect(res.status).toBe(200);
    expect(res.body.probes).toEqual([]);
    expect(res.body.window).toBeNull();
  });
  it('200 probes:[] when Open-Meteo is unreachable (degrades honestly)', async () => {
    climate.forecast = null;
    H.db!._seed(`${colPath}/wall-1`, {
      ...body,
      createdAt: '2026-06-08T00:00:00Z',
      createdBy: UID,
    });
    const res = await request(buildApp()).get(url).set('x-test-uid', UID);
    expect(res.status).toBe(200);
    expect(res.body.probes).toEqual([]);
  });
});
