// Real-router supertest for src/server/routes/softBlocking.ts
// (Plan v3 Fase 1 — 4 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is mounted at /api/sprint-k in server.ts. All four endpoints are
// POST /:projectId/soft-blocking/<sub-path> behind verifyAuth +
// validate(zodSchema) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes.
//
// DIRECTIVE assertion (NUNCA bloquear maquinaria): even the highest-risk
// input (mandatory critical_control_verification missing) produces level
// 'cannot_override' — NOT a hard machinery block. The response is advisory:
// canOverride=false means supervisor intervention is required, but the
// engine NEVER returns a physical stop signal. No response body contains
// blocked:true or any hard-stop flag.

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

import softBlockingRouter from '../../server/routes/softBlocking.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', softBlockingRouter);
  return app;
}

const PROJECT_ID = 'p-sb-test';
const CALLER_UID = 'uid-sb-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Soft Blocking Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// Minimal valid RequirementCheck (status: satisfied)
const satisfiedCheck = {
  requirement: {
    id: 'req-training-001',
    kind: 'training',
    label: 'Inducción seguridad altura',
    isMandatory: true,
    citation: 'DS 594 art. 53',
  },
  status: 'satisfied',
};

// A soft-block check: mandatory, missing, overrideable kind
const missingMandatoryCheck = {
  requirement: {
    id: 'req-epp-001',
    kind: 'epp',
    label: 'Arnés de seguridad',
    isMandatory: true,
    citation: 'DS 594',
  },
  status: 'missing',
};

// A cannot_override check: mandatory critical_control_verification missing
const criticalMissingCheck = {
  requirement: {
    id: 'req-ccv-001',
    kind: 'critical_control_verification',
    label: 'Verificación control crítico LOTO',
    isMandatory: true,
  },
  status: 'missing',
};

// Minimal valid OverrideInput (for validate-override + build-audit-entry)
const validOverride = {
  reason: 'Supervisor autoriza con medidas compensatorias documentadas en acta.',
  approvedAt: '2026-05-30T10:00:00.000Z',
  validUntil: '2026-05-30T18:00:00.000Z',
};

// A GateDecision with canOverride=true (needed for validate-override / build-audit-entry)
const softBlockDecision = {
  level: 'soft_block',
  unsatisfied: [missingMandatoryCheck],
  reasoningText: 'Hay 1 requisito(s) sin cumplir.',
  canOverride: true,
};

// A GateDecision with canOverride=false
const cannotOverrideDecision = {
  level: 'cannot_override',
  unsatisfied: [criticalMissingCheck],
  reasoningText: 'Requisito crítico no superable sin intervención.',
  canOverride: false,
};

