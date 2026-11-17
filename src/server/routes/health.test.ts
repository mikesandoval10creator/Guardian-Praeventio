// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({ listCollections: vi.fn(async () => []) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ listCollections: H.listCollections }) }));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({}) }));

import healthRouter from './health';

function buildApp() {
  const app = express();
  app.use('/api', healthRouter);
  return app;
}

describe('public GET /api/health probe', () => {
  beforeEach(() => H.listCollections.mockClear());

  it('stays unauthenticated and caps Firestore probes per source IP', async () => {
    const app = buildApp();
    let firstStatus: number | undefined;
    let firstBody: { status?: string } | undefined;
    for (let index = 0; index < 120; index += 1) {
      const response = await request(app).get('/api/health');
      if (index === 0) {
        firstStatus = response.status;
        firstBody = response.body;
      }
      expect(response.status).toBe(200);
    }

    expect(firstStatus).toBe(200);
    expect(firstBody?.status).toBe('ok');
    const limited = await request(app).get('/api/health');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('too_many_health_probes');
    expect(H.listCollections).toHaveBeenCalledTimes(120);
  });
});
