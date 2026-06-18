// Praeventio Guard — Critical Roles router: REAL-router behavioral supertest
// (CLAUDE.md #22 router-test ratchet). Boots the actual `criticalRoles` router
// with admin.firestore() backed by the in-memory FakeFirestore, runs the REAL
// engine in `src/services/criticalRoles/criticalRolesMap.ts`, and exercises the
// four stateless POST endpoints over HTTP via supertest.
//
// This router is PURE COMPUTE — bus-factor / substitute-matrix analysis for
// life-critical roles (grua operator, rigger, brigadista, etc.). It performs NO
// Firestore writes and NO audit_logs writes (no state change), so this test
// asserts (a) the auth + membership gate (401/403), (b) the input validation
// gate (400), (c) that the REAL engine ran and returned the deterministic
// catalog/coverage shape on the happy path, and (d) the 404 for an unknown role
// code. The FakeFirestore is seeded with the project doc so `assertProjectMember`
// passes for a member and rejects (403) a non-member.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = { uid, email: req.header('x-test-email') ?? null } as import('express').Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import criticalRolesRouter from './criticalRoles';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';
const TENANT = 't1';
const PROJECT = 'p1';
const MEMBER = 'member-1';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, criticalRolesRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members, createdBy: MEMBER });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const base = `${PREFIX}/${PROJECT}/critical-roles`;

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

// ────────────────────────────────────────────────────────────────────────
// Auth gate (verifyAuth) — applies to every endpoint.
// ────────────────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('401 without a token (for-industry)', async () => {
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .send({ industry: 'mining' });
    expect(res.status).toBe(401);
  });

  it('401 without a token (find-by-code)', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-by-code`)
      .send({ code: 'grua_operator' });
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Membership gate (assertProjectMember reads the seeded project doc).
// NOTE: the body must be VALID here — `validate(schema)` runs BEFORE the
// membership guard, so an invalid body would 400 before reaching the 403.
// ────────────────────────────────────────────────────────────────────────

describe('membership gate', () => {
  it('403 for a non-member with a valid body', async () => {
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .set(asUser(OUTSIDER))
      .send({ industry: 'mining' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project doc does not exist', async () => {
    H.db = createFakeFirestore(); // no project seeded
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .set(asUser(MEMBER))
      .send({ industry: 'mining' });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Validation gate (validate(schema)) — 400 invalid_payload.
// ────────────────────────────────────────────────────────────────────────

describe('validation gate', () => {
  it('400 on an unknown industry enum value', async () => {
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .set(asUser(MEMBER))
      .send({ industry: 'banking' }); // not in the Industry enum
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 when the required field is missing (find-by-code without code)', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-by-code`)
      .set(asUser(MEMBER))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a malformed build-coverage role (missing required role fields)', async () => {
    const res = await request(buildApp())
      .post(`${base}/build-coverage`)
      .set(asUser(MEMBER))
      .send({ role: { code: 'x' }, workers: [] }); // role missing label/industries/etc.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Happy paths — the REAL engine ran and returned its deterministic output.
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-roles/for-industry', () => {
  it('200 returns only the roles whose catalog lists that industry', async () => {
    // 'agriculture' is listed by exactly one catalog role: medical_emergency_response.
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .set(asUser(MEMBER))
      .send({ industry: 'agriculture' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.roles)).toBe(true);
    const codes = res.body.roles.map((r: { code: string }) => r.code);
    expect(codes).toContain('medical_emergency_response');
    // Roles that do NOT list agriculture must be filtered out by the engine.
    expect(codes).not.toContain('blasting_specialist');
    // Every returned role genuinely lists the queried industry (engine ran).
    for (const r of res.body.roles as Array<{ industries: string[] }>) {
      expect(r.industries).toContain('agriculture');
    }
  });

  it('200 returns multiple roles for mining', async () => {
    const res = await request(buildApp())
      .post(`${base}/for-industry`)
      .set(asUser(MEMBER))
      .send({ industry: 'mining' });
    expect(res.status).toBe(200);
    const codes = res.body.roles.map((r: { code: string }) => r.code);
    expect(codes).toContain('grua_operator');
    expect(codes).toContain('blasting_specialist'); // mining-only role
    expect(codes.length).toBeGreaterThan(1);
  });
});

