// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.9 — Hazmat API integration tests.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/b2dAuth.js', () => ({
  b2dAuth: () => (req: any, _res: any, next: any) => {
    req.b2dKey = {
      id: 'k',
      customerId: 'cust-test',
      tier: 'hazmat-pro',
      scopes: ['hazmat.calculate'],
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

import hazmatRouter from './hazmat.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/b2d/v1/hazmat', hazmatRouter);
  return app;
}

describe('Hazmat API', () => {
  it('POST /pipe-pressure validates input and returns DS 43 citation', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/hazmat/pipe-pressure')
      .send({
        pipe: { id: 'P1', velocityInMs: 2, velocityOutMs: 5, heightDeltaM: 0 },
        fluid: { id: 'water', densityKgM3: 1000, vaporPressurePa: 2300 },
        pumpHead: { upstreamPressurePa: 100000 },
      });
    expect(res.status).toBe(200);
    expect(res.body.citations).toContain('DS 43/2015');
    expect(res.body.computedAt).toBeDefined();
  });

  it('POST /pipe-pressure returns 400 on invalid input', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/hazmat/pipe-pressure')
      .send({ pipe: {}, fluid: {}, pumpHead: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('POST /gas-dispersion accepts pasquill stability classes', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/hazmat/gas-dispersion')
      .send({
        leak: { id: 'L1', releaseRateKgS: 1, idlhMgM3: 50, relativeDensity: 1.5 },
        weather: { windKmh: 10, pasquillStability: 'D' },
        terrain: { id: 'T1', roughnessM: 0.5 },
      });
    expect(res.status).toBe(200);
    expect(res.body.citations).toContain('Pasquill-Gifford');
  });

  it('POST /scaffold-uplift returns NCh + DS 594 + OSHA citations', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/hazmat/scaffold-uplift')
      .send({
        scaffold: { id: 'S1', areaM2: 20, pressureCoefficient: -1.2 },
        weather: { windKmh: 80 },
        anchorage: { ratedCapacityN: 500, anchorCount: 4 },
      });
    expect(res.status).toBe(200);
    expect(res.body.citations).toEqual(
      expect.arrayContaining(['NCh 432 Of.71', 'DS 594 Art. 78']),
    );
  });

  it('POST /extinguisher-coverage returns compliance + violations', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/hazmat/extinguisher-coverage')
      .send({
        workstations: [{ id: 'W1', position: { x: 0, y: 0, z: 0 } }],
        extinguishers: [
          {
            id: 'E1',
            kind: 'extinguisher_pqs',
            position: { x: 5, y: 0, z: 0 },
            lifecycle: 'active',
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.result.compliant).toBe(true);
    expect(res.body.citations).toContain('DS 594 art. 47');
  });
});
