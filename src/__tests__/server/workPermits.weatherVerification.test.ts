// Real-router supertest for the server-side weather verification on
// POST .../work-permits/validate-critical (arista clima→permisos, 2026-06-10).
//
// Before this wire, `windSpeedMps` came exclusively from the CLIENT body, so
// the DS 132 / ISO 12480 wind thresholds (11 advisory / 15 blocking m/s) were
// decorative if the requester under-declared. Now, for wind-sensitive kinds
// (izaje_critico) the handler resolves an independent server-side wind sample
// from the project's `geo:{lat,lng}` via environmentBackend.getForecast
// (OpenWeather — mocked here) and validates with
// effective = max(declared, server). Responses expose `weatherVerification`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  getForecast: vi.fn<(days: number, loc: { lat: number; lng: number }) => Promise<Array<{ windKmh?: number }>>>(),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      admin: req.header('x-test-admin') === 'true',
    };
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
vi.mock('../../services/environmentBackend.js', () => ({
  getForecast: H.getForecast,
}));

import workPermitsRouter from '../../server/routes/workPermits.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', workPermitsRouter);
  return app;
}
const URL = '/api/p1/work-permits/validate-critical';
const issuer = { 'x-test-uid': 'sup1', 'x-test-admin': 'true' };

// Compliant lift except for the wind story under test.
const cleanIzaje = {
  loadWeightKg: 1000, operatingRadiusMeters: 5, craneCapacityAtRadiusKg: 5000,
  craneOperatorUid: 'op1', craneOperatorCertified: true,
  riggerUid: 'rig1', signalerUid: 'sig1',
  exclusionZoneMarked: true, riggingInspected: true,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.getForecast.mockReset();
});

describe('validate-critical — server-side wind verification (izaje_critico)', () => {
  it('client under-declares (5 m/s) while server measures 16 m/s → BLOCKING wind issue + discrepancy', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1', geo: { lat: -33.45, lng: -70.66 } });
    H.getForecast.mockResolvedValue([{ windKmh: 57.6 }]); // 16 m/s
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'izaje_critico', data: { ...cleanIzaje, windSpeedMps: 5 } });

    expect(res.status).toBe(200);
    expect(H.getForecast).toHaveBeenCalledWith(1, { lat: -33.45, lng: -70.66 });
    // Validation ran with effective wind 16 → ISO 12480 blocking threshold.
    expect(res.body.result.hasBlockers).toBe(true);
    const codes = (res.body.result.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('WIND_TOO_HIGH');
    expect(codes).toContain('WIND_CLIENT_UNDERREPORTED'); // advisory discrepancy issue
    expect(res.body.result.hasAdvisories).toBe(true);
    expect(res.body.weatherVerification).toMatchObject({
      source: 'openweather',
      serverWindMps: 16,
      discrepancy: true,
    });
  });

  it('weather provider down → validates with the declared value + es-CL advisory note', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1', geo: { lat: -33.45, lng: -70.66 } });
    H.getForecast.mockResolvedValue([]); // getForecast degrades to [] on failure
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'izaje_critico', data: { ...cleanIzaje, windSpeedMps: 5 } });

    expect(res.status).toBe(200);
    // Declared 5 m/s < 11 → no wind issues; the rest of the lift is clean.
    expect(res.body.result.hasBlockers).toBe(false);
    expect(res.body.weatherVerification).toMatchObject({
      source: 'unavailable',
      serverWindMps: null,
      discrepancy: false,
    });
    expect(res.body.weatherVerification.note).toBe(
      'No fue posible verificar el viento de forma independiente — valor declarado por el solicitante.',
    );
  });

  it('project without geo → current behavior (no weatherVerification, no forecast call)', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1' }); // no geo
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'izaje_critico', data: { ...cleanIzaje, windSpeedMps: 5 } });

    expect(res.status).toBe(200);
    expect(res.body.result.hasBlockers).toBe(false);
    expect(res.body.weatherVerification).toBeUndefined();
    expect(H.getForecast).not.toHaveBeenCalled();
  });

  it('honest client at 12 m/s with server at 12 m/s → advisory wind issue, no discrepancy', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1', geo: { lat: -33.45, lng: -70.66 } });
    H.getForecast.mockResolvedValue([{ windKmh: 43.2 }]); // 12 m/s
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'izaje_critico', data: { ...cleanIzaje, windSpeedMps: 12 } });

    expect(res.status).toBe(200);
    const codes = (res.body.result.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('WIND_ELEVATED'); // 11 ≤ 12 < 15
    expect(codes).not.toContain('WIND_CLIENT_UNDERREPORTED');
    expect(res.body.weatherVerification).toMatchObject({
      source: 'openweather',
      serverWindMps: 12,
      discrepancy: false,
    });
  });

  it('client omits windSpeedMps entirely → server wind alone drives the validation', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1', geo: { lat: -33.45, lng: -70.66 } });
    H.getForecast.mockResolvedValue([{ windKmh: 57.6 }]); // 16 m/s
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'izaje_critico', data: { ...cleanIzaje } });

    expect(res.status).toBe(200);
    const codes = (res.body.result.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('WIND_TOO_HIGH');
    expect(codes).not.toContain('WIND_CLIENT_UNDERREPORTED'); // nothing declared → no lie
    expect(res.body.weatherVerification).toMatchObject({
      source: 'openweather',
      serverWindMps: 16,
      discrepancy: false,
    });
  });

  it('non-wind kind (loto) never triggers a forecast lookup even with geo', async () => {
    H.db!._seed('projects/p1', { tenantId: 't1', geo: { lat: -33.45, lng: -70.66 } });
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'loto', data: { identifiedSources: [], locks: [], tryoutPerformed: true } });

    expect(res.status).toBe(200);
    expect(res.body.weatherVerification).toBeUndefined();
    expect(H.getForecast).not.toHaveBeenCalled();
  });
});
