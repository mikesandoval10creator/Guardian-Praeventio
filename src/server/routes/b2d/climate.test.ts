// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.9 — Climate API integration tests.
//
// §2.16 (Fase C.4, 2026-05-21): tras wirear Open-Meteo + USGS + OpenAQ
// reales, mockeamos `fetch` global para que el test no dependa de red
// y se ejecute determinístico. El handler cae al fallback en cada
// fuente — el shape de la response sigue estable, que es lo que estos
// tests validan.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { __resetExternalClimateCache } from '../../../services/b2d/externalClimate.js';

vi.mock('../../middleware/b2dAuth.js', () => ({
  b2dAuth: () => (req: any, _res: any, next: any) => {
    req.b2dKey = {
      id: 'k',
      customerId: 'cust-test',
      tier: 'climate-pro',
      scopes: ['climate.read', 'climate.forecast'],
      keyHash: '',
      keyPrefix: '',
      status: 'active',
      createdAt: 0,
    };
    next();
  },
}));

vi.mock('../../../services/b2d/usage.js', () => ({
  trackB2dUsage: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import climateRouter from './climate.js';

beforeEach(() => {
  // §2.16: forzar fallback en TODAS las fuentes externas para que el
  // test sea determinístico. fetch siempre rejecta → externalClimate.ts
  // catch → null → handler usa stub determinístico.
  __resetExternalClimateCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('test: external network disabled');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/b2d/v1/climate', climateRouter);
  return app;
}

describe('Climate API', () => {
  it('GET /current returns weather + seismic + air quality with citations', async () => {
    const res = await request(makeApp()).get('/api/b2d/v1/climate/current?lat=-33.45&lng=-70.66');
    expect(res.status).toBe(200);
    expect(res.body.coordinates).toEqual({ lat: -33.45, lng: -70.66 });
    expect(res.body.weather).toBeDefined();
    expect(res.body.seismic).toBeDefined();
    expect(res.body.airQuality).toBeDefined();
    expect(res.body.citations).toContain('Open-Meteo');
  });

  it('GET /current rejects invalid coords with 400', async () => {
    const res = await request(makeApp()).get('/api/b2d/v1/climate/current?lat=999&lng=foo');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_coordinates');
  });

  it('GET /forecast returns N days with min/max temps', async () => {
    const res = await request(makeApp()).get(
      '/api/b2d/v1/climate/forecast?lat=-33&lng=-70&days=3',
    );
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    expect(res.body.days[0].tempMinC).toBeLessThan(res.body.days[0].tempMaxC);
  });

  it('GET /risk-score validates industry whitelist', async () => {
    const ok = await request(makeApp()).get(
      '/api/b2d/v1/climate/risk-score?lat=-33&lng=-70&industry=mining',
    );
    expect(ok.status).toBe(200);
    expect(['low', 'medium', 'high']).toContain(ok.body.riskBand);

    const bad = await request(makeApp()).get(
      '/api/b2d/v1/climate/risk-score?lat=-33&lng=-70&industry=spacefaring',
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_industry');
  });
});
