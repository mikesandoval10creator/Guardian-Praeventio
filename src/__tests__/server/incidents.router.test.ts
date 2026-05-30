// Real-router supertest for POST /api/incidents/report — field incident
// reporting (near-miss / incident / post-mortem) with RAG indexing + positive
// XP. Mounts the ACTUAL router (src/server/routes/incidents.ts) through the
// reusable fakeFirestore; the route had no real-router coverage.
//
// The heavy lifting (storage + embedding + XP) lives in the tested
// incidentRagService.reportIncident; this file covers the ROUTE contract: auth,
// project membership, tenant resolution, the service ok/reject mapping, and the
// validation gate. express-rate-limit is mocked to a passthrough (avoids the
// MemoryStore cleanup interval in unit tests).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  report: vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('express-rate-limit', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  ipKeyGenerator: (_ip: string) => 'test-key',
}));
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: { uid: string; email: string } }).user = { uid, email: `${uid}@t.cl` };
    next();
  },
}));
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});
vi.mock('../../services/incidents/incidentRagService.js', () => ({
  reportIncident: (...a: unknown[]) => H.report(...a),
}));
vi.mock('../../services/ragService.js', () => ({ generateEmbedding: vi.fn(async () => [0.1]) }));
vi.mock('../../services/gamification/positiveXp.js', () => ({ awardXp: vi.fn(async () => undefined) }));

import incidentsRouter from '../../server/routes/incidents.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/incidents', incidentsRouter);
  return app;
}

const URL = '/api/incidents/report';
const validBody = {
  projectId: 'p1',
  incidentType: 'near_miss' as const,
  severity: 'high' as const,
  description: 'Andamio sin línea de vida en nivel 3',
};

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.report.mockReset().mockResolvedValue({
    ok: true, incidentId: 'inc1', path: 'tenants/t1/...', xpAwarded: 10, indexed: true,
  });
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['w1'] });
});

describe('POST /api/incidents/report (real router)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 on an invalid severity (Zod enum)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send({ ...validBody, severity: 'apocalyptic' });
    expect(res.status).toBe(400);
  });

  it('403 when the caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('not a member'));
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'stranger').send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 project_missing_tenant when the project has no tenantId', async () => {
    H.db!._seed('projects/p1', { members: ['w1'] }); // no tenantId
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'w1').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('project_missing_tenant');
  });

  it('200 on a valid report — returns the service result', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'w1').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.incidentId).toBe('inc1');
    expect(res.body.xpAwarded).toBe(10);
    expect(res.body.indexed).toBe(true);
    // the service was called with the resolved tenant + caller uid
    expect(H.report).toHaveBeenCalledTimes(1);
    const [uidArg, inputArg] = H.report.mock.calls[0] as [string, Record<string, unknown>];
    expect(uidArg).toBe('w1');
    expect(inputArg.tenantId).toBe('t1');
    expect(inputArg.projectId).toBe('p1');
  });

  it('400 when the service rejects the report (result.ok = false)', async () => {
    H.report.mockResolvedValue({ ok: false, reason: 'duplicate_incident' });
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'w1').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('duplicate_incident');
  });
});
