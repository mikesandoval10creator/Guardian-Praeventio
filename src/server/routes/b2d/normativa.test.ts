// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.9 — Normativa API integration tests.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/b2dAuth.js', () => ({
  b2dAuth: () => (req: any, _res: any, next: any) => {
    req.b2dKey = {
      id: 'k',
      customerId: 'cust-test',
      tier: 'normativa-pro',
      scopes: ['normativa.search', 'normativa.validate'],
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

import normativaRouter from './normativa.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/b2d/v1/normativa', normativaRouter);
  return app;
}

describe('Normativa API', () => {
  it('GET /search returns matching CL regulations', async () => {
    const res = await request(makeApp())
      .get('/api/b2d/v1/normativa/search?q=comit%C3%A9&country=CL');
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('CL');
    expect(res.body.count).toBeGreaterThan(0);
    // DS 54 talks about Comité Paritario.
    expect(
      res.body.results.some((r: any) => r.id === 'cl-ds-54'),
    ).toBe(true);
  });

  it('GET /search rejects invalid country', async () => {
    const res = await request(makeApp())
      .get('/api/b2d/v1/normativa/search?q=x&country=ZZ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_country');
  });

  it('GET /by-id/:id fetches a specific regulation', async () => {
    const res = await request(makeApp()).get('/api/b2d/v1/normativa/by-id/cl-ds-54');
    expect(res.status).toBe(200);
    expect(res.body.regulation.id).toBe('cl-ds-54');
    expect(res.body.country).toBe('CL');

    const miss = await request(makeApp()).get('/api/b2d/v1/normativa/by-id/zz-fake');
    expect(miss.status).toBe(404);
  });

  it('POST /validate flags compliance gaps when no mitigations are passed', async () => {
    const res = await request(makeApp())
      .post('/api/b2d/v1/normativa/validate')
      .send({
        industry: 'construction',
        country: 'CL',
        riskCategory: 'high',
        mitigations: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.compliant).toBe(false);
    expect(res.body.gaps.length).toBeGreaterThan(0);
    expect(res.body.gaps[0].suggestion).toContain('mitigaci');
  });
});
