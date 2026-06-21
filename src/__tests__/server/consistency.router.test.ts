// Real-router supertest for the cross-module consistency auditor endpoints.
// Sprint 39 Fase G.3 — two stateless POST endpoints under
// /:projectId/consistency/* (run-audit, summarize-audit).
//
// Handlers are pure compute over src/services/consistency/consistencyAuditor.ts
// (no Firestore writes). assertProjectMember reads the projects collection via
// the firebase-admin mock; the engine, Zod validate, and the guard all run
// UNMOCKED. We assert the REAL engine output shape (exact ruleId / severity /
// involvedIds for run-audit, exact aggregation for summarize-audit) — never
// hollow router.stack / .length-only checks, never seed the gate field.

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import consistencyRouter from '../../server/routes/consistency.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { Inconsistency } from '../../services/consistency/consistencyAuditor.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', consistencyRouter);
  return app;
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });

const PROJECT_ID = 'proj1';
const MEMBER_UID = 'user-member';
const NONMEMBER_UID = 'user-stranger';

// A clean, fully-consistent state: every array present, zero rule violations.
// Used as the baseline so each test perturbs exactly one dimension and we can
// attribute the resulting issue to a specific rule.
function cleanState() {
  return {
    workers: [
      {
        uid: 'w1',
        role: 'operario',
        activeTrainings: ['altura'],
        activeEppLabels: ['casco', 'arnes'],
        isActive: true,
      },
    ],
    taskAssignments: [
      {
        taskId: 't1',
        workerUid: 'w1',
        riskType: 'trabajo_altura',
        requiredTrainings: ['altura'],
        requiredEpp: ['casco', 'arnes'],
      },
    ],
    documents: [
      { id: 'd1', status: 'signed' as const, signedBy: 'w1', approvedAt: '2026-01-01' },
    ],
    correctiveActions: [
      { id: 'ca1', status: 'closed' as const, closedAt: '2026-01-01', evidenceRequired: true, evidenceUrls: ['https://e/1'] },
    ],
    workPermits: [
      { id: 'p1', approverUid: 'sup1', expiresAt: '2099-01-01', status: 'active' as const },
    ],
    trainings: [
      { id: 'tr1', workerUid: 'w1', course: 'Trabajo en Altura', completedAt: '2026-01-01', attendanceRegistered: true },
    ],
    validRoles: ['operario'],
    eppByRole: { operario: ['casco'] },
    activeApproverUids: ['sup1'],
  };
}

