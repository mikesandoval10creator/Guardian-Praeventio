// Real-router supertest for src/server/routes/aiQuality.ts.
//
// Sprint K §G.4 / Plan v3 Fase 1 — 6 endpoints, 0 → covered.
//
// Key directive: AI is a SUGGESTION / human-in-the-loop. Tests assert that
//   • blacklisted kinds (work_approval, medical_triage, emergency_response)
//     are BLOCKED unless a human decision is recorded (never auto-actioned).
//   • logAiResponse always sets presentedAsSuggestion=true (engine guarantee).
//   • The summarize endpoint returns a quality report for human review, not
//     an autonomous safety decision.
//
// No real LLM is called — aiAuditLog.ts is a pure in-memory module (no
// network), so we import it directly rather than mocking it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { AiAuditEntry } from '../../services/aiQuality/aiAuditLog.js';

// ── hoisted db holder ──────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin → fakeFirestore ─────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth → x-test-uid header ─────────────────────────────────────────
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

// ── observability ──────────────────────────────────────────────────────────
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── logger ─────────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── imports (after mocks) ──────────────────────────────────────────────────
import aiQualityRouter from '../../server/routes/aiQuality.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── app factory ────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', aiQualityRouter);
  return app;
}

// ── helpers ────────────────────────────────────────────────────────────────
const PROJECT = 'proj-1';
const CALLER = 'uid-member-1';

/** Seed a project so assertProjectMember passes. */
function seedProject(db: ReturnType<typeof createFakeFirestore>, projectId = PROJECT, uid = CALLER) {
  db._seed(`projects/${projectId}`, { members: [uid], createdBy: uid });
}

/** Minimal valid AiAuditEntry accepted by mutator endpoints. */
const baseEntry: AiAuditEntry = {
  id: 'entry-1',
  timestamp: new Date().toISOString(),
  source: 'gemini',
  kind: 'risk_assessment',
  prompt: 'Evalúa el riesgo de la tarea X',
  response: 'Riesgo alto por exposición a ruido > 85 dB.',
  recipientUid: CALLER,
  recipientRole: 'trabajador',
  presentedAsSuggestion: true,
};

const LOG_URL = `/api/sprint-k/${PROJECT}/ai-quality/log-response`;
const GATE_URL = `/api/sprint-k/${PROJECT}/ai-quality/assert-human-gated`;
const DECISION_URL = `/api/sprint-k/${PROJECT}/ai-quality/record-human-decision`;
const OVERRIDE_URL = `/api/sprint-k/${PROJECT}/ai-quality/record-override`;
const RATE_URL = `/api/sprint-k/${PROJECT}/ai-quality/rate-entry`;
const SUMMARIZE_URL = `/api/sprint-k/${PROJECT}/ai-quality/summarize`;

