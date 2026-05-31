// Real-router supertest for src/server/routes/medicalCatalogs.ts.
//
// Sprint plan v3 Fase 1 — coverage lever. Mounts the ACTUAL production router
// through the reusable fakeFirestore so the real handler code (auth gate, zod
// validation, assertProjectMember membership check, catalog search, limit
// clamping) is exercised.
//
// ADR 0012 compliance: these endpoints are CATALOG LOOKUPS only (reference
// data). Tests assert that responses NEVER contain clinical/diagnostic fields
// (diagnosis, clinicalRisk, predictedPathology, etc.) — they serve catalog
// reference data to lightweight clients so they don't have to bundle the JSON.
//
// Mount: server.ts line 1041 — app.use('/api/sprint-k', medicalCatalogsRouter)

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import medicalCatalogsRouter from '../../server/routes/medicalCatalogs.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// Prefix from server.ts:1041 — app.use('/api/sprint-k', medicalCatalogsRouter)
const PREFIX = '/api/sprint-k';
const PROJECT = 'p1';
const UID = 'worker-uid-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, medicalCatalogsRouter);
  return app;
}

/** Seed a project doc that lists `uid` as a member so assertProjectMember passes. */
function seedProject(uid: string = UID, projectId: string = PROJECT) {
  H.db!._seed(`projects/${projectId}`, {
    members: [uid],
    createdBy: uid,
    name: 'Proyecto Test',
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GATE (shared across all endpoints)
// ─────────────────────────────────────────────────────────────────────────────

describe('auth gate — all catalog endpoints require a token', () => {
  const endpoints = [
    `${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/search`,
    `${PREFIX}/${PROJECT}/medical-catalogs/drugs/search`,
    `${PREFIX}/${PROJECT}/medical-catalogs/anatomy/search`,
    `${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/by-risk-agent`,
    `${PREFIX}/${PROJECT}/medical-catalogs/anatomy/by-system`,
    `${PREFIX}/${PROJECT}/medical-catalogs/list-meta`,
  ];

  it.each(endpoints)('401 without x-test-uid on POST %s', async (endpoint) => {
    const res = await request(buildApp())
      .post(endpoint)
      .send({ query: 'test', system: 'musculoesquelético', agent: 'sílice' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT MEMBERSHIP GATE
// ─────────────────────────────────────────────────────────────────────────────

describe('project membership gate', () => {
  it('403 when project doc does not exist (not a member)', async () => {
    // No seed — project doc absent → assertProjectMember throws ProjectMembershipError
    const res = await request(buildApp())
      .post(`${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/search`)
      .set('x-test-uid', UID)
      .send({ query: 'silice' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when caller uid is not in project members[]', async () => {
    H.db!._seed(`projects/${PROJECT}`, {
      members: ['other-uid'],
      createdBy: 'other-uid',
    });
    const res = await request(buildApp())
      .post(`${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/search`)
      .set('x-test-uid', UID)
      .send({ query: 'silice' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/medical-catalogs/diagnoses/search
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/diagnoses/search', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/search`;

  beforeEach(() => seedProject());

  it('400 when query is missing (validate middleware)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when query is empty string', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when limit exceeds MAX_RESULTS (50)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'silice', limit: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns results + total for a known term (sílice)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'sílice' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.results.length).toBe(res.body.total);
  });

  it('200 returns empty results for a query that matches nothing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'ZZZNOMATCHXXX99' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('200 filters by occupationalOnly=true (all returned entries are occupational)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'silice', occupationalOnly: true });
    expect(res.status).toBe(200);
    if (res.body.results.length > 0) {
      expect(res.body.results.every((d: { occupational: boolean }) => d.occupational)).toBe(true);
    }
  });

  it('200 respects custom limit', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'a', limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(2);
  });

  it('ADR-0012: response shape contains only catalog reference fields, never diagnosis/clinicalRisk/predictedPathology', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'sílice' });
    expect(res.status).toBe(200);
    for (const entry of res.body.results as Record<string, unknown>[]) {
      // Reference catalog fields expected
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('category');
      // No clinical inference fields
      expect(entry).not.toHaveProperty('diagnosis');
      expect(entry).not.toHaveProperty('clinicalRisk');
      expect(entry).not.toHaveProperty('predictedPathology');
      expect(entry).not.toHaveProperty('fitnessVerdict');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/medical-catalogs/drugs/search
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/drugs/search', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/drugs/search`;

  beforeEach(() => seedProject());

  it('400 when body is empty (missing query)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns drug results for a known term', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'salbutamol' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  it('200 filters by category when provided', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'a', category: 'broncodilatador' });
    expect(res.status).toBe(200);
    for (const d of res.body.results as { category: string }[]) {
      expect(d.category).toBe('broncodilatador');
    }
  });

  it('200 returns empty results when query matches nothing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'ZZZNOMATCHDRUG9999' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('ADR-0012: drug response contains catalog reference fields only, never clinical inference', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'salbutamol' });
    expect(res.status).toBe(200);
    for (const entry of res.body.results as Record<string, unknown>[]) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('atc');
      expect(entry).toHaveProperty('category');
      expect(entry).not.toHaveProperty('diagnosis');
      expect(entry).not.toHaveProperty('clinicalRisk');
      expect(entry).not.toHaveProperty('predictedPathology');
      expect(entry).not.toHaveProperty('fitnessVerdict');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/medical-catalogs/anatomy/search
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/anatomy/search', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/anatomy/search`;

  beforeEach(() => seedProject());

  it('400 when body is empty (missing query)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns anatomy results for a known term (columna)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'columna' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  it('200 filters by system when provided', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'a', system: 'musculoesquelético' });
    expect(res.status).toBe(200);
    for (const a of res.body.results as { system: string }[]) {
      expect(a.system).toBe('musculoesquelético');
    }
  });

  it('200 returns empty results when query matches nothing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'ZZZNOMATCHANATOMY9999' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('ADR-0012: anatomy response contains reference fields only, never clinical inference', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ query: 'lumbar' });
    expect(res.status).toBe(200);
    for (const entry of res.body.results as Record<string, unknown>[]) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('system');
      expect(entry).not.toHaveProperty('diagnosis');
      expect(entry).not.toHaveProperty('clinicalRisk');
      expect(entry).not.toHaveProperty('predictedPathology');
      expect(entry).not.toHaveProperty('fitnessVerdict');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/medical-catalogs/diagnoses/by-risk-agent
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/diagnoses/by-risk-agent', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/diagnoses/by-risk-agent`;

  beforeEach(() => seedProject());

  it('400 when agent field is missing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when agent is an empty string', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ agent: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns diagnoses associated with a known risk agent (sílice)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ agent: 'sílice' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
    // All returned entries should have sílice in their riskAgents
    for (const d of res.body.results as { riskAgents: string[] }[]) {
      const hasAgent = d.riskAgents.some((a) =>
        a.toLowerCase().includes('sílice'),
      );
      expect(hasAgent).toBe(true);
    }
  });

  it('200 returns empty results for an unknown risk agent', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ agent: 'ZZZNOMATCHAGENT9999' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('200 respects optional limit parameter', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ agent: 'polvo', limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(1);
  });

  it('ADR-0012: by-risk-agent returns catalog entries only, no clinical inference', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ agent: 'sílice' });
    expect(res.status).toBe(200);
    for (const entry of res.body.results as Record<string, unknown>[]) {
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('riskAgents');
      expect(entry).not.toHaveProperty('diagnosis');
      expect(entry).not.toHaveProperty('clinicalRisk');
      expect(entry).not.toHaveProperty('predictedPathology');
      expect(entry).not.toHaveProperty('fitnessVerdict');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/medical-catalogs/anatomy/by-system
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/anatomy/by-system', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/anatomy/by-system`;

  beforeEach(() => seedProject());

  it('400 when system field is missing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when system is an empty string', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns all entries for a known system (musculoesquelético)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: 'musculoesquelético' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    // Case-insensitive match: all returned entries belong to the requested system
    for (const a of res.body.results as { system: string }[]) {
      expect(a.system.toLowerCase()).toBe('musculoesquelético');
    }
  });

  it('200 returns empty for an unknown system name', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: 'sistema-inexistente-xyz' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('200 system match is case-insensitive', async () => {
    const lower = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: 'musculoesquelético' });
    const upper = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: 'MUSCULOESQUELÉTICO' });
    expect(lower.status).toBe(200);
    expect(upper.status).toBe(200);
    expect(lower.body.total).toBe(upper.body.total);
  });

  it('ADR-0012: by-system returns anatomy reference entries only, no clinical inference', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({ system: 'musculoesquelético' });
    expect(res.status).toBe(200);
    for (const entry of res.body.results as Record<string, unknown>[]) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('system');
      expect(entry).not.toHaveProperty('diagnosis');
      expect(entry).not.toHaveProperty('clinicalRisk');
      expect(entry).not.toHaveProperty('predictedPathology');
      expect(entry).not.toHaveProperty('fitnessVerdict');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. POST /:projectId/medical-catalogs/list-meta
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/medical-catalogs/list-meta', () => {
  const URL = `${PREFIX}/${PROJECT}/medical-catalogs/list-meta`;

  beforeEach(() => seedProject());

  it('200 returns meta + counts for all three catalogs', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(200);
    // Three catalog keys must exist
    expect(res.body).toHaveProperty('diagnoses');
    expect(res.body).toHaveProperty('drugs');
    expect(res.body).toHaveProperty('anatomy');
    // Each must have a count and a meta object
    expect(typeof res.body.diagnoses.count).toBe('number');
    expect(res.body.diagnoses.count).toBeGreaterThan(0);
    expect(typeof res.body.drugs.count).toBe('number');
    expect(res.body.drugs.count).toBeGreaterThan(0);
    expect(typeof res.body.anatomy.count).toBe('number');
    expect(res.body.anatomy.count).toBeGreaterThan(0);
    // Meta objects include license/disclaimer fields
    expect(typeof res.body.diagnoses.meta.license).toBe('string');
    expect(typeof res.body.diagnoses.meta.disclaimer).toBe('string');
  });

  it('ADR-0012: list-meta contains catalog meta only, not clinical data', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(200);
    // Top-level response must NOT contain clinical inference shapes
    expect(res.body).not.toHaveProperty('diagnosis');
    expect(res.body).not.toHaveProperty('clinicalRisk');
    expect(res.body).not.toHaveProperty('predictedPathology');
    expect(res.body).not.toHaveProperty('fitnessVerdict');
    // Each catalog meta should have a disclaimer flagging non-clinical nature
    expect(res.body.diagnoses.meta.disclaimer).toMatch(/no sustituye|no reemplaza|no.*clín/i);
  });

  it('403 when caller is not a project member', async () => {
    // No seed — project absent → 403
    const res = await request(buildApp())
      .post(`${PREFIX}/nonexistent-project/medical-catalogs/list-meta`)
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
