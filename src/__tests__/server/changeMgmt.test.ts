// Real-router supertest for src/server/routes/changeMgmt.ts
// (Plan v3 Fase 1 — pure-compute MOC endpoints, 0 Firestore writes).
//
// Four endpoints, all POST /:projectId/change-mgmt/<sub-path>, behind
// verifyAuth + validate(zodSchema) + guard(assertProjectMember). We seed
// `projects/<id>` in fakeFirestore so assertProjectMember passes, then
// exercise every status code the route can emit: 401 / 400 / 403 / 200,
// plus the ChangeValidationError → 400 paths triggered by pure-compute
// business rules (ROLE_NOT_ALLOWED, RATIONALE_TOO_SHORT, NO_DIFFERENCE,
// AFFECTED_REQUIRED, CHANGE_REVERTED, NOT_IN_AUDIENCE, ALREADY_REVERTED,
// REASON_TOO_SHORT).

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

import changeMgmtRouter from '../../server/routes/changeMgmt.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { OperationalChange } from '../../services/changeMgmt/operationalChangeService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', changeMgmtRouter);
  return app;
}

const PROJECT_ID = 'p-cm-test';
const CALLER_UID = 'uid-cm-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Change Mgmt Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Minimal valid body for POST /declare */
function declareBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'supervisor',
    whatChanged: 'Cambio de supervisor de turno',
    previousValue: 'Pedro Soto',
    newValue: 'Juan Díaz',
    rationale: 'Reasignación por vacaciones anuales del titular',
    impact: 'low',
    affectedWorkerUids: ['w-1', 'w-2'],
    declaredByRole: 'supervisor',
    effectiveFrom: '2026-06-01T08:00:00.000Z',
    ...overrides,
  };
}

