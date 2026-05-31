// Real-router supertest for src/server/routes/retaliationProtection.ts
// (Plan v3 Fase 1 — Ley Karín 21.643 anti-retaliation surface).
//
// Mounts the ACTUAL production router at the same prefix server.ts uses:
//   app.use('/api/sprint-k', retaliationProtectionRouter)
//
// Two stateless POST endpoints — no Firestore writes from the engine —
// but projectMembership calls admin.firestore() so we still need the
// fakeFirestore to satisfy assertProjectMember.
//
// Sensitive-domain contract:
//   - reporterUid in the assessment is stamped by the ENGINE from the
//     signal data, NOT sourced from the caller's token. The route itself
//     is stateless (no Firestore writes). The callerUid from the token
//     gates access (member check) only. Tests assert that a body-supplied
//     reporterUid !== callerUid flows through untouched — the server
//     never re-stamps it (that would re-identify the complainant).
//   - The route carries no audit_log write (comment in route header:
//     "Engine is fully deterministic — no Firestore writes."). Tests
//     confirm zero Firestore documents are created.

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

import retaliationProtectionRouter from '../../server/routes/retaliationProtection.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// The route is mounted at /api/sprint-k in server.ts (line 1013).
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', retaliationProtectionRouter);
  return app;
}

const PROJECT_ID = 'p-retaliation-test';
const MEMBER_UID = 'uid-member-1';
// A separate uid that represents the protected reporter — never matches the
// caller. The engine stamps this from signal data, not from the auth token.
const REPORTER_UID = 'uid-reporter-confidential';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Ley Karín test project',
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

// A valid minimal signal set for analyze tests.
const REPORT_FILED_AT = '2026-01-01T08:00:00.000Z';

const lowSignal = {
  kind: 'increased_scrutiny',
  severity: 'low',
  observedAt: '2026-01-10T08:00:00.000Z',
  reporterUid: REPORTER_UID,
  supervisorUid: 'uid-supervisor-1',
};

const highSignal = {
  kind: 'salary_change',
  severity: 'high',
  observedAt: '2026-01-10T08:00:00.000Z',
  reporterUid: REPORTER_UID,
  supervisorUid: 'uid-supervisor-1',
};

// A valid assessment that corresponds to a high-risk case (salary_change high → score≥70).
// score = 25 * 1.4 = 35 alone. We need multiple to cross 70.
// salary_change(high)=35, role_demoted(high)=35 → sum=70 exactly → level=high.
const HIGH_RISK_ASSESSMENT = {
  reporterUid: REPORTER_UID,
  score: 70,
  level: 'high',
  signalCount: 2,
  topKinds: ['salary_change', 'role_demoted'],
  consideredSignals: [
    {
      kind: 'salary_change',
      severity: 'high',
      observedAt: '2026-01-10T08:00:00.000Z',
      reporterUid: REPORTER_UID,
      supervisorUid: 'uid-supervisor-1',
    },
    {
      kind: 'role_demoted',
      severity: 'high',
      observedAt: '2026-01-12T08:00:00.000Z',
      reporterUid: REPORTER_UID,
      supervisorUid: 'uid-supervisor-1',
    },
  ],
};

const LOW_RISK_ASSESSMENT = {
  reporterUid: REPORTER_UID,
  score: 6,
  level: 'low',
  signalCount: 1,
  topKinds: ['increased_scrutiny'],
  consideredSignals: [lowSignal],
};