function seedMember() {
  H.db!._seed(`projects/${PROJECT_ID}`, { members: [MEMBER_UID], createdBy: 'owner-uid' });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedMember();
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/consistency/run-audit
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/consistency/run-audit', () => {
  const url = `/${PROJECT_ID}/consistency/run-audit`;

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ state: cleanState() });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller (guard runs before compute)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ state: cleanState() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 — project does not exist (membership check fails)', async () => {
    const res = await request(buildApp())
      .post(`/nope-project/consistency/run-audit`)
      .set(asUser(MEMBER_UID))
      .send({ state: cleanState() });
    expect(res.status).toBe(403);
  });

  it('400 — missing state', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({});
    expect(res.status).toBe(400);
  });

  it('400 — worker missing required uid field', async () => {
    const state = cleanState();
    // @ts-expect-error intentionally invalid: drop required uid
    delete state.workers[0].uid;
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(400);
  });

  it('400 — document status not in enum', async () => {
    const state = cleanState();
    // @ts-expect-error invalid enum value rejected by Zod
    state.documents[0].status = 'bogus';
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(400);
  });

  it('200 — clean state yields zero issues', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state: cleanState() });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues).toEqual([]);
  });

  it('200 — missing training fires R01 (critical) with real engine output', async () => {
    const state = cleanState();
    // worker lacks the 'altura' training the task requires
    state.workers[0].activeTrainings = [];
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(200);
    const issues = res.body.issues as Inconsistency[];
    const r01 = issues.find((i) => i.ruleId === 'R01_task_missing_training');
    expect(r01).toBeDefined();
    expect(r01!.severity).toBe('critical');
    expect(r01!.category).toBe('training');
    // engine puts [workerUid, taskId] in involvedIds, in that order
    expect(r01!.involvedIds).toEqual(['w1', 't1']);
    expect(r01!.description).toContain('altura');
  });

  it('200 — closed corrective action without evidence fires R04 (critical)', async () => {
    const state = cleanState();
    state.correctiveActions[0].evidenceUrls = [];
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(200);
    const issues = res.body.issues as Inconsistency[];
    const r04 = issues.find((i) => i.ruleId === 'R04_action_closed_no_evidence');
    expect(r04).toBeDefined();
    expect(r04!.severity).toBe('critical');
    expect(r04!.category).toBe('audits');
    expect(r04!.involvedIds).toEqual(['ca1']);
  });

  it('200 — orphan-approver active permit fires R06 (critical)', async () => {
    const state = cleanState();
    // approver no longer in the active set
    state.activeApproverUids = [];
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(200);
    const issues = res.body.issues as Inconsistency[];
    const r06 = issues.find((i) => i.ruleId === 'R06_permit_orphan_approver');
    expect(r06).toBeDefined();
    expect(r06!.severity).toBe('critical');
    expect(r06!.category).toBe('permits');
    expect(r06!.involvedIds).toEqual(['p1', 'sup1']);
  });

  it('200 — task assigned to non-existent worker fires R11 (critical)', async () => {
    const state = cleanState();
    state.taskAssignments[0].workerUid = 'ghost';
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ state });
    expect(res.status).toBe(200);
    const issues = res.body.issues as Inconsistency[];
    const r11 = issues.find((i) => i.ruleId === 'R11_orphan_task');
    expect(r11).toBeDefined();
    expect(r11!.severity).toBe('critical');
    expect(r11!.involvedIds).toEqual(['t1']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// POST /:projectId/consistency/summarize-audit
// ════════════════════════════════════════════════════════════════════════
describe('POST /:projectId/consistency/summarize-audit', () => {
  const url = `/${PROJECT_ID}/consistency/summarize-audit`;

  const issueA: Inconsistency = {
    ruleId: 'R01_task_missing_training',
    severity: 'critical',
    category: 'training',
    description: 'x',
    involvedIds: ['w1', 't1'],
    suggestedAction: 'y',
  };
  const issueB: Inconsistency = {
    ruleId: 'R03_doc_approved_unsigned',
    severity: 'warning',
    category: 'documentation',
    description: 'x',
    involvedIds: ['d1'],
    suggestedAction: 'y',
  };
  const issueC: Inconsistency = {
    ruleId: 'R02_task_missing_epp',
    severity: 'critical',
    category: 'epp',
    description: 'x',
    involvedIds: ['w1', 't1'],
    suggestedAction: 'y',
  };

  it('401 — no auth token', async () => {
    const res = await request(buildApp()).post(url).send({ issues: [] });
    expect(res.status).toBe(401);
  });

  it('403 — non-member caller', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(NONMEMBER_UID))
      .send({ issues: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 — issues missing entirely', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({});
    expect(res.status).toBe(400);
  });

  it('400 — issue with invalid severity enum', async () => {
    const bad = { ...issueA, severity: 'fatal' };
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ issues: [bad] });
    expect(res.status).toBe(400);
  });

  it('400 — issue missing required ruleId', async () => {
    const { ruleId: _omit, ...noRuleId } = issueA;
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ issues: [noRuleId] });
    expect(res.status).toBe(400);
  });

  it('200 — empty issues array → zeroed summary', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ issues: [] });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      totalIssues: 0,
      byCategory: {},
      bySeverity: { info: 0, warning: 0, critical: 0 },
      criticalCount: 0,
    });
  });

  it('200 — aggregates category/severity counts from the real engine', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(asUser(MEMBER_UID))
      .send({ issues: [issueA, issueB, issueC] });
    expect(res.status).toBe(200);
    const summary = res.body.summary;
    expect(summary.totalIssues).toBe(3);
    expect(summary.byCategory).toEqual({ training: 1, documentation: 1, epp: 1 });
    expect(summary.bySeverity).toEqual({ info: 0, warning: 1, critical: 2 });
    expect(summary.criticalCount).toBe(2);
  });
});