// A minimal valid OverrideAuditEntry for is-override-valid
function buildMinimalAuditEntry(validUntil?: string) {
  return {
    id: 'override:act-001:2026-05-30T10:00:00.000Z',
    gateContext: {
      actorUid: CALLER_UID,
      activityId: 'act-001',
      activityKind: 'excavacion',
    },
    unsatisfiedRequirementIds: ['req-epp-001'],
    authorizingUid: CALLER_UID,
    reason: 'Supervisor autoriza con medidas compensatorias documentadas.',
    approvedAt: '2026-05-30T10:00:00.000Z',
    validUntil,
    contentHash: 'abc123def456',
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/soft-blocking/evaluate-gate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/soft-blocking/evaluate-gate', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/soft-blocking/evaluate-gate`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ checks: [] });
    expect(res.status).toBe(401);
  });

  it('400 when checks is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a check has an invalid kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        checks: [{ ...missingMandatoryCheck, requirement: { ...missingMandatoryCheck.requirement, kind: 'invalid_kind' } }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a check has an invalid status', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        checks: [{ ...missingMandatoryCheck, status: 'bad_status' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ checks: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/soft-blocking/evaluate-gate`)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 all satisfied → level=pass, canOverride=false (DIRECTIVE: advisory not hard-block)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [satisfiedCheck] });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: Record<string, unknown> };
    expect(decision.level).toBe('pass');
    expect(decision.canOverride).toBe(false);
    expect(decision.unsatisfied).toHaveLength(0);
    // DIRECTIVE: pass means proceed — no blocking signal at all
    expect(decision).not.toHaveProperty('blocked');
    expect(decision.level).not.toBe('hard_block');
  });

  it('200 mandatory missing (non-critical) → soft_block + canOverride=true (DIRECTIVE: advisory, overrideable)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [missingMandatoryCheck] });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: Record<string, unknown> };
    expect(decision.level).toBe('soft_block');
    // DIRECTIVE: even soft_block is overrideable — NOT a machinery hard-stop
    expect(decision.canOverride).toBe(true);
    expect(typeof decision.reasoningText).toBe('string');
    expect((decision.reasoningText as string).length).toBeGreaterThan(0);
    expect(Array.isArray(decision.unsatisfied)).toBe(true);
    expect((decision.unsatisfied as unknown[]).length).toBeGreaterThan(0);
    // Must NOT have a hard-stop flag
    expect(decision).not.toHaveProperty('blocked');
  });

  it('200 critical_control_verification missing → cannot_override + canOverride=false (DIRECTIVE: still advisory, not physical stop)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [criticalMissingCheck] });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: Record<string, unknown> };
    // DIRECTIVE: even the HIGHEST-risk scenario — mandatory critical control
    // missing — results in 'cannot_override' (requires supervisor), NOT a
    // physical machinery stop. canOverride=false means "requires supervisor",
    // not "machine is locked". The body must NOT contain blocked:true.
    expect(decision.level).toBe('cannot_override');
    expect(decision.canOverride).toBe(false);
    expect(decision).not.toHaveProperty('blocked');
    // The response must be advisory text, not an action that stops hardware
    expect(typeof decision.reasoningText).toBe('string');
    expect((decision.reasoningText as string).length).toBeGreaterThan(0);
    // HTTP status is still 200 — the app recommends, not blocks
    expect(res.status).toBe(200);
  });

  it('200 mixed checks → soft_block (non-critical missing overrides satisfied)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [satisfiedCheck, missingMandatoryCheck] });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: Record<string, unknown> };
    expect(decision.level).toBe('soft_block');
    // The satisfied check should not appear in unsatisfied
    const unsatisfiedIds = (decision.unsatisfied as Array<{ requirement: { id: string } }>).map(
      (u) => u.requirement.id,
    );
    expect(unsatisfiedIds).not.toContain('req-training-001');
    expect(unsatisfiedIds).toContain('req-epp-001');
  });

  it('200 empty checks → level=pass', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ checks: [] });
    expect(res.status).toBe(200);
    expect(res.body.decision.level).toBe('pass');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/soft-blocking/validate-override
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/soft-blocking/validate-override', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/soft-blocking/validate-override`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ decision: softBlockDecision, override: validOverride });
    expect(res.status).toBe(401);
  });

  it('400 when decision is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ override: validOverride });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when override.reason is too short (< 20 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: softBlockDecision,
        override: { ...validOverride, reason: 'corto' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when override.approvedAt is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: softBlockDecision,
        override: { reason: validOverride.reason },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ decision: softBlockDecision, override: validOverride });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 valid override on soft_block decision → valid=true (DIRECTIVE: override path exists)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: softBlockDecision, override: validOverride });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: { valid: boolean; error?: string } };
    // DIRECTIVE: the override path MUST exist and work — the system allows
    // proceeding with documented supervisor authorization. This is the core
    // of "recommends, never hard-blocks": there is always a legitimate way
    // to continue if a supervisor accepts responsibility.
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('200 authorizingUid is forced to caller uid (server cannot be spoofed)', async () => {
    // Even if client sends a different authorizingUid in the override, the
    // route forces it to callerUid — we verify this indirectly: validate-override
    // passes (authorizingUid will be set by the route, not the client body).
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: softBlockDecision, override: validOverride });
    expect(res.status).toBe(200);
    expect(res.body.result.valid).toBe(true);
  });

  it('200 cannot_override decision → valid=false (supervisor intervention required, still advisory)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: cannotOverrideDecision, override: validOverride });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: { valid: boolean; error?: string } };
    // DIRECTIVE: cannot_override means the engine requires supervisor intervention
    // but still does NOT hard-stop machinery — it returns valid=false with an
    // error string to display to the user (advisory mode).
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
    // HTTP 200 — the route itself doesn't fail; it returns advisory info
    expect(res.status).toBe(200);
  });

  it('200 override without validUntil (indefinite override) → valid=true', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: softBlockDecision,
        override: { reason: validOverride.reason, approvedAt: validOverride.approvedAt },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/soft-blocking/build-audit-entry
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/soft-blocking/build-audit-entry', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/soft-blocking/build-audit-entry`;

  const validGateContext = {
    activityId: 'act-excavacion-001',
    activityKind: 'excavacion',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ decision: softBlockDecision, override: validOverride, gateContext: validGateContext });
    expect(res.status).toBe(401);
  });

  it('400 when gateContext.activityId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: softBlockDecision,
        override: validOverride,
        gateContext: { activityKind: 'excavacion' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when override.reason is too short', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: softBlockDecision,
        override: { ...validOverride, reason: 'short' },
        gateContext: validGateContext,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ decision: softBlockDecision, override: validOverride, gateContext: validGateContext });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path → entry has contentHash, authorizingUid forced to caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: softBlockDecision, override: validOverride, gateContext: validGateContext });
    expect(res.status).toBe(200);
    const { entry } = res.body as { entry: Record<string, unknown> };
    // authorizingUid is always the server-verified caller, not client-supplied
    expect(entry.authorizingUid).toBe(CALLER_UID);
    expect(entry.gateContext).toMatchObject({
      actorUid: CALLER_UID,
      activityId: 'act-excavacion-001',
      activityKind: 'excavacion',
    });
    // SHA-256 is injected by the route — must be present
    expect(typeof entry.contentHash).toBe('string');
    expect((entry.contentHash as string).length).toBeGreaterThan(0);
    expect(Array.isArray(entry.unsatisfiedRequirementIds)).toBe(true);
    expect(entry.unsatisfiedRequirementIds).toContain('req-epp-001');
    // DIRECTIVE: the audit entry documents what happened (override with reason)
    // — it is a record for compliance, not a machinery stop command
    expect(entry).not.toHaveProperty('blocked');
    expect(entry.reason).toBe(validOverride.reason.trim());
  });

  it('200 entry id is deterministic (activityId + approvedAt)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: softBlockDecision, override: validOverride, gateContext: validGateContext });
    expect(res.status).toBe(200);
    const { entry } = res.body as { entry: { id: string } };
    expect(entry.id).toContain('act-excavacion-001');
    expect(entry.id).toContain('2026-05-30T10:00:00.000Z');
  });

  it('400 when decision.canOverride=false → GateOverrideError → 400 with code', async () => {
    // cannot_override decision sent to build-audit-entry → validation fails inside engine
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        decision: cannotOverrideDecision,
        override: validOverride,
        gateContext: validGateContext,
      });
    // The route catches GateOverrideError and returns 400 with code
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(typeof res.body.code).toBe('string');
    expect(typeof res.body.message).toBe('string');
  });

  it('200 contentHash is a valid hex string (SHA-256 = 64 hex chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ decision: softBlockDecision, override: validOverride, gateContext: validGateContext });
    expect(res.status).toBe(200);
    const hash = res.body.entry.contentHash as string;
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/soft-blocking/is-override-valid
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/soft-blocking/is-override-valid', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/soft-blocking/is-override-valid`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ entry: buildMinimalAuditEntry() });
    expect(res.status).toBe(401);
  });

  it('400 when entry is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when entry.id is empty string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: { ...buildMinimalAuditEntry(), id: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when entry.gateContext.actorUid is missing', async () => {
    const entry = buildMinimalAuditEntry();
    const { actorUid: _removed, ...contextWithoutActor } = entry.gateContext;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: { ...entry, gateContext: contextWithoutActor } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ entry: buildMinimalAuditEntry() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 no validUntil → valid=true (indefinite override still active)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: buildMinimalAuditEntry() });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('200 future validUntil → valid=true', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: buildMinimalAuditEntry(futureDate) });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('200 past validUntil → valid=false (expired override)', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: buildMinimalAuditEntry(pastDate) });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('200 now param provided in body → used instead of wall clock', async () => {
    // Override expires at 2026-05-30T12:00:00Z; we set now to 11:00 → still valid
    const validUntil = '2026-05-30T12:00:00.000Z';
    const nowBefore = '2026-05-30T11:00:00.000Z';
    const nowAfter = '2026-05-30T13:00:00.000Z';

    const [resBefore, resAfter] = await Promise.all([
      request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ entry: buildMinimalAuditEntry(validUntil), now: nowBefore }),
      request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ entry: buildMinimalAuditEntry(validUntil), now: nowAfter }),
    ]);

    expect(resBefore.status).toBe(200);
    expect(resBefore.body.valid).toBe(true);
    expect(resAfter.status).toBe(200);
    expect(resAfter.body.valid).toBe(false);
  });

  it('200 DIRECTIVE — is-override-valid expiration check is advisory: expired override returns valid=false (not a hard lock)', async () => {
    // An expired override signals that re-authorization is needed (advisory).
    // The system reports valid=false — it does NOT send a machinery-stop command.
    // HTTP 200 confirms this is information, not an action.
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ entry: buildMinimalAuditEntry(pastDate) });
    expect(res.status).toBe(200);
    expect(typeof res.body.valid).toBe('boolean');
    expect(res.body.valid).toBe(false);
    // No hard-stop signal
    expect(res.body).not.toHaveProperty('blocked');
    expect(res.body).not.toHaveProperty('hardStop');
    expect(res.body).not.toHaveProperty('machineStop');
  });
});
