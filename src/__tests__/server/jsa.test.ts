// Real-router supertest for src/server/routes/jsa.ts
// (Plan v3 Fase 1 — Job Safety Analysis, 3 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. All three endpoints are
// POST /:projectId/jsa/<sub-path> behind verifyAuth + validate(zodSchema) +
// guard(assertProjectMember). We seed `projects/<id>` in fakeFirestore so
// assertProjectMember passes, then drive every status code the route can emit:
// 401 (no token), 400 (schema fail from validate()), 403 (project guard),
// 200 happy path, and the finalize-specific 400 (JsaFinalizationError).
//
// z.unknown() probe — draftSchema = z.unknown(), so the outer validate()
// middleware ALWAYS passes (any value satisfies z.unknown()). The engine
// functions themselves throw when the draft is malformed. For validate and
// compute-residual-risks that surfaces as a 500; finalize throws
// JsaFinalizationError which the handler catches and maps to 400. See the
// "z.unknown() missing-field probe" describe blocks for pinned behavior.

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

import jsaRouter from '../../server/routes/jsa.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', jsaRouter);
  return app;
}

const PROJECT_ID = 'p-jsa-test';
const AUTHOR_UID = 'uid-jsa-author';
const APPROVER_UID = 'uid-jsa-approver'; // must differ from authorUid

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'JSA Test Project',
    members: [AUTHOR_UID, APPROVER_UID],
    createdBy: AUTHOR_UID,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable minimal-valid JsaDraft fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A fully valid draft that passes validateJsa() without any issues. */
const validDraft = {
  id: 'jsa-uuid-001',
  projectId: PROJECT_ID,
  taskTitle: 'Cambio de tubería sector NW',
  location: 'Túnel 4',
  authorUid: AUTHOR_UID,
  createdAt: '2026-05-30T10:00:00.000Z',
  steps: [
    {
      order: 1,
      description: 'Aislar circuito eléctrico antes del trabajo',
      hazards: [
        {
          id: 'h1',
          description: 'Choque eléctrico',
          probability: 2 as const,
          severity: 4 as const,
          controls: [
            {
              level: 'engineering' as const,
              description: 'Instalar LOTO en tablero principal',
            },
          ],
        },
      ],
    },
    {
      order: 2,
      description: 'Retirar tubería dañada con herramientas manuales',
      hazards: [
        {
          id: 'h2',
          description: 'Caída de herramienta',
          probability: 2 as const,
          severity: 2 as const,
          controls: [
            {
              level: 'engineering' as const,
              description: 'Baranda perimetral instalada en zona de trabajo',
            },
            {
              level: 'epp' as const,
              description: 'Casco y guantes de trabajo homologados',
            },
          ],
        },
      ],
    },
  ],
};

/** Draft where authorUid === approverUid → finalize throws APPROVER_SAME_AS_AUTHOR */
const sameAuthorApproverDraft = {
  ...validDraft,
  authorUid: APPROVER_UID, // caller will be APPROVER_UID, so same person
};