const validLogBody = {
  id: 'entry-1',
  source: 'gemini',
  kind: 'risk_assessment',
  prompt: 'Evalúa exposición a ruido en turno A.',
  response: 'La exposición supera DS 594 art. 82 — se recomienda EPP auditivo nivel 3.',
  recipientRole: 'supervisor',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ══════════════════════════════════════════════════════════════════════════
// 1. log-response
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/log-response', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(LOG_URL).send(validLogBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    // Non-member uid — project doc exists but uid not in members[]
    const app = buildApp();
    const res = await request(app)
      .post(LOG_URL)
      .set('x-test-uid', 'outsider-uid')
      .send(validLogBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 when required fields are missing', async () => {
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ source: 'gemini' }); // missing id, kind, prompt, response, recipientRole
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when source enum is invalid', async () => {
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validLogBody, source: 'openai' }); // not in AI_SOURCES
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when kind enum is invalid', async () => {
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validLogBody, kind: 'DIAGNOSE_DISEASE' }); // banned
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns an AiAuditEntry with presentedAsSuggestion=true (AI is suggestion only)', async () => {
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send(validLogBody);
    expect(res.status).toBe(200);
    expect(res.body.entry).toBeDefined();
    const entry: AiAuditEntry = res.body.entry;
    // Core fields echoed back.
    expect(entry.id).toBe(validLogBody.id);
    expect(entry.source).toBe('gemini');
    expect(entry.kind).toBe('risk_assessment');
    expect(entry.recipientRole).toBe('supervisor');
    // Server stamps caller uid — ignores any client-supplied recipientUid.
    expect(entry.recipientUid).toBe(CALLER);
    // DIRECTIVE: AI is ALWAYS a suggestion — never autonomous.
    expect(entry.presentedAsSuggestion).toBe(true);
    // Timestamp is an ISO string.
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it('200 forces recipientUid to caller uid even if body contained different value', async () => {
    // body has no recipientUid field (schema strips it), route stamps callerUid.
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validLogBody, recipientUid: 'evil-uid' }); // should be ignored
    expect(res.status).toBe(200);
    expect(res.body.entry.recipientUid).toBe(CALLER);
  });

  it('200 for a blacklisted kind (work_approval) — entry recorded as suggestion, NOT executed', async () => {
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validLogBody, kind: 'work_approval' });
    expect(res.status).toBe(200);
    // Even for a blacklisted kind, the entry is a suggestion for human review.
    expect(res.body.entry.presentedAsSuggestion).toBe(true);
    expect(res.body.entry.kind).toBe('work_approval');
  });

  it('200 accepts optional contextDigest + now fields', async () => {
    const now = new Date('2025-06-01T10:00:00Z').toISOString();
    const res = await request(buildApp())
      .post(LOG_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validLogBody, contextDigest: 'sha256-abc', now });
    expect(res.status).toBe(200);
    expect(res.body.entry.timestamp).toBe(now);
    expect(res.body.entry.contextDigest).toBe('sha256-abc');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. assert-human-gated
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/assert-human-gated', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .send({ kind: 'risk_assessment' });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', 'outsider-uid')
      .send({ kind: 'risk_assessment' });
    expect(res.status).toBe(403);
  });

  it('400 when kind field is missing', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 ok:true for a non-blacklisted kind (risk_assessment has no gate)', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'risk_assessment' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 ok:true for epp_suggestion (non-blacklisted)', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'epp_suggestion' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('400 BlacklistedAiActionError when work_approval has no humanDecision (AI cannot auto-approve)', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'work_approval' }); // no humanDecision → blocked
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BLACKLISTED/i);
    expect(res.body.error).toMatch(/work_approval/i);
  });

  it('400 BlacklistedAiActionError when medical_triage has no humanDecision', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'medical_triage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BLACKLISTED/i);
  });

  it('400 BlacklistedAiActionError when emergency_response has no humanDecision', async () => {
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'emergency_response' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BLACKLISTED/i);
  });

  it('400 even when humanDecision.followed=false (human did NOT authorise the action)', async () => {
    const humanDecision = { followed: false, decidedAt: new Date().toISOString() };
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'work_approval', humanDecision });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BLACKLISTED/i);
  });

  it('200 ok:true for work_approval when human followed=true (human authorised)', async () => {
    const humanDecision = { followed: true, decidedAt: new Date().toISOString() };
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'work_approval', humanDecision });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 ok:true for emergency_response when human followed=true', async () => {
    const humanDecision = { followed: true, decidedAt: new Date().toISOString() };
    const res = await request(buildApp())
      .post(GATE_URL)
      .set('x-test-uid', CALLER)
      .send({ kind: 'emergency_response', humanDecision });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. record-human-decision
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/record-human-decision', () => {
  const validDecision = {
    followed: true,
    decidedAt: new Date().toISOString(),
  };

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(DECISION_URL)
      .send({ entry: baseEntry, decision: validDecision });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', 'outsider-uid')
      .send({ entry: baseEntry, decision: validDecision });
    expect(res.status).toBe(403);
  });

  it('400 when decision field is missing', async () => {
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry }); // no decision
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when decision.decidedAt is missing', async () => {
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, decision: { followed: true } }); // no decidedAt
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 attaches the human decision to the entry', async () => {
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, decision: validDecision });
    expect(res.status).toBe(200);
    expect(res.body.entry).toBeDefined();
    const entry: AiAuditEntry = res.body.entry;
    expect(entry.humanDecision).toBeDefined();
    expect(entry.humanDecision!.followed).toBe(true);
    expect(entry.humanDecision!.decidedAt).toBe(validDecision.decidedAt);
    // Original fields preserved.
    expect(entry.id).toBe(baseEntry.id);
    expect(entry.kind).toBe(baseEntry.kind);
  });

  it('200 records a followed=false decision with optional overrideReason', async () => {
    const decision = {
      followed: false,
      overrideReason: 'La evaluación de riesgo no consideró el contexto local.',
      decidedAt: new Date().toISOString(),
    };
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, decision });
    expect(res.status).toBe(200);
    expect(res.body.entry.humanDecision!.followed).toBe(false);
    expect(res.body.entry.humanDecision!.overrideReason).toBe(decision.overrideReason);
  });

  it('200 accepts optional actionAuditId field', async () => {
    const decision = {
      followed: true,
      decidedAt: new Date().toISOString(),
      actionAuditId: 'audit-log-xyz',
    };
    const res = await request(buildApp())
      .post(DECISION_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, decision });
    expect(res.status).toBe(200);
    expect(res.body.entry.humanDecision!.actionAuditId).toBe('audit-log-xyz');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. record-override
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/record-override', () => {
  const validOverrideBody = {
    entry: baseEntry,
    overrideReason: 'La sugerencia no contempló condiciones climáticas del día.',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(OVERRIDE_URL).send(validOverrideBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(OVERRIDE_URL)
      .set('x-test-uid', 'outsider-uid')
      .send(validOverrideBody);
    expect(res.status).toBe(403);
  });

  it('400 when overrideReason is missing', async () => {
    const res = await request(buildApp())
      .post(OVERRIDE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when overrideReason is too short (< 10 chars) — Zod rejects before handler', async () => {
    const res = await request(buildApp())
      .post(OVERRIDE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, overrideReason: 'corto' }); // 5 chars
    expect(res.status).toBe(400);
  });

  it('200 returns entry with humanDecision.followed=false and the override reason', async () => {
    const res = await request(buildApp())
      .post(OVERRIDE_URL)
      .set('x-test-uid', CALLER)
      .send(validOverrideBody);
    expect(res.status).toBe(200);
    expect(res.body.entry).toBeDefined();
    const entry: AiAuditEntry = res.body.entry;
    expect(entry.humanDecision).toBeDefined();
    expect(entry.humanDecision!.followed).toBe(false);
    expect(entry.humanDecision!.overrideReason).toBe(validOverrideBody.overrideReason);
    // decidedAt must be an ISO timestamp
    expect(() => new Date(entry.humanDecision!.decidedAt)).not.toThrow();
  });

  it('200 accepts an explicit now timestamp for the override', async () => {
    const now = '2025-08-15T14:30:00.000Z';
    const res = await request(buildApp())
      .post(OVERRIDE_URL)
      .set('x-test-uid', CALLER)
      .send({ ...validOverrideBody, now });
    expect(res.status).toBe(200);
    expect(res.body.entry.humanDecision!.decidedAt).toBe(now);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. rate-entry (reviewerUid forced from caller)
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/rate-entry', () => {
  const validRateBody = {
    entry: baseEntry,
    rating: { verdict: 'useful' as const },
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(RATE_URL).send(validRateBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', 'outsider-uid')
      .send(validRateBody);
    expect(res.status).toBe(403);
  });

  it('400 when rating.verdict is missing', async () => {
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, rating: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when rating.verdict is an unknown value', async () => {
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, rating: { verdict: 'great' } }); // not in enum
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns entry with rating, reviewerUid forced to callerUid', async () => {
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send(validRateBody);
    expect(res.status).toBe(200);
    const entry: AiAuditEntry = res.body.entry;
    expect(entry.rating).toBeDefined();
    expect(entry.rating!.verdict).toBe('useful');
    // Server must force reviewerUid to callerUid — never trust client.
    expect(entry.rating!.reviewerUid).toBe(CALLER);
    // reviewedAt must be a valid ISO timestamp.
    expect(() => new Date(entry.rating!.reviewedAt)).not.toThrow();
  });

  it('200 works for all valid verdicts', async () => {
    const verdicts = ['useful', 'not_useful', 'missing_context', 'incorrect'] as const;
    for (const verdict of verdicts) {
      const res = await request(buildApp())
        .post(RATE_URL)
        .set('x-test-uid', CALLER)
        .send({ entry: baseEntry, rating: { verdict } });
      expect(res.status).toBe(200);
      expect(res.body.entry.rating!.verdict).toBe(verdict);
    }
  });

  it('200 accepts an optional reviewerNote', async () => {
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send({
        entry: baseEntry,
        rating: { verdict: 'missing_context', reviewerNote: 'Faltó considerar el DS 594 art. 72.' },
      });
    expect(res.status).toBe(200);
    expect(res.body.entry.rating!.reviewerNote).toBe('Faltó considerar el DS 594 art. 72.');
  });

  it('200 accepts optional explicit reviewedAt', async () => {
    const reviewedAt = '2025-09-01T08:00:00.000Z';
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, rating: { verdict: 'not_useful', reviewedAt } });
    expect(res.status).toBe(200);
    expect(res.body.entry.rating!.reviewedAt).toBe(reviewedAt);
  });

  it('200 forces reviewerUid to callerUid even when a different uid is passed in rating', async () => {
    // rating schema does not include reviewerUid (it's stripped by the route), so
    // any body-supplied reviewerUid is simply not forwarded — server always stamps caller.
    const res = await request(buildApp())
      .post(RATE_URL)
      .set('x-test-uid', CALLER)
      .send({ entry: baseEntry, rating: { verdict: 'incorrect', reviewerUid: 'attacker-uid' } });
    expect(res.status).toBe(200);
    expect(res.body.entry.rating!.reviewerUid).toBe(CALLER);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. summarize
// ══════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/ai-quality/summarize', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .send({ entries: [] });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .set('x-test-uid', 'outsider-uid')
      .send({ entries: [] });
    expect(res.status).toBe(403);
  });

  it('400 when entries field is missing', async () => {
    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .set('x-test-uid', CALLER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns a zero-summary for empty entries', async () => {
    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .set('x-test-uid', CALLER)
      .send({ entries: [] });
    expect(res.status).toBe(200);
    const summary = res.body.summary;
    expect(summary.totalLogged).toBe(0);
    expect(summary.withHumanDecision).toBe(0);
    expect(summary.withOverride).toBe(0);
    expect(summary.overrideRate).toBe(0);
  });

  it('200 aggregates multiple entries into a human-review quality report', async () => {
    const ratedEntry: AiAuditEntry = {
      ...baseEntry,
      id: 'entry-a',
      humanDecision: { followed: true, decidedAt: new Date().toISOString() },
      rating: { verdict: 'useful', reviewerUid: CALLER, reviewedAt: new Date().toISOString() },
    };
    const overriddenEntry: AiAuditEntry = {
      ...baseEntry,
      id: 'entry-b',
      source: 'deterministic_rule',
      kind: 'epp_suggestion',
      humanDecision: {
        followed: false,
        overrideReason: 'Criterio incorrecto para zona húmeda.',
        decidedAt: new Date().toISOString(),
      },
      rating: { verdict: 'incorrect', reviewerUid: CALLER, reviewedAt: new Date().toISOString() },
    };
    const unrated: AiAuditEntry = { ...baseEntry, id: 'entry-c' };

    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .set('x-test-uid', CALLER)
      .send({ entries: [ratedEntry, overriddenEntry, unrated] });

    expect(res.status).toBe(200);
    const summary = res.body.summary;
    // DIRECTIVE: summary is a quality report for HUMAN review — not an autonomous decision.
    expect(summary.totalLogged).toBe(3);
    expect(summary.withHumanDecision).toBe(2); // entry-a and entry-b
    expect(summary.withOverride).toBe(1);       // only entry-b
    // overrideRate = 1/2 → 50%
    expect(summary.overrideRate).toBe(50);
    // bySource
    expect(summary.bySource['gemini']).toBe(2);
    expect(summary.bySource['deterministic_rule']).toBe(1);
    // byKind
    expect(summary.byKind['risk_assessment']).toBe(2);
    expect(summary.byKind['epp_suggestion']).toBe(1);
    // ratingCounts
    expect(summary.ratingCounts['useful']).toBe(1);
    expect(summary.ratingCounts['incorrect']).toBe(1);
    expect(summary.ratingCounts['not_useful']).toBe(0);
    expect(summary.ratingCounts['missing_context']).toBe(0);
  });

  it('200 handles a large entries array (boundary check: 5000 max)', async () => {
    const entries: AiAuditEntry[] = Array.from({ length: 100 }, (_, i) => ({
      ...baseEntry,
      id: `entry-${i}`,
    }));
    const res = await request(buildApp())
      .post(SUMMARIZE_URL)
      .set('x-test-uid', CALLER)
      .send({ entries });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalLogged).toBe(100);
  });
});
