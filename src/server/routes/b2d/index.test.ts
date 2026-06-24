// Real-router smoke gate for src/server/routes/b2d/index.ts
//
// The B2D parent router adds JSON parsing + free-tier rate limiting before
// delegating to climate/hazmat/normativa/suite sub-routers (each tested
// individually). This test covers the index wiring only: unknown paths are
// 404, and the router mounts at the expected prefix.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../server/middleware/limiters.js', () => ({
  b2dFreeLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Sub-routers each hit Firestore/external APIs — mock them to isolate the index.
vi.mock('./climate.js', () => ({ default: express.Router().get('/ping', (_r, res) => res.json({ ok: true })) }));
vi.mock('./hazmat.js', () => ({ default: express.Router().get('/ping', (_r, res) => res.json({ ok: true })) }));
vi.mock('./normativa.js', () => ({ default: express.Router().get('/ping', (_r, res) => res.json({ ok: true })) }));
vi.mock('./suite.js', () => ({ default: express.Router().get('/ping', (_r, res) => res.json({ ok: true })) }));

import b2dRouter from './index.js';

describe('B2D index router (smoke gate)', () => {
  const app = express();
  app.use('/api/b2d/v1', b2dRouter);

  it('routes /climate/ping to the climate sub-router', async () => {
    const res = await request(app).get('/api/b2d/v1/climate/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 for an unknown B2D sub-path', async () => {
    const res = await request(app).get('/api/b2d/v1/nonexistent-endpoint');
    expect(res.status).toBe(404);
  });
});
