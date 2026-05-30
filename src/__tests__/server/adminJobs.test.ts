// Real-router supertest for the scheduler-gated admin job endpoint
// (src/server/routes/adminJobs.ts). These routes run cron-style aggregation and
// are gated by `verifySchedulerToken` (NOT verifyAuth) — they must reject
// unauthenticated callers and translate a job failure to a clean 500. The job
// itself is mocked; this covers the HTTP contract (the route had 0 tests).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../server/middleware/verifySchedulerToken.js', () => ({
  verifySchedulerToken: (req: Request, res: Response, next: NextFunction) => {
    if (req.header('authorization') === 'Bearer ok-secret') {
      next();
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
  },
}));
vi.mock('../../server/jobs/aggregateAiFeedback.js', () => ({ aggregateAiFeedback: vi.fn() }));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import adminJobsRouter from '../../server/routes/adminJobs.js';
import { aggregateAiFeedback } from '../../server/jobs/aggregateAiFeedback.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin-jobs', adminJobsRouter);
  return app;
}

const URL = '/api/admin-jobs/aggregate-ai-feedback';

beforeEach(() => {
  vi.mocked(aggregateAiFeedback).mockReset();
});

describe('POST /admin-jobs/aggregate-ai-feedback', () => {
  it('401 without the scheduler token', async () => {
    const res = await request(buildApp()).post(URL);
    expect(res.status).toBe(401);
  });

  it('200 returns the aggregation summary when the job succeeds', async () => {
    vi.mocked(aggregateAiFeedback).mockResolvedValue({
      tenantsProcessed: 2,
      summariesWritten: 3,
      totalItems: 10,
      week: '2026-W22',
    } as never);
    const res = await request(buildApp()).post(URL).set('authorization', 'Bearer ok-secret');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.week).toBe('2026-W22');
    expect(res.body.summariesWritten).toBe(3);
    expect(typeof res.body.durationMs).toBe('number');
  });

  it('500 job_failed when the aggregation throws', async () => {
    vi.mocked(aggregateAiFeedback).mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post(URL).set('authorization', 'Bearer ok-secret');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'job_failed' });
  });
});