/** Valid hash hex (64 lowercase hex chars) */
const VALID_HASH = 'a'.repeat(64);

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/jsa/validate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/jsa/validate', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/jsa/validate`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ draft: validDraft });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing draft entirely — z.record rejects undefined', async () => {
    // Fixed: z.record(z.string(), z.unknown()) requires an object, so a missing
    // "draft" key is rejected by validate() with 400 before reaching the engine.
    // See src/server/routes/jsa.ts line ~70 and ~76-78.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({}); // no `draft` key — z.record rejects undefined → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ draft: validDraft });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/jsa/validate`)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: validDraft });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns a valid result for a well-formed draft', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: validDraft });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(typeof result.valid).toBe('boolean');
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(typeof result.completenessPct).toBe('number');
    expect(result.completenessPct).toBe(100);
  });

  it('200 returns valid=false with blocking issues for a draft with no steps', async () => {
    const emptyStepsDraft = {
      ...validDraft,
      steps: [],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: emptyStepsDraft });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.valid).toBe(false);
    const issues = result.issues as Array<{ severity: string; code: string }>;
    expect(issues.some((i) => i.code === 'NO_STEPS' && i.severity === 'blocking')).toBe(true);
    expect(result.completenessPct).toBe(0);
  });

  it('200 returns blocking issue TASK_TITLE_TOO_SHORT for a short taskTitle', async () => {
    const shortTitleDraft = {
      ...validDraft,
      taskTitle: 'Hi', // < 5 chars
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: shortTitleDraft });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.valid).toBe(false);
    const issues = result.issues as Array<{ code: string }>;
    expect(issues.some((i) => i.code === 'TASK_TITLE_TOO_SHORT')).toBe(true);
  });

  it('200 returns advisory CONTROLS_LOW_HIERARCHY when step only has epp controls', async () => {
    const eppOnlyDraft = {
      ...validDraft,
      steps: [
        {
          order: 1,
          description: 'Revisar equipos de altura con arnés',
          hazards: [
            {
              id: 'h1',
              description: 'Caída en altura',
              probability: 3 as const,
              severity: 5 as const,
              controls: [{ level: 'epp' as const, description: 'Arnés de seguridad homologado' }],
            },
          ],
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: eppOnlyDraft });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    // valid=true (no blocking issues), but advisory present
    expect(result.valid).toBe(true);
    const issues = result.issues as Array<{ severity: string; code: string }>;
    expect(issues.some((i) => i.code === 'CONTROLS_LOW_HIERARCHY' && i.severity === 'advisory')).toBe(true);
  });

  // ── z.unknown() missing-field probe ──────────────────────────────────────
  // draftSchema = z.unknown() wrapping z.object(...) is not used here; the
  // OUTER schema is z.object({ draft: draftSchema }). Since draftSchema accepts
  // ANY value, sending draft: null (or draft: 42) passes validate(). The engine
  // `validateJsa(null)` then throws a TypeError (cannot read properties of null)
  // which the handler's catch-all returns as 500.
  //
  // BUG: src/server/routes/jsa.ts line ~90 — the catch block at the handler
  // (lines 90-96) maps all non-JsaFinalizationError throws to 500. Because
  // draftSchema = z.unknown(), a null/empty draft bypasses validate() and
  // reaches the engine where it crashes. Result: 500 instead of 400.
  it('400 when draft is null — z.record rejects non-object instead of crashing engine', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: null }); // z.record rejects null → 400 before engine
    // Fixed: z.record(z.string(), z.unknown()) requires an object; null is
    // rejected by validate() at src/server/routes/jsa.ts:90-96 → 400 not 500.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/jsa/compute-residual-risks
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/jsa/compute-residual-risks', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/jsa/compute-residual-risks`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ draft: validDraft });
    expect(res.status).toBe(401);
  });

  it('400 when body is missing draft entirely — z.record rejects undefined', async () => {
    // Fixed: same z.record fix as /validate — missing "draft" key is rejected
    // by validate() before computeResidualRisks is called → 400 not 500.
    // See src/server/routes/jsa.ts line ~70 and ~104-106.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ draft: validDraft });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns risks array and overallClass for a valid draft', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: validDraft });
    expect(res.status).toBe(200);
    const body = res.body as { risks: unknown[]; overallClass: string };
    expect(Array.isArray(body.risks)).toBe(true);
    // validDraft has 2 steps with 1 hazard each → 2 risks
    expect(body.risks).toHaveLength(2);
    expect(['low', 'medium', 'high', 'critical']).toContain(body.overallClass);
  });

  it('200 engineering LOTO control reduces electric hazard risk (×0.4 multiplier)', async () => {
    // step: probability=4, severity=5 → initial=20; engineering ×0.4 → residual=8 → 'medium'
    const highRiskDraft = {
      ...validDraft,
      steps: [
        {
          order: 1,
          description: 'Trabajar en tablero eléctrico de alta tensión',
          hazards: [
            {
              id: 'elec-1',
              description: 'Choque eléctrico grave',
              probability: 4 as const,
              severity: 5 as const,
              controls: [{ level: 'engineering' as const, description: 'LOTO y verificador de tensión' }],
            },
          ],
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: highRiskDraft });
    expect(res.status).toBe(200);
    const risks = res.body.risks as Array<{
      hazardId: string;
      initialScore: number;
      residualScore: number;
      residualClass: string;
    }>;
    expect(risks).toHaveLength(1);
    expect(risks[0]!.hazardId).toBe('elec-1');
    expect(risks[0]!.initialScore).toBe(20); // 4×5
    expect(risks[0]!.residualScore).toBe(8); // round(20 × 0.4)
    expect(risks[0]!.residualClass).toBe('medium'); // 8 is in [4,9) → medium
  });

  it('200 elimination control → residualScore=0, overallClass=low', async () => {
    const elimDraft = {
      ...validDraft,
      steps: [
        {
          order: 1,
          description: 'Reemplazar proceso peligroso por uno automatizado',
          hazards: [
            {
              id: 'h-elim',
              description: 'Exposición a sustancia corrosiva',
              probability: 3 as const,
              severity: 3 as const,
              controls: [{ level: 'elimination' as const, description: 'Automatizar proceso elimina exposición' }],
            },
          ],
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: elimDraft });
    expect(res.status).toBe(200);
    const risks = res.body.risks as Array<{ residualScore: number; residualClass: string }>;
    expect(risks[0]!.residualScore).toBe(0);
    expect(risks[0]!.residualClass).toBe('low');
    expect(res.body.overallClass).toBe('low');
  });

  it('200 empty steps draft → empty risks array, overallClass=low', async () => {
    const noStepsDraft = { ...validDraft, steps: [] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: noStepsDraft });
    expect(res.status).toBe(200);
    expect(res.body.risks).toEqual([]);
    expect(res.body.overallClass).toBe('low');
  });

  it('200 critical risk when probability=5, severity=5, only epp control', async () => {
    // initial=25; epp ×0.9 → residual=round(22.5)=23 → 'critical' (≥17)
    const critDraft = {
      ...validDraft,
      steps: [
        {
          order: 1,
          description: 'Operar maquinaria pesada sin supervisión directa',
          hazards: [
            {
              id: 'h-crit',
              description: 'Aplastamiento por equipo pesado',
              probability: 5 as const,
              severity: 5 as const,
              controls: [{ level: 'epp' as const, description: 'Casco y chaleco reflectante solo' }],
            },
          ],
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: critDraft });
    expect(res.status).toBe(200);
    const risks = res.body.risks as Array<{ residualScore: number; residualClass: string }>;
    expect(risks[0]!.residualScore).toBe(23); // round(25 × 0.9)
    expect(risks[0]!.residualClass).toBe('critical');
    expect(res.body.overallClass).toBe('critical');
  });

  // ── z.unknown() missing-field probe ──────────────────────────────────────
  // Same anti-pattern as /validate — null draft passes z.unknown(), engine crashes → 500.
  it('400 when draft is null — z.record rejects non-object instead of crashing engine', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', AUTHOR_UID)
      .send({ draft: null });
    // Fixed: z.record(z.string(), z.unknown()) rejects null at src/server/routes/jsa.ts:118-126;
    // computeResidualRisks is never reached → 400 instead of 500.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/jsa/finalize
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/jsa/finalize', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/jsa/finalize`;

  const validFinalizeBody = {
    draft: validDraft,
    signedAtIso: '2026-05-30T12:00:00.000Z',
    signatureHashHex: VALID_HASH,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send(validFinalizeBody);
    expect(res.status).toBe(401);
  });

  it('400 when signatureHashHex is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: validDraft }); // missing signatureHashHex
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when signatureHashHex is not a valid hex string (< 64 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: validDraft, signatureHashHex: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when body is missing draft — z.record rejects undefined before engine', async () => {
    // Fixed: z.record(z.string(), z.unknown()) requires an object; missing "draft"
    // is rejected by validate() → 400 instead of TypeError → 500.
    // See src/server/routes/jsa.ts line ~70 and ~133-135.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ signatureHashHex: VALID_HASH }); // no draft key → z.record rejects → 400
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(validFinalizeBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns a finalized JSA for a valid draft (approver ≠ author)', async () => {
    // APPROVER_UID is a member; validDraft.authorUid = AUTHOR_UID ≠ APPROVER_UID
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send(validFinalizeBody);
    expect(res.status).toBe(200);
    const { jsa } = res.body as { jsa: Record<string, unknown> };
    expect(jsa.status).toBe('signed');
    // Server-side override: approverUid must be callerUid (APPROVER_UID), not draft.authorUid
    expect(jsa.approverUid).toBe(APPROVER_UID);
    expect(jsa.signedAt).toBe('2026-05-30T12:00:00.000Z');
    expect(jsa.signatureHashHex).toBe(VALID_HASH);
    expect(Array.isArray(jsa.residualRisks)).toBe(true);
    expect(['low', 'medium', 'high', 'critical']).toContain(jsa.overallResidualClass);
  });

  it('200 uses server timestamp when signedAtIso is omitted', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: validDraft, signatureHashHex: VALID_HASH });
    expect(res.status).toBe(200);
    const { jsa } = res.body as { jsa: Record<string, unknown> };
    expect(jsa.status).toBe('signed');
    // signedAt should be a parseable ISO string (server-generated fallback)
    expect(typeof jsa.signedAt).toBe('string');
    expect(() => new Date(jsa.signedAt as string).toISOString()).not.toThrow();
  });

  it('400 with JsaFinalizationError code VALIDATION_FAILED when draft has blocking issues', async () => {
    // Draft with no steps fails validateJsa() → VALIDATION_FAILED
    const badDraft = { ...validDraft, steps: [] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: badDraft, signatureHashHex: VALID_HASH });
    expect(res.status).toBe(400);
    const body = res.body as { error: string; code: string };
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('400 with JsaFinalizationError code APPROVER_SAME_AS_AUTHOR when caller is the author', async () => {
    // sameAuthorApproverDraft has authorUid = APPROVER_UID, caller is APPROVER_UID
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: sameAuthorApproverDraft, signatureHashHex: VALID_HASH });
    expect(res.status).toBe(400);
    const body = res.body as { error: string; code: string };
    expect(body.code).toBe('APPROVER_SAME_AS_AUTHOR');
  });

  // ── z.unknown() missing-field probe (finalize) ────────────────────────────
  // null draft passes z.unknown(). finalize() calls validateJsa(null) which
  // throws a TypeError (accessing .taskTitle on null). However the handler's
  // first catch branch checks `instanceof JsaFinalizationError` — TypeError is
  // NOT a JsaFinalizationError, so it falls through to the else block → 500.
  //
  // Note: if finalize() somehow threw a JsaFinalizationError on null input
  // this would be a 400; but the current code path throws TypeError → 500.
  it('400 when draft is null — z.record rejects non-object before finalize engine', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', APPROVER_UID)
      .send({ draft: null, signatureHashHex: VALID_HASH });
    // Fixed: z.record(z.string(), z.unknown()) rejects null at src/server/routes/jsa.ts:148-164;
    // finalize() is never called → 400 instead of TypeError → 500.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});