const MODERATE_RISK_ASSESSMENT = {
  reporterUid: REPORTER_UID,
  score: 35,
  level: 'moderate',
  signalCount: 1,
  topKinds: ['salary_change'],
  consideredSignals: [
    {
      kind: 'salary_change',
      severity: 'medium',
      observedAt: '2026-01-10T08:00:00.000Z',
      reporterUid: REPORTER_UID,
      supervisorUid: 'uid-supervisor-1',
    },
  ],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/retaliation/analyze
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/retaliation/analyze', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/retaliation/analyze`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [] });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when reportFiledAt is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ signals: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when signals contains an invalid kind', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        reportFiledAt: REPORT_FILED_AT,
        signals: [{ ...lowSignal, kind: 'not_a_real_kind' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when signals contains an invalid severity', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        reportFiledAt: REPORT_FILED_AT,
        signals: [{ ...lowSignal, severity: 'critical' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when evaluationWindowDays exceeds 730', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        reportFiledAt: REPORT_FILED_AT,
        signals: [],
        evaluationWindowDays: 999,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/retaliation/analyze`)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 zero signals → score=0, level=low', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [] });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment.score).toBe(0);
    expect(assessment.level).toBe('low');
    expect(assessment.signalCount).toBe(0);
    expect(Array.isArray(assessment.consideredSignals)).toBe(true);
    expect((assessment.consideredSignals as unknown[]).length).toBe(0);
    // No Firestore documents written — route is stateless.
    expect(H.db!._dump()).toEqual({
      [`projects/${PROJECT_ID}`]: expect.any(Object),
    });
  });

  it('200 low-severity signal within window → score > 0, level=low', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [lowSignal] });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    // increased_scrutiny(low) = 10 * 0.6 = 6
    expect(assessment.score).toBe(6);
    expect(assessment.level).toBe('low');
    expect(assessment.signalCount).toBe(1);
  });

  it('200 high-severity salary_change + role_demoted → score=70, level=high', async () => {
    const signals = [
      {
        kind: 'salary_change',
        severity: 'high',
        observedAt: '2026-01-10T08:00:00.000Z',
        reporterUid: REPORTER_UID,
        supervisorUid: 'uid-sup',
      },
      {
        kind: 'role_demoted',
        severity: 'high',
        observedAt: '2026-01-12T08:00:00.000Z',
        reporterUid: REPORTER_UID,
        supervisorUid: 'uid-sup',
      },
    ];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    // salary_change(high)=25*1.4=35, role_demoted(high)=25*1.4=35 → 70
    expect(assessment.score).toBe(70);
    expect(assessment.level).toBe('high');
    expect(assessment.signalCount).toBe(2);
    expect(Array.isArray(assessment.topKinds)).toBe(true);
    expect((assessment.topKinds as string[])).toContain('salary_change');
    expect((assessment.topKinds as string[])).toContain('role_demoted');
  });

  it('200 signal before reportFiledAt is excluded from scoring', async () => {
    const earlySignal = {
      ...highSignal,
      observedAt: '2025-12-31T08:00:00.000Z', // before 2026-01-01
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [earlySignal] });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment.score).toBe(0);
    expect(assessment.signalCount).toBe(0);
  });

  it('200 signal outside evaluationWindowDays is excluded', async () => {
    const farSignal = {
      ...lowSignal,
      observedAt: '2026-04-30T08:00:00.000Z', // 119d after report, exceeds 30d window
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({
        reportFiledAt: REPORT_FILED_AT,
        signals: [farSignal],
        evaluationWindowDays: 30,
      });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    expect(assessment.signalCount).toBe(0);
    expect(assessment.score).toBe(0);
  });

  it('200 reporterUid in assessment is stamped from signal data, not from auth token', async () => {
    // Sensitive-domain invariant: the caller (MEMBER_UID) is NOT the reporter.
    // The engine stamps reporterUid from the first considered signal's reporterUid.
    // The route must NOT override this with callerUid — that would re-identify.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ reportFiledAt: REPORT_FILED_AT, signals: [lowSignal] });
    expect(res.status).toBe(200);
    const { assessment } = res.body as { assessment: Record<string, unknown> };
    // Must carry the REPORTER's uid, not the caller's uid.
    expect(assessment.reporterUid).toBe(REPORTER_UID);
    expect(assessment.reporterUid).not.toBe(MEMBER_UID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/retaliation/recommend-actions
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/retaliation/recommend-actions', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/retaliation/recommend-actions`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ assessment: HIGH_RISK_ASSESSMENT });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when assessment field is missing (z.unknown() bug fix)', async () => {
    // This is the systemic bug: z.unknown() accepted undefined, so body without
    // `assessment` passed validate() and the engine received undefined → 500.
    // After fixing to z.record(), the object is required → 400.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when assessment is null', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when assessment is a string (not an object)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ assessment: HIGH_RISK_ASSESSMENT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/retaliation/recommend-actions`)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: HIGH_RISK_ASSESSMENT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 high-risk assessment → 4 actions including separate_from_supervisor and legal_counsel_referral', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: HIGH_RISK_ASSESSMENT });
    expect(res.status).toBe(200);
    const { actions } = res.body as { actions: { kind: string; rationale: string }[] };
    expect(Array.isArray(actions)).toBe(true);
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('separate_from_supervisor');
    expect(kinds).toContain('transfer_team');
    expect(kinds).toContain('external_mediation');
    expect(kinds).toContain('legal_counsel_referral');
    // No Firestore writes — route is stateless.
    expect(H.db!._dump()).toEqual({
      [`projects/${PROJECT_ID}`]: expect.any(Object),
    });
  });

  it('200 moderate-risk assessment → wellbeing_check_in + monitoring_increase', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: MODERATE_RISK_ASSESSMENT });
    expect(res.status).toBe(200);
    const { actions } = res.body as { actions: { kind: string }[] };
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('wellbeing_check_in');
    expect(kinds).toContain('monitoring_increase');
    // moderate + salary_change → also gets legal_counsel_referral
    expect(kinds).toContain('legal_counsel_referral');
    // Must NOT include high-risk-only actions
    expect(kinds).not.toContain('separate_from_supervisor');
    expect(kinds).not.toContain('transfer_team');
    expect(kinds).not.toContain('external_mediation');
  });

  it('200 low-risk assessment (no material signal) → only wellbeing_check_in', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: LOW_RISK_ASSESSMENT });
    expect(res.status).toBe(200);
    const { actions } = res.body as { actions: { kind: string }[] };
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('wellbeing_check_in');
    expect(kinds).not.toContain('legal_counsel_referral');
    expect(kinds).not.toContain('separate_from_supervisor');
  });

  it('200 low-risk assessment with salary_change in signals → adds legal_counsel_referral', async () => {
    // Engine rule: salary_change or role_demoted ALWAYS triggers legal_counsel_referral.
    const lowRiskWithSalary = {
      ...LOW_RISK_ASSESSMENT,
      consideredSignals: [
        {
          kind: 'salary_change',
          severity: 'low',
          observedAt: '2026-01-10T08:00:00.000Z',
          reporterUid: REPORTER_UID,
          supervisorUid: 'uid-sup',
        },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: lowRiskWithSalary });
    expect(res.status).toBe(200);
    const { actions } = res.body as { actions: { kind: string }[] };
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('legal_counsel_referral');
  });

  it('200 each action has a non-empty rationale string', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', MEMBER_UID)
      .send({ assessment: HIGH_RISK_ASSESSMENT });
    expect(res.status).toBe(200);
    const { actions } = res.body as { actions: { kind: string; rationale: string }[] };
    for (const action of actions) {
      expect(typeof action.rationale).toBe('string');
      expect(action.rationale.length).toBeGreaterThan(0);
    }
  });
});
