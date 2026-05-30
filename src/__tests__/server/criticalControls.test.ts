// Real-router supertest for src/server/routes/criticalControls.ts
// (Plan v3 Fase 1 — 9 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. All nine endpoints are
// POST /:projectId/critical-controls/<sub-path> behind verifyAuth +
// validate(zodSchema) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes, then drive
// every status code the route can emit: 401 (no token), 400 (schema fail),
// 403 (project guard), 200 (happy path).

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

import criticalControlsRouter from '../../server/routes/criticalControls.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', criticalControlsRouter);
  return app;
}

// Reusable member project + caller setup
const PROJECT_ID = 'p-cc-test';
const CALLER_UID = 'uid-cc-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// A minimal valid CriticalControl for catalog params
const minControl = {
  id: 'alt-eng-baranda',
  riskCategory: 'altura',
  label: 'Barandas perimetrales',
  level: 'engineering' as const,
  verificationMethod: 'visual' as const,
  normReference: 'DS 594 art. 53',
};

// A minimal valid ControlValidation
const minValidation = {
  controlId: 'alt-eng-baranda',
  present: true,
  validatedByUid: CALLER_UID,
  validatedAt: '2026-01-15T08:00:00.000Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/critical-controls/get-for-risk
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/get-for-risk', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/get-for-risk`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ riskCategory: 'altura' });
    expect(res.status).toBe(401);
  });

  it('400 when riskCategory is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ riskCategory: 'altura' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns controls for a known risk category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'altura' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controls)).toBe(true);
    expect(res.body.controls.length).toBeGreaterThan(0);
    // All returned controls must match the requested category
    for (const c of res.body.controls as { riskCategory: string }[]) {
      expect(c.riskCategory).toBe('altura');
    }
  });

  it('200 returns empty array for an unknown risk category', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'categoria-inexistente-xyz' });
    expect(res.status).toBe(200);
    expect(res.body.controls).toEqual([]);
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/critical-controls/get-for-risk`)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'altura' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/critical-controls/validate-pre-task
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/validate-pre-task', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/validate-pre-task`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ riskCategory: 'altura', validations: [] });
    expect(res.status).toBe(401);
  });

  it('400 when riskCategory is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ validations: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when validations array item is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategory: 'altura',
        validations: [{ controlId: 'x' /* missing required fields */ }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 with empty validations — missing controls identified, not authorized', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'altura', validations: [] });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.riskCategory).toBe('altura');
    expect(result.controlsRequired).toBeGreaterThan(0);
    expect(result.controlsPresent).toBe(0);
    expect(Array.isArray(result.missing)).toBe(true);
    expect((result.missing as unknown[]).length).toBeGreaterThan(0);
    // The route recommends — it never encodes a machinery hard-block flag.
    expect(result.authorizedToStart).toBe(false);
    // validatedByUid must be forced to caller, not a client-supplied value
    expect(result.validatedByUid).toBe(CALLER_UID);
  });

  it('200 all controls present — authorized + hierarchy balanced', async () => {
    // Use the real library controls for 'quimico' which only has 3 controls
    const validationsForQuimico = [
      { controlId: 'qui-sub-menos-toxico', present: true, validatedByUid: 'ignored', validatedAt: '2026-01-15T08:00:00.000Z' },
      { controlId: 'qui-eng-extraccion', present: true, validatedByUid: 'ignored', validatedAt: '2026-01-15T08:00:00.000Z' },
      { controlId: 'qui-adm-hds', present: true, validatedByUid: 'ignored', validatedAt: '2026-01-15T08:00:00.000Z' },
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'quimico', validations: validationsForQuimico });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.authorizedToStart).toBe(true);
    expect(result.coveragePercent).toBe(100);
    expect(result.isHierarchyBalanced).toBe(true);
    // validatedByUid must be forced to the caller uid, not client-supplied 'ignored'
    expect(result.validatedByUid).toBe(CALLER_UID);
  });

  it('200 with optional now param overriding the timestamp', async () => {
    const nowIso = '2026-03-01T12:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'altura', validations: [], now: nowIso });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    // validatedAt should reflect the provided now
    expect(result.validatedAt).toBe(nowIso);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/critical-controls/robustness-score
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/robustness-score', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/robustness-score`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ control: { level: 'epp' } });
    expect(res.status).toBe(401);
  });

  it('400 when level is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ control: { level: 'invalid-level' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns score=100 for elimination', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ control: { level: 'elimination' } });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
  });

  it('200 returns score=10 for epp (lowest in hierarchy)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ control: { level: 'epp' } });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(10);
  });

  it('200 engineering score is strictly between epp and elimination', async () => {
    const [engRes, elimRes, eppRes] = await Promise.all([
      request(buildApp()).post(url).set('x-test-uid', CALLER_UID).send({ control: { level: 'engineering' } }),
      request(buildApp()).post(url).set('x-test-uid', CALLER_UID).send({ control: { level: 'elimination' } }),
      request(buildApp()).post(url).set('x-test-uid', CALLER_UID).send({ control: { level: 'epp' } }),
    ]);
    expect(engRes.body.score).toBeGreaterThan(eppRes.body.score as number);
    expect(engRes.body.score).toBeLessThan(elimRes.body.score as number);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/critical-controls/superior-to
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/superior-to', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/superior-to`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ level: 'epp' });
    expect(res.status).toBe(401);
  });

  it('400 when level is not one of the enum values', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ level: 'not-a-level' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 epp → returns all higher levels in order', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ level: 'epp' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.levels)).toBe(true);
    // elimination is the highest — must be included when querying from epp
    expect(res.body.levels).toContain('elimination');
    // epp itself must NOT be in the list
    expect(res.body.levels).not.toContain('epp');
  });

  it('200 elimination → returns empty array (nothing above)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ level: 'elimination' });
    expect(res.status).toBe(200);
    expect(res.body.levels).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. POST /:projectId/critical-controls/build-barrier-analysis
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/build-barrier-analysis', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/build-barrier-analysis`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ riskCategory: 'altura', catalog: [], validations: [] });
    expect(res.status).toBe(401);
  });

  it('400 when catalog item has invalid level', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategory: 'altura',
        catalog: [{ ...minControl, level: 'bad-level' }],
        validations: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 empty catalog → barrierCount=0, isSingleBarrier=false', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ riskCategory: 'altura', catalog: [], validations: [] });
    expect(res.status).toBe(200);
    const { analysis } = res.body as { analysis: Record<string, unknown> };
    expect(analysis.riskCategory).toBe('altura');
    expect(analysis.barrierCount).toBe(0);
    expect(analysis.isSingleBarrier).toBe(false);
    expect(Array.isArray(analysis.liveBarrierLabels)).toBe(true);
  });

  it('200 single present control → isSingleBarrier=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategory: 'altura',
        catalog: [minControl],
        validations: [minValidation],
      });
    expect(res.status).toBe(200);
    const { analysis } = res.body as { analysis: Record<string, unknown> };
    expect(analysis.barrierCount).toBe(1);
    expect(analysis.isSingleBarrier).toBe(true);
    expect(analysis.liveBarrierLabels).toContain('Barandas perimetrales');
  });

  it('200 two present controls → isSingleBarrier=false', async () => {
    const secondControl = {
      id: 'alt-eng-linea',
      riskCategory: 'altura',
      label: 'Línea de vida instalada',
      level: 'engineering' as const,
      verificationMethod: 'visual' as const,
      normReference: 'DS 594 art. 53',
    };
    const secondValidation = {
      controlId: 'alt-eng-linea',
      present: true,
      validatedByUid: CALLER_UID,
      validatedAt: '2026-01-15T08:00:00.000Z',
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategory: 'altura',
        catalog: [minControl, secondControl],
        validations: [minValidation, secondValidation],
      });
    expect(res.status).toBe(200);
    const { analysis } = res.body as { analysis: Record<string, unknown> };
    expect(analysis.barrierCount).toBe(2);
    expect(analysis.isSingleBarrier).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. POST /:projectId/critical-controls/detect-single-barrier
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/detect-single-barrier', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/detect-single-barrier`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ riskCategories: [], catalog: [], validations: [] });
    expect(res.status).toBe(401);
  });

  it('400 when riskCategories item is too long', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategories: ['x'.repeat(201)], // exceeds max(200)
        catalog: [],
        validations: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 no single-barrier risks → empty array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategories: ['altura'],
        catalog: [
          minControl,
          {
            id: 'alt-eng-linea',
            riskCategory: 'altura',
            label: 'Línea de vida instalada',
            level: 'engineering',
            verificationMethod: 'visual',
            normReference: 'DS 594 art. 53',
          },
        ],
        validations: [
          minValidation,
          { controlId: 'alt-eng-linea', present: true, validatedByUid: CALLER_UID, validatedAt: '2026-01-15T08:00:00.000Z' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.analyses).toEqual([]);
  });

  it('200 detects a single-barrier risk', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        riskCategories: ['altura'],
        catalog: [minControl],
        validations: [minValidation], // only one present
      });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.analyses)).toBe(true);
    expect(res.body.analyses).toHaveLength(1);
    expect(res.body.analyses[0].isSingleBarrier).toBe(true);
    expect(res.body.analyses[0].riskCategory).toBe('altura');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. POST /:projectId/critical-controls/verification-status
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/verification-status', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/verification-status`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ controlId: 'alt-eng-baranda', frequency: 'daily' });
    expect(res.status).toBe(401);
  });

  it('400 when frequency is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'alt-eng-baranda', frequency: 'hourly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 never verified → needsEscalation=true, isInWindow=false', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'alt-eng-baranda', frequency: 'daily' });
    expect(res.status).toBe(200);
    const { status } = res.body as { status: Record<string, unknown> };
    expect(status.controlId).toBe('alt-eng-baranda');
    expect(status.frequency).toBe('daily');
    expect(status.isInWindow).toBe(false);
    expect(status.needsEscalation).toBe(true);
  });

  it('200 recently verified → isInWindow=true', async () => {
    const now = new Date();
    const lastVerifiedAt = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'alt-eng-baranda',
        frequency: 'daily',
        lastVerifiedAt,
        nowIso: now.toISOString(),
      });
    expect(res.status).toBe(200);
    const { status } = res.body as { status: Record<string, unknown> };
    expect(status.isInWindow).toBe(true);
    expect(status.needsEscalation).toBe(false);
  });

  it('200 overdue weekly verification → needsEscalation=true', async () => {
    const now = new Date('2026-05-30T12:00:00.000Z');
    const lastVerifiedAt = new Date('2026-05-01T12:00:00.000Z').toISOString(); // 29 days ago, max is 7
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        controlId: 'elec-eng-loto',
        frequency: 'weekly',
        lastVerifiedAt,
        nowIso: now.toISOString(),
      });
    expect(res.status).toBe(200);
    const { status } = res.body as { status: Record<string, unknown> };
    expect(status.isInWindow).toBe(false);
    expect(status.needsEscalation).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. POST /:projectId/critical-controls/energy-for-control
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/energy-for-control', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/energy-for-control`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ controlId: 'alt-eng-baranda' });
    expect(res.status).toBe(401);
  });

  it('400 when controlId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 known control → returns its energy type', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'alt-eng-baranda' });
    expect(res.status).toBe(200);
    expect(res.body.energy).toBe('gravity');
  });

  it('200 electric LOTO control → returns electric energy type', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'elec-eng-loto' });
    expect(res.status).toBe(200);
    expect(res.body.energy).toBe('electric');
  });

  it('200 unknown control → returns null (not undefined)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ controlId: 'nonexistent-control-xyz' });
    expect(res.status).toBe(200);
    // Route explicitly converts undefined to null: `energy: energy ?? null`
    expect(res.body.energy).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. POST /:projectId/critical-controls/by-energy
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/critical-controls/by-energy', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/critical-controls/by-energy`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ catalog: [] });
    expect(res.status).toBe(401);
  });

  it('400 when catalog item has invalid verificationMethod', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        catalog: [{ ...minControl, verificationMethod: 'bad-method' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 empty catalog → grouped object with all energy keys empty', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ catalog: [] });
    expect(res.status).toBe(200);
    const { grouped } = res.body as { grouped: Record<string, unknown[]> };
    // All 8 energy types must be present
    for (const key of ['gravity', 'electric', 'mechanical', 'chemical', 'thermal', 'pressure', 'radiation', 'biological']) {
      expect(Array.isArray(grouped[key])).toBe(true);
      expect(grouped[key]).toHaveLength(0);
    }
  });

  it('200 known control in catalog → grouped under correct energy', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ catalog: [minControl] });
    expect(res.status).toBe(200);
    const { grouped } = res.body as { grouped: Record<string, { id: string }[]> };
    // minControl is 'alt-eng-baranda' → gravity
    expect(grouped.gravity).toHaveLength(1);
    expect(grouped.gravity[0].id).toBe('alt-eng-baranda');
    // Other energies must still exist and be empty
    expect(grouped.electric).toHaveLength(0);
  });

  it('200 mixed catalog → controls distributed across multiple energy buckets', async () => {
    const electricControl = {
      id: 'elec-eng-loto',
      riskCategory: 'electric',
      label: 'LOTO instalado',
      level: 'engineering' as const,
      verificationMethod: 'visual' as const,
      normReference: 'DS 132',
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ catalog: [minControl, electricControl] });
    expect(res.status).toBe(200);
    const { grouped } = res.body as { grouped: Record<string, { id: string }[]> };
    expect(grouped.gravity).toHaveLength(1);
    expect(grouped.electric).toHaveLength(1);
    expect(grouped.electric[0].id).toBe('elec-eng-loto');
  });
});
