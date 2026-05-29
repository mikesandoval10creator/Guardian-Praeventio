// Real-router supertest for the NEWLY-WIRED POST .../work-permits/validate-critical.
// This endpoint surfaces the criticalPermitValidators (DS 132 izaje/excavación/
// LOTO) that were implemented + unit-tested but previously unreachable. Uses the
// REAL validators (end-to-end wire verification) + real validate middleware (so
// the kind-enum schema is enforced). Advisory-only: returns severity-tagged
// issues, never blocks.

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
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      admin: req.header('x-test-admin') === 'true', // admin → canIssuePermits
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

// A fully-compliant critical lift → no blockers.
const cleanIzaje = {
  loadWeightKg: 1000, operatingRadiusMeters: 5, craneCapacityAtRadiusKg: 5000,
  craneOperatorUid: 'op1', craneOperatorCertified: true,
  riggerUid: 'rig1', signalerUid: 'sig1', windSpeedMps: 3,
  exclusionZoneMarked: true, riggingInspected: true,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

describe('POST /work-permits/validate-critical (wired DS 132 validators)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send({ kind: 'izaje_critico', data: cleanIzaje });
    expect(res.status).toBe(401);
  });

  it('403 when the caller cannot issue permits', async () => {
    const res = await request(buildApp()).post(URL).set('x-test-uid', 'worker1').send({ kind: 'izaje_critico', data: cleanIzaje });
    expect(res.status).toBe(403);
  });

  it('400 for an unsupported kind (schema enforced)', async () => {
    const res = await request(buildApp()).post(URL).set(issuer).send({ kind: 'altura', data: {} });
    expect(res.status).toBe(400);
  });

  it('200 + no blockers for a fully-compliant critical lift', async () => {
    const res = await request(buildApp()).post(URL).set(issuer).send({ kind: 'izaje_critico', data: cleanIzaje });
    expect(res.status).toBe(200);
    expect(res.body.result.kind).toBe('izaje_critico');
    expect(res.body.result.hasBlockers).toBe(false);
  });

  it('200 + surfaces real DS 132 blockers for an unsafe lift (advisory, never blocks the response)', async () => {
    const unsafe = {
      ...cleanIzaje,
      loadWeightKg: 6000, // > 5000 capacity → OVER_CAPACITY
      craneOperatorCertified: false, // OPERATOR_NOT_CERTIFIED
      riggerUid: undefined, signalerUid: undefined, // RIGGER/SIGNALER_MISSING
      exclusionZoneMarked: false, riggingInspected: false,
    };
    const res = await request(buildApp()).post(URL).set(issuer).send({ kind: 'izaje_critico', data: unsafe });
    expect(res.status).toBe(200); // still 200 — surfaces issues, doesn't block
    expect(res.body.result.hasBlockers).toBe(true);
    const codes = (res.body.result.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['OVER_CAPACITY', 'OPERATOR_NOT_CERTIFIED', 'RIGGER_MISSING']));
  });

  it('400 invalid_metadata for incomplete critical metadata (defensive, not a 500)', async () => {
    // empty loto data → validator would crash iterating identifiedSources;
    // the endpoint catches it and returns a client-error 400, never a 500.
    const res = await request(buildApp()).post(URL).set(issuer).send({ kind: 'loto', data: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_metadata');
  });

  it('routes to the LOTO validator for well-formed loto metadata', async () => {
    const res = await request(buildApp()).post(URL).set(issuer)
      .send({ kind: 'loto', data: { identifiedSources: [], locks: [], tryoutPerformed: true } });
    expect(res.status).toBe(200);
    expect(res.body.result.kind).toBe('loto');
    expect(Array.isArray(res.body.result.issues)).toBe(true);
  });
});