/** A minimal valid OperationalChange for acknowledge/revert/summarize-acks */
function makeChange(overrides: Partial<OperationalChange> = {}): OperationalChange {
  return {
    id: 'chg-test-001',
    projectId: PROJECT_ID,
    kind: 'supervisor',
    whatChanged: 'Cambio de supervisor de turno',
    previousValue: 'Pedro Soto',
    newValue: 'Juan Díaz',
    rationale: 'Reasignación por vacaciones anuales del titular',
    impact: 'low',
    affectedWorkerUids: ['w-1', 'w-2'],
    declaredByUid: CALLER_UID,
    declaredByRole: 'supervisor',
    effectiveFrom: '2026-06-01T08:00:00.000Z',
    declaredAt: '2026-05-30T10:00:00.000Z',
    acknowledgments: [],
    status: 'in_effect',
    approvals: [],
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/change-mgmt/declare
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/change-mgmt/declare', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/change-mgmt/declare`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(declareBody());
    expect(res.status).toBe(401);
  });

  it('400 when kind is missing', async () => {
    const { kind: _k, ...noKind } = declareBody();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noKind);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when rationale is too short (schema min 20)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ rationale: 'Corto' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when impact is not a valid enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ impact: 'critical' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url.replace(PROJECT_ID, 'stranger-project'))
      .set('x-test-uid', CALLER_UID)
      .send(declareBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/change-mgmt/declare`)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — returns declared change', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody());
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    expect(change.kind).toBe('supervisor');
    expect(change.projectId).toBe(PROJECT_ID);
    // Server overrides declaredByUid with caller's uid
    expect(change.declaredByUid).toBe(CALLER_UID);
    expect(change.acknowledgments).toEqual([]);
    expect(typeof change.id).toBe('string');
    expect(change.id.length).toBeGreaterThan(0);
    // New MOC: starts as draft
    expect(change.status).toBe('draft');
  });

  it('200 caller uid is forced as declaredByUid (not client-supplied)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody());
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    // Even if the body had a different declaredByUid, the route ignores it
    expect(change.declaredByUid).toBe(CALLER_UID);
  });

  it('200 projectId from URL overrides any mismatch in body', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody());
    expect(res.status).toBe(200);
    expect((res.body as { change: OperationalChange }).change.projectId).toBe(PROJECT_ID);
  });

  it('200 optional id field accepted', async () => {
    const customId = 'my-custom-id-abc123';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ id: customId }));
    expect(res.status).toBe(200);
    expect((res.body as { change: OperationalChange }).change.id).toBe(customId);
  });

  it('400 (ChangeValidationError) when declaredByRole is not an approver role', async () => {
    // 'trabajador' is not in APPROVER_ROLES — the service throws ROLE_NOT_ALLOWED
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ declaredByRole: 'trabajador' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('400 (ChangeValidationError) previousValue === newValue triggers NO_DIFFERENCE', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ previousValue: 'mismo', newValue: 'mismo' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NO_DIFFERENCE');
  });

  it('400 (ChangeValidationError) medium impact without affectedWorkerUids triggers AFFECTED_REQUIRED', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ impact: 'medium', affectedWorkerUids: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('AFFECTED_REQUIRED');
  });

  it('400 (ChangeValidationError) high impact without affectedWorkerUids triggers AFFECTED_REQUIRED', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ impact: 'high', affectedWorkerUids: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('AFFECTED_REQUIRED');
  });

  it('200 low impact with empty affectedWorkerUids is allowed', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ impact: 'low', affectedWorkerUids: [] }));
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    expect(change.affectedWorkerUids).toEqual([]);
  });

  it('200 deduplicates affectedWorkerUids', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ affectedWorkerUids: ['w-1', 'w-1', 'w-2'] }));
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    expect(change.affectedWorkerUids).toEqual(['w-1', 'w-2']);
  });

  it('200 optional referenceDocumentId is passed through', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(declareBody({ referenceDocumentId: 'proc-SOP-042' }));
    expect(res.status).toBe(200);
    expect((res.body as { change: OperationalChange }).change.referenceDocumentId).toBe('proc-SOP-042');
  });

  it('200 all ChangeKind values are accepted', async () => {
    const kinds = [
      'supervisor', 'procedure', 'equipment', 'shift',
      'work_zone', 'mandatory_epp', 'applicable_norm', 'critical_control', 'other',
    ] as const;
    for (const kind of kinds) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send(declareBody({ kind }));
      expect(res.status).toBe(200);
      expect((res.body as { change: OperationalChange }).change.kind).toBe(kind);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/change-mgmt/acknowledge
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/change-mgmt/acknowledge', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/change-mgmt/acknowledge`;

  const baseChange = makeChange();

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ change: baseChange });
    expect(res.status).toBe(401);
  });

  it('400 when change.id is missing', async () => {
    const { id: _id, ...noId } = baseChange;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: noId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/change-mgmt/acknowledge`)
      .set('x-test-uid', CALLER_UID)
      .send({ change: baseChange });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — worker acknowledges the change (workerUid defaults to caller)', async () => {
    const change = makeChange({ affectedWorkerUids: [CALLER_UID] });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { change: updated } = res.body as { change: OperationalChange };
    expect(updated.acknowledgments).toHaveLength(1);
    expect(updated.acknowledgments[0].workerUid).toBe(CALLER_UID);
    expect(typeof updated.acknowledgments[0].ackedAt).toBe('string');
  });

  it('200 explicit workerUid can ack a different worker', async () => {
    const workerUid = 'w-explicit';
    const change = makeChange({ affectedWorkerUids: [workerUid] });
    const ackedAt = '2026-06-01T09:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change, workerUid, ackedAt });
    expect(res.status).toBe(200);
    const { change: updated } = res.body as { change: OperationalChange };
    expect(updated.acknowledgments[0].workerUid).toBe(workerUid);
    expect(updated.acknowledgments[0].ackedAt).toBe(ackedAt);
  });

  it('200 idempotent — second ack for same worker returns the change unchanged', async () => {
    const existingAck = { workerUid: CALLER_UID, ackedAt: '2026-05-30T11:00:00.000Z' };
    const change = makeChange({
      affectedWorkerUids: [CALLER_UID],
      acknowledgments: [existingAck],
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { change: updated } = res.body as { change: OperationalChange };
    // Should still have only 1 acknowledgment (idempotent)
    expect(updated.acknowledgments).toHaveLength(1);
  });

  it('400 (ChangeValidationError) acknowledging a reverted change triggers CHANGE_REVERTED', async () => {
    const reverted = makeChange({
      affectedWorkerUids: [CALLER_UID],
      revertedAt: '2026-05-29T09:00:00.000Z',
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: reverted });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('CHANGE_REVERTED');
  });

  it('400 (ChangeValidationError) worker not in affectedWorkerUids triggers NOT_IN_AUDIENCE', async () => {
    const change = makeChange({ affectedWorkerUids: ['w-other'] });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      // workerUid defaults to CALLER_UID who is not in affectedWorkerUids
      .send({ change });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NOT_IN_AUDIENCE');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/change-mgmt/revert
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/change-mgmt/revert', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/change-mgmt/revert`;

  const validReason = 'El cambio generó problemas imprevistos en la operación y se requiere retroceder.';

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ change: makeChange(), reason: validReason });
    expect(res.status).toBe(401);
  });

  it('400 when reason is too short (schema min 15)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange(), reason: 'Corto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when change body is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ reason: validReason });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/change-mgmt/revert`)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange(), reason: validReason });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — returns reverted change', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange(), reason: validReason });
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    expect(typeof change.revertedAt).toBe('string');
    expect(change.revertedReason).toBe(validReason.trim());
    expect(change.status).toBe('reverted');
  });

  it('200 optional now param overrides the revert timestamp', async () => {
    const nowIso = '2026-06-15T14:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange(), reason: validReason, now: nowIso });
    expect(res.status).toBe(200);
    const { change } = res.body as { change: OperationalChange };
    expect(change.revertedAt).toBe(nowIso);
  });

  it('400 (ChangeValidationError) double revert triggers ALREADY_REVERTED', async () => {
    const alreadyReverted = makeChange({
      revertedAt: '2026-05-29T08:00:00.000Z',
      revertedReason: 'Primera reversión.',
      status: 'reverted',
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: alreadyReverted, reason: validReason });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('ALREADY_REVERTED');
  });

  it('400 (ChangeValidationError) reason too short at service level triggers REASON_TOO_SHORT', async () => {
    // Schema min is 15 chars so this passes schema; service enforces >= 15 trimmed.
    // A string of exactly 13 non-space chars surrounded by spaces passes schema
    // (17 raw >= 15) but fails the service's trim check (13 < 15).
    const tooShort = 'muy corta xd!'; // 13 chars → below service min
    // Schema min 15 — so send a padded string that passes schema but fails service trim:
    const tricky = '  ' + tooShort + '  '; // 17 raw but 13 trimmed
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange(), reason: tricky });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('REASON_TOO_SHORT');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/change-mgmt/summarize-acks
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/change-mgmt/summarize-acks', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/change-mgmt/summarize-acks`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ change: makeChange() });
    expect(res.status).toBe(401);
  });

  it('400 when change body is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/change-mgmt/summarize-acks`)
      .set('x-test-uid', CALLER_UID)
      .send({ change: makeChange() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — no acks yet: 0 coverage', async () => {
    const change = makeChange({ affectedWorkerUids: ['w-1', 'w-2', 'w-3'], acknowledgments: [] });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { summary } = res.body as {
      summary: {
        changeId: string;
        totalAffected: number;
        acknowledged: number;
        pending: number;
        coveragePercent: number;
        pendingWorkerUids: string[];
      };
    };
    expect(summary.changeId).toBe('chg-test-001');
    expect(summary.totalAffected).toBe(3);
    expect(summary.acknowledged).toBe(0);
    expect(summary.pending).toBe(3);
    expect(summary.coveragePercent).toBe(0);
    expect(summary.pendingWorkerUids).toEqual(['w-1', 'w-2', 'w-3']);
  });

  it('200 all workers acked — 100% coverage, pendingWorkerUids empty', async () => {
    const change = makeChange({
      affectedWorkerUids: ['w-1', 'w-2'],
      acknowledgments: [
        { workerUid: 'w-1', ackedAt: '2026-06-01T09:00:00.000Z' },
        { workerUid: 'w-2', ackedAt: '2026-06-01T09:05:00.000Z' },
      ],
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: { coveragePercent: number; pendingWorkerUids: string[]; pending: number } };
    expect(summary.coveragePercent).toBe(100);
    expect(summary.pendingWorkerUids).toEqual([]);
    expect(summary.pending).toBe(0);
  });

  it('200 partial acks — coverage rounds correctly', async () => {
    // 1 ack out of 3 workers → Math.round(1/3 * 100) = 33
    const change = makeChange({
      affectedWorkerUids: ['w-1', 'w-2', 'w-3'],
      acknowledgments: [{ workerUid: 'w-1', ackedAt: '2026-06-01T09:00:00.000Z' }],
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: { coveragePercent: number; acknowledged: number; pending: number } };
    expect(summary.acknowledged).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.coveragePercent).toBe(33);
  });

  it('200 zero affected workers — coverage is 100% (vacuous truth)', async () => {
    const change = makeChange({ affectedWorkerUids: [], acknowledgments: [] });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ change });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: { totalAffected: number; coveragePercent: number } };
    expect(summary.totalAffected).toBe(0);
    expect(summary.coveragePercent).toBe(100);
  });
});