describe('POST /:projectId/critical-roles/find-by-code', () => {
  it('200 returns the matching catalog role definition', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-by-code`)
      .set(asUser(MEMBER))
      .send({ code: 'grua_operator' });
    expect(res.status).toBe(200);
    expect(res.body.role.code).toBe('grua_operator');
    expect(res.body.role.requiredDocuments).toContain('licencia_grua');
    expect(res.body.role.minimumAuthorized).toBe(2);
  });

  it('404 for a code that is not in the catalog', async () => {
    const res = await request(buildApp())
      .post(`${base}/find-by-code`)
      .set(asUser(MEMBER))
      .send({ code: 'role_does_not_exist' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('role_not_found');
  });
});

describe('POST /:projectId/critical-roles/build-coverage', () => {
  // medical_emergency_response: minimumAuthorized=2, requiredTrainings=
  // ['primeros_auxilios_basico'], requiredDocuments=[]. An active worker with
  // that training (docs trivially satisfied) classifies as a 'titular'.
  const role = {
    code: 'medical_emergency_response',
    label: 'Brigadista primeros auxilios',
    industries: ['mining'],
    minimumAuthorized: 2,
    requiredTrainings: ['primeros_auxilios_basico'],
    requiredDocuments: [],
    blocksTaskCategories: [],
  };
  const worker = (uid: string) => ({
    uid,
    fullName: `Trabajador ${uid}`,
    isActive: true,
    activeTrainings: ['primeros_auxilios_basico'],
    activeDocuments: [],
    trainingsInProgress: [],
  });

  it('200 computes coverage via the real engine (busFactor + isFragile)', async () => {
    const res = await request(buildApp())
      .post(`${base}/build-coverage`)
      .set(asUser(MEMBER))
      .send({ role, workers: [worker('w1'), worker('w2')] });
    expect(res.status).toBe(200);
    const cov = res.body.coverage;
    // Both workers meet trainings+docs → titulars; totalCertified=2.
    expect(cov.titulars.map((w: { uid: string }) => w.uid).sort()).toEqual(['w1', 'w2']);
    // busFactor = max(0, totalCertified - minimumAuthorized) = max(0, 2-2) = 0.
    expect(cov.busFactor).toBe(0);
    // isFragile = totalCertified <= minimumAuthorized = (2 <= 2) = true.
    expect(cov.isFragile).toBe(true);
    expect(cov.role.code).toBe('medical_emergency_response');
  });

  it('200 with an empty worker roster → no titulars, fragile', async () => {
    const res = await request(buildApp())
      .post(`${base}/build-coverage`)
      .set(asUser(MEMBER))
      .send({ role, workers: [] });
    expect(res.status).toBe(200);
    expect(res.body.coverage.titulars).toEqual([]);
    expect(res.body.coverage.busFactor).toBe(0);
    expect(res.body.coverage.isFragile).toBe(true);
  });
});

describe('POST /:projectId/critical-roles/suggest-training', () => {
  const role = {
    code: 'medical_emergency_response',
    label: 'Brigadista primeros auxilios',
    industries: ['mining'],
    minimumAuthorized: 2,
    requiredTrainings: ['primeros_auxilios_basico'],
    requiredDocuments: [],
    blocksTaskCategories: [],
  };
  const coverage = {
    role,
    titulars: [],
    substitutes: [],
    inTraining: [],
    busFactor: 0,
    isFragile: true,
  };

  it('200 returns a training plan shape from the real engine', async () => {
    const res = await request(buildApp())
      .post(`${base}/suggest-training`)
      .set(asUser(MEMBER))
      .send({
        coverage,
        // One active worker mid-training → counts as a candidate.
        workers: [
          {
            uid: 'cand-1',
            fullName: 'Candidato 1',
            isActive: true,
            activeTrainings: [],
            activeDocuments: [],
            trainingsInProgress: ['primeros_auxilios_basico'],
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.plan.roleCode).toBe('medical_emergency_response');
    expect(Array.isArray(res.body.plan.recommendedCandidates)).toBe(true);
    expect(res.body.plan.recommendedCandidates.map((w: { uid: string }) => w.uid)).toContain('cand-1');
    expect(Array.isArray(res.body.plan.missingTrainings)).toBe(true);
    expect(typeof res.body.plan.estimatedDaysToCoverage).toBe('number');
    expect(typeof res.body.plan.message).toBe('string');
  });
});
