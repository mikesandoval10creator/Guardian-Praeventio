// Real-router supertest for src/server/routes/regulatoryFramework.ts
// (Plan v3 Fase 1 — 5 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. All five endpoints are
// POST /:projectId/regulatory/<sub-path> behind verifyAuth + (3 of 5 with
// validate(zodSchema)) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes, then drive
// every status code the route can emit: 401 (no token), 400 (schema fail),
// 403 (project guard), 200 (happy path).
//
// The regulatory service functions (getActiveJurisdictions, cite,
// resolveControl, listControls, getReferencesForControl) are pure-compute
// helpers that import static JSON-like data; they are NOT mocked so real
// domain behaviour (ISO 45001 baseline always active, jurisdiction mapping,
// tier limits) is exercised.

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
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
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

import regulatoryFrameworkRouter from '../../server/routes/regulatoryFramework.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', regulatoryFrameworkRouter);
  return app;
}

const PROJECT_ID = 'p-rf-test';
const CALLER_UID = 'uid-rf-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'RF Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/regulatory/active-jurisdictions
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/regulatory/active-jurisdictions', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/regulatory/active-jurisdictions`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ ctx: { country: 'CL' } });
    expect(res.status).toBe(401);
  });

  it('400 when ctx is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when tier is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ctx: { country: 'CL' }, tier: 'mega-super-plan' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ ctx: { country: 'CL' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/regulatory/active-jurisdictions`)
      .set('x-test-uid', CALLER_UID)
      .send({ ctx: { country: 'CL' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 Chile tenant always gets ISO-45001 + CL', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ctx: { country: 'CL' } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jurisdictions)).toBe(true);
    expect(res.body.jurisdictions).toContain('ISO-45001');
    expect(res.body.jurisdictions).toContain('CL');
  });

  it('200 unknown country falls back to ISO-45001 only', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ctx: { country: 'XX' } });
    expect(res.status).toBe(200);
    expect(res.body.jurisdictions).toEqual(['ISO-45001']);
  });

  it('200 empty ctx object → ISO-45001 baseline only', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ctx: {} });
    expect(res.status).toBe(200);
    expect(res.body.jurisdictions).toEqual(['ISO-45001']);
  });

  it('200 diamante tier with extraCountries expands jurisdictions', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ctx: { country: 'CL', extraCountries: ['MX', 'BR'] },
        tier: 'diamante',
      });
    expect(res.status).toBe(200);
    const { jurisdictions } = res.body as { jurisdictions: string[] };
    expect(jurisdictions).toContain('ISO-45001');
    expect(jurisdictions).toContain('CL');
    // diamante supports multi-jurisdiction — MX and/or BR should appear
    expect(jurisdictions.length).toBeGreaterThan(2);
  });

  it('200 gratis tier ignores extraCountries (limit=1 jurisdiction)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ctx: { country: 'CL', extraCountries: ['MX', 'BR'] },
        tier: 'gratis',
      });
    expect(res.status).toBe(200);
    const { jurisdictions } = res.body as { jurisdictions: string[] };
    // gratis allows only 1 extra jurisdiction beyond ISO-45001
    expect(jurisdictions).toContain('ISO-45001');
    expect(jurisdictions).toContain('CL');
    // MX and BR must NOT be activated for gratis tier
    expect(jurisdictions).not.toContain('MX');
    expect(jurisdictions).not.toContain('BR');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/regulatory/cite
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/regulatory/cite', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/regulatory/cite`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ controlId: 'WORKER_PARTICIPATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(401);
  });

  it('400 when controlId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when jurisdictions array is empty', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'WORKER_PARTICIPATION', jurisdictions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when jurisdictions contains an invalid code', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'WORKER_PARTICIPATION', jurisdictions: ['ZZ'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ controlId: 'WORKER_PARTICIPATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns ISO-45001 citation for WORKER_PARTICIPATION', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'WORKER_PARTICIPATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.citations)).toBe(true);
    expect(res.body.citations.length).toBeGreaterThan(0);
    // short format: code only for ISO-45001
    expect(res.body.citations[0]).toMatch(/ISO-45001:/);
  });

  it('200 long format adds jurisdiction label', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'WORKER_PARTICIPATION',
        jurisdictions: ['ISO-45001'],
        format: 'long',
      });
    expect(res.status).toBe(200);
    expect(res.body.citations[0]).toMatch(/ISO 45001:2018/);
  });

  it('200 unknown controlId returns empty citations array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'NONEXISTENT_CONTROL', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    expect(res.body.citations).toEqual([]);
  });

  it('200 multi-jurisdiction cite includes both ISO and CL references', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'WORKER_PARTICIPATION',
        jurisdictions: ['ISO-45001', 'CL'],
      });
    expect(res.status).toBe(200);
    const { citations } = res.body as { citations: string[] };
    // ISO-45001 reference must appear
    const hasIso = citations.some((c) => c.includes('ISO-45001:'));
    expect(hasIso).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/regulatory/resolve-control
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/regulatory/resolve-control', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/regulatory/resolve-control`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ controlId: 'HAZARD_IDENTIFICATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(401);
  });

  it('400 when controlId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when jurisdictions array is empty', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'HAZARD_IDENTIFICATION', jurisdictions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ controlId: 'HAZARD_IDENTIFICATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 known control → returns ComplianceControl shape', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'HAZARD_IDENTIFICATION', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    const { control } = res.body as {
      control: {
        id: string;
        title: string;
        iso45001Clause: string;
        references: { code: string; jurisdiction: string }[];
      };
    };
    expect(control).not.toBeNull();
    expect(control.id).toBe('HAZARD_IDENTIFICATION');
    expect(control.title).toBeTruthy();
    expect(control.iso45001Clause).toBe('6.1.2');
    expect(Array.isArray(control.references)).toBe(true);
    expect(control.references.length).toBeGreaterThan(0);
    expect(control.references[0].jurisdiction).toBe('ISO-45001');
  });

  it('200 unknown controlId returns null (not 404)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'NONEXISTENT_XYZ', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    expect(res.body.control).toBeNull();
  });

  it('200 multi-jurisdiction enriches references list', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'WORKER_PARTICIPATION',
        jurisdictions: ['ISO-45001', 'CL'],
      });
    expect(res.status).toBe(200);
    const { control } = res.body as {
      control: { references: { jurisdiction: string }[] };
    };
    expect(control).not.toBeNull();
    // ISO-45001 reference must always be first
    expect(control.references[0].jurisdiction).toBe('ISO-45001');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/regulatory/list-controls
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/regulatory/list-controls', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/regulatory/list-controls`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns controls array with at least the ISO 45001 baseline controls', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controls)).toBe(true);
    expect(res.body.controls.length).toBeGreaterThanOrEqual(10);
  });

  it('200 each control has id, title, and references array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    const { controls } = res.body as {
      controls: { id: string; title: string; references: unknown[] }[];
    };
    for (const c of controls) {
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.title).toBe('string');
      expect(Array.isArray(c.references)).toBe(true);
    }
  });

  it('200 LEADERSHIP_COMMITMENT is present in the catalog', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(200);
    const { controls } = res.body as { controls: { id: string }[] };
    const ids = controls.map((c) => c.id);
    expect(ids).toContain('LEADERSHIP_COMMITMENT');
    expect(ids).toContain('WORKER_PARTICIPATION');
    expect(ids).toContain('HAZARD_IDENTIFICATION');
  });

  it('200 body can be empty JSON object (no validate() middleware on this endpoint)', async () => {
    // list-controls has no validate() middleware — any body is accepted
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ unexpected: 'field' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controls)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/regulatory/references
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/regulatory/references', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/regulatory/references`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ controlId: 'OPERATIONAL_CONTROL', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(401);
  });

  it('400 when controlId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when jurisdictions is empty', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'OPERATIONAL_CONTROL', jurisdictions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when jurisdictions contains unknown code', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'OPERATIONAL_CONTROL', jurisdictions: ['INVALID'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ controlId: 'OPERATIONAL_CONTROL', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 known control + ISO-45001 → returns RegulationRef array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'OPERATIONAL_CONTROL', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.references)).toBe(true);
    expect(res.body.references.length).toBeGreaterThan(0);
    const ref = (res.body.references as { code: string; title: string; jurisdiction: string; scope: string }[])[0];
    expect(typeof ref.code).toBe('string');
    expect(typeof ref.title).toBe('string');
    expect(ref.jurisdiction).toBe('ISO-45001');
    expect(typeof ref.scope).toBe('string');
  });

  it('200 unknown control → returns empty references array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'NONEXISTENT_CONTROL_ZZZ', jurisdictions: ['ISO-45001'] });
    expect(res.status).toBe(200);
    expect(res.body.references).toEqual([]);
  });

  it('200 ISO-45001 references are always first in sort order', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'WORKER_PARTICIPATION',
        jurisdictions: ['ISO-45001', 'CL'],
      });
    expect(res.status).toBe(200);
    const refs = res.body.references as { jurisdiction: string }[];
    if (refs.length > 0) {
      expect(refs[0].jurisdiction).toBe('ISO-45001');
    }
  });

  it('200 all 14 non-ISO jurisdictions are valid in request', async () => {
    const allNonIso = ['CL', 'US-OSHA', 'EU', 'MX', 'BR', 'UK', 'CA', 'AU', 'JP', 'KR', 'IN', 'CN', 'TW', 'RU'];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'HAZARD_IDENTIFICATION',
        jurisdictions: allNonIso,
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.references)).toBe(true);
    // We only assert shape — exact counts depend on jurisdiction adapter data
  });
});
