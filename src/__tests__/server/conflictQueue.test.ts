// Real-router supertest for src/server/routes/conflictQueue.ts (B16 sync
// conflict-resolution HTTP surface). Mounts the ACTUAL router through
// fakeFirestore so the REAL handler code runs end to end:
//   • verifyAuth gate (401)
//   • REAL assertProjectMember against the fake db (403 non-member)
//   • REAL resolveTenantId helper (404 tenant_not_found + members-subcollection fallback)
//   • REAL Zod validate middleware + REAL route schemas (400 invalid payloads)
//   • REAL conflictQueue engine (shouldEnqueueForHumanResolution / buildConflictQueueEntry /
//     markInReview / resolveConflictQueueEntry / rejectAsInvalid)
//   • the deterministic-queueId idempotency, the runTransaction transitions,
//     the awaited audit_logs rows
//
// This complements the existing conflictQueueRoute.test.ts (which mocks
// assertProjectMember + validate). Here we deliberately let BOTH the real
// membership gate and the real Zod schemas run, so the 400 paths, the
// tenant-resolution paths, and the gerente approver role get genuine
// behavioral coverage. We assert ONLY on real HTTP responses + resulting
// Firestore state — never on router.stack / route registration.
//
// Compliance assertions:
//   • Audit identity (userId) comes from the verified token (x-test-uid),
//     NEVER from the request body — a body-supplied localAuthorUid/userId
//     can never spoof the actor or the conflict author.
//   • No external-organism push surface (SUSESO/SII/MINSAL/Mutualidad) in
//     any response — the queue is an internal supervisor-resolution surface.

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
      email: req.header('x-test-email') || null,
      role: req.header('x-test-role') || undefined,
    };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// NOTE: validate + assertProjectMember + auditServerEvent + the conflictQueue
// engine are NOT mocked — they run for real against H.db (the firebase-admin
// mock), exercising the true Zod schemas, membership gate, and audit write.

import conflictQueueRouter from '../../server/routes/conflictQueue.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { Conflict } from '../../services/sync/conflictResolver.js';

// Mount prefix matches server.ts: app.use('/api/sprint-k', conflictQueueRouter)
const PREFIX = '/api/sprint-k';
const PROJECT_ID = 'proj-cq-1';
const TENANT_ID = 'tenant-cq-1';
const WORKER_UID = 'uid-worker-1';
const ADMIN_UID = 'uid-admin-1';
const GERENTE_UID = 'uid-gerente-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, conflictQueueRouter);
  return app;
}

// ── headers ─────────────────────────────────────────────────────────────────
const asWorker = { 'x-test-uid': WORKER_UID, 'x-test-role': 'worker' };
const asAdmin = { 'x-test-uid': ADMIN_UID, 'x-test-role': 'admin' };
const asGerente = { 'x-test-uid': GERENTE_UID, 'x-test-role': 'gerente' };

// ── fixtures ──────────────────────────────────────────────────────────────────

/**
 * Seed a project doc with both a members[] (so the REAL assertProjectMember
 * passes for every actor) and a tenantId (so the REAL resolveTenantId returns
 * a tenant and the guard does NOT 404).
 */
function seedProject(overrides: Record<string, unknown> = {}, projectId = PROJECT_ID) {
  H.db!._seed(`projects/${projectId}`, {
    members: [WORKER_UID, ADMIN_UID, GERENTE_UID],
    createdBy: WORKER_UID,
    tenantId: TENANT_ID,
    ...overrides,
  });
}

const criticalConflict: Conflict = {
  collection: 'incident_reports',
  docId: 'inc-1',
  docType: 'IncidentReport', // ALWAYS_REQUIRES_HUMAN_RESOLUTION
  localUpdatedAt: '2026-01-01T00:00:00.000Z',
  serverUpdatedAt: '2026-01-01T00:01:00.000Z',
  isDeletionConflict: false,
  fields: [{ field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true }],
};

// A RiskNode with only a non-critical field → engine declines to enqueue.
const nonCriticalConflict: Conflict = {
  ...criticalConflict,
  collection: 'nodes',
  docId: 'node-9',
  docType: 'RiskNode',
  fields: [{ field: 'description', localValue: 'a', remoteValue: 'b', critical: false }],
};

const enqueueUrl = (projectId = PROJECT_ID) =>
  `${PREFIX}/${projectId}/conflict-queue/enqueue`;
const listUrl = (projectId = PROJECT_ID, qs = '') =>
  `${PREFIX}/${projectId}/conflict-queue${qs}`;
const markUrl = (queueId: string, projectId = PROJECT_ID) =>
  `${PREFIX}/${projectId}/conflict-queue/${queueId}/mark-in-review`;
const resolveUrl = (queueId: string, projectId = PROJECT_ID) =>
  `${PREFIX}/${projectId}/conflict-queue/${queueId}/resolve`;
const rejectUrl = (queueId: string, projectId = PROJECT_ID) =>
  `${PREFIX}/${projectId}/conflict-queue/${queueId}/reject`;

function queueKeys(tenantId = TENANT_ID): string[] {
  const prefix = `tenants/${tenantId}/conflict_queue/`;
  return Object.keys(H.db!._dump()).filter((k) => k.startsWith(prefix));
}

function storedEntry(queueId: string, tenantId = TENANT_ID): Record<string, unknown> | undefined {
  return H.db!._dump()[`tenants/${tenantId}/conflict_queue/${queueId}`] as
    | Record<string, unknown>
    | undefined;
}

function auditRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const [key, value] of H.db!._store.entries()) {
    if (key.startsWith('audit_logs/')) rows.push(value as Record<string, unknown>);
  }
  return rows;
}

/** Enqueue a critical conflict as the worker and return the persisted queueId. */
async function enqueueCritical(conflict: Conflict = criticalConflict): Promise<string> {
  const res = await request(buildApp())
    .post(enqueueUrl())
    .set(asWorker)
    .send({ conflict });
  return res.body.entry.queueId as string;
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. POST /:projectId/conflict-queue/enqueue
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/conflict-queue/enqueue', () => {
  it('401 — no token', async () => {
    const res = await request(buildApp()).post(enqueueUrl()).send({ conflict: criticalConflict });
    expect(res.status).toBe(401);
  });

  it('403 — caller is not a project member (real assertProjectMember)', async () => {
    // project doc seeded WITHOUT this uid in members[] nor createdBy
    seedProject({ members: ['someone-else'], createdBy: 'someone-else' });
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: criticalConflict });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 — invalid payload: empty conflict (real Zod schema)', async () => {
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid payload: fields array empty (min(1) violated)', async () => {
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: { ...criticalConflict, fields: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid payload: missing top-level conflict key', async () => {
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ notTheRightKey: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('404 — tenant cannot be resolved (project has no tenantId, no member doc)', async () => {
    // Member of the project (so 403 passes) but the project carries no tenantId
    // and there is no projects/{id}/members/* doc → resolveTenantId returns null.
    seedProject({ tenantId: undefined });
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: criticalConflict });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 enqueued:false — non-critical conflict is NOT persisted (engine gate)', async () => {
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: nonCriticalConflict });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, enqueued: false });
    expect(queueKeys()).toHaveLength(0);
    // No state change → no audit row.
    expect(auditRows()).toHaveLength(0);
  });

  it('201 happy path — persists entry under tenants/{tid}/conflict_queue, author from token', async () => {
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      // an attacker tries to spoof the author via the body — must be ignored
      .send({ conflict: criticalConflict, localAuthorUid: 'attacker' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.enqueued).toBe(true);
    expect(res.body.entry.status).toBe('pending');
    // Identity is server-stamped from the verified token, NOT the body.
    expect(res.body.entry.localAuthorUid).toBe(WORKER_UID);
    expect(res.body.entry.projectId).toBe(PROJECT_ID);

    // Real Firestore state: exactly one doc under the tenant queue collection.
    const keys = queueKeys();
    expect(keys).toHaveLength(1);
    const stored = storedEntry(res.body.entry.queueId)!;
    expect(stored.localAuthorUid).toBe(WORKER_UID);
    expect(stored.tenantId).toBe(TENANT_ID); // tenant stamped server-side
    expect(stored.status).toBe('pending');

    // Audit invariant: one awaited row, actor identity from the token.
    const audits = auditRows();
    const enq = audits.find((a) => a.action === 'conflict_queue.enqueued');
    expect(enq).toBeDefined();
    expect(enq!.userId).toBe(WORKER_UID); // from x-test-uid, not body
    expect(enq!.projectId).toBe(PROJECT_ID);
  });

  it('200 — idempotent re-enqueue of the SAME conflict returns the stored entry, no duplicate', async () => {
    const first = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: criticalConflict });
    expect(first.status).toBe(201);
    expect(queueKeys()).toHaveLength(1);

    const retry = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: criticalConflict });
    expect(retry.status).toBe(200);
    expect(retry.body.enqueued).toBe(false);
    expect(retry.body.entry.queueId).toBe(first.body.entry.queueId);
    // Deterministic queueId → still exactly one stored doc.
    expect(queueKeys()).toHaveLength(1);
  });

  it('200 — resolveTenantId falls back to projects/{id}/members/{uid}.tenantId', async () => {
    // Project doc exists for membership (createdBy) but has NO tenantId field;
    // the tenant must be recovered from the member subcollection.
    seedProject({ tenantId: undefined });
    H.db!._seed(`projects/${PROJECT_ID}/members/${WORKER_UID}`, {
      uid: WORKER_UID,
      tenantId: TENANT_ID,
    });
    const res = await request(buildApp())
      .post(enqueueUrl())
      .set(asWorker)
      .send({ conflict: criticalConflict });
    expect(res.status).toBe(201);
    // Persisted under the tenant recovered from the member doc.
    expect(queueKeys(TENANT_ID)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. GET /:projectId/conflict-queue[?status=]
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/conflict-queue', () => {
  it('401 — no token', async () => {
    const res = await request(buildApp()).get(listUrl());
    expect(res.status).toBe(401);
  });

  it('403 — caller is not a project member', async () => {
    seedProject({ members: ['someone-else'], createdBy: 'someone-else' });
    const res = await request(buildApp()).get(listUrl()).set(asWorker);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 — empty queue returns entries: []', async () => {
    const res = await request(buildApp()).get(listUrl()).set(asWorker);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(0);
  });

  it('200 — lists the enqueued entry, scoped to the projectId', async () => {
    await enqueueCritical();
    const res = await request(buildApp()).get(listUrl()).set(asWorker);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].projectId).toBe(PROJECT_ID);
    expect(res.body.entries[0].status).toBe('pending');
  });

  it('200 — ?status=pending matches; ?status=resolved excludes a pending entry', async () => {
    await enqueueCritical();
    const pending = await request(buildApp())
      .get(listUrl(PROJECT_ID, '?status=pending'))
      .set(asWorker);
    expect(pending.status).toBe(200);
    expect(pending.body.entries).toHaveLength(1);

    const resolved = await request(buildApp())
      .get(listUrl(PROJECT_ID, '?status=resolved'))
      .set(asWorker);
    expect(resolved.status).toBe(200);
    expect(resolved.body.entries).toHaveLength(0);
  });

  it('200 — unknown ?status value falls back to "all" (returns the entry)', async () => {
    await enqueueCritical();
    const res = await request(buildApp())
      .get(listUrl(PROJECT_ID, '?status=bogus-value'))
      .set(asWorker);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });

  it('200 — entries from a DIFFERENT project are not returned', async () => {
    await enqueueCritical(); // belongs to PROJECT_ID under TENANT_ID
    // A second project sharing the SAME tenant but a different projectId.
    const otherProject = 'proj-cq-2';
    seedProject({}, otherProject); // members include WORKER_UID, same tenant
    const res = await request(buildApp()).get(listUrl(otherProject)).set(asWorker);
    expect(res.status).toBe(200);
    // The where('projectId','==',otherProject) filter excludes PROJECT_ID's entry.
    expect(res.body.entries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/conflict-queue/:queueId/mark-in-review (approver-gated)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/conflict-queue/:queueId/mark-in-review', () => {
  it('401 — no token', async () => {
    const res = await request(buildApp()).post(markUrl('any')).send({});
    expect(res.status).toBe(401);
  });

  it('403 — worker (non-approver) is blocked by the role gate', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(markUrl(id)).set(asWorker).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('approver_role_required');
  });

  it('200 — body is permissive (real z.object({}) ignores extra keys, no payload needed)', async () => {
    // mark-in-review takes no body fields; its schema is z.object({}). By
    // design Zod object schemas are non-strict, so extra keys are accepted and
    // there is no meaningful 400 path here — the transition is purely a state
    // change. We assert the real permissive behavior rather than inventing a
    // reject case the schema does not have.
    const id = await enqueueCritical();
    const res = await request(buildApp())
      .post(markUrl(id))
      .set(asAdmin)
      .send({ extraneous: 'ignored', nested: { a: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('in_review');
  });

  it('404 — approver targets a missing queueId', async () => {
    const res = await request(buildApp()).post(markUrl('does-not-exist')).set(asAdmin).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('200 happy path — admin moves a pending entry to in_review (+ audit)', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(markUrl(id)).set(asAdmin).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entry.status).toBe('in_review');
    // Persisted state changed.
    expect(storedEntry(id)!.status).toBe('in_review');
    // Audit row, actor from the token.
    const audit = auditRows().find((a) => a.action === 'conflict_queue.mark_in_review');
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(ADMIN_UID);
  });

  it('200 — gerente is also an approver', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(markUrl(id)).set(asGerente).send({});
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('in_review');
  });

  it('409 NOT_PENDING — cannot mark in_review twice (engine invariant)', async () => {
    const id = await enqueueCritical();
    await request(buildApp()).post(markUrl(id)).set(asAdmin).send({}); // → in_review
    const again = await request(buildApp()).post(markUrl(id)).set(asAdmin).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('NOT_PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. POST /:projectId/conflict-queue/:queueId/resolve (approver-gated)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/conflict-queue/:queueId/resolve', () => {
  const validResolution = { resolution: { severity: { chosen: 'remote', value: 'medium' } } };

  it('401 — no token', async () => {
    const res = await request(buildApp()).post(resolveUrl('any')).send(validResolution);
    expect(res.status).toBe(401);
  });

  it('403 — worker (non-approver) blocked by role gate', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(resolveUrl(id)).set(asWorker).send(validResolution);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('approver_role_required');
  });

  it('400 — invalid resolution (bad chosen enum) rejected by real Zod schema', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ resolution: { severity: { chosen: 'not-an-enum', value: 'x' } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — notes over 2000 chars rejected by real Zod schema', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ ...validResolution, notes: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('404 — approver resolves a missing queueId', async () => {
    const res = await request(buildApp())
      .post(resolveUrl('does-not-exist'))
      .set(asAdmin)
      .send(validResolution);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('200 happy path — admin resolves, persists status + resolver from token + audit', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ ...validResolution, notes: 'remote value correct after review' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('resolved');
    expect(res.body.entry.resolvedByUid).toBe(ADMIN_UID);
    // Real persisted state.
    const stored = storedEntry(id)!;
    expect(stored.status).toBe('resolved');
    expect(stored.resolvedByUid).toBe(ADMIN_UID);
    expect(stored.notes).toBe('remote value correct after review');
    // Audit, actor from token.
    const audit = auditRows().find((a) => a.action === 'conflict_queue.resolved');
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(ADMIN_UID);
  });

  it('409 INCOMPLETE_RESOLUTION — a critical field is omitted (engine invariant)', async () => {
    const id = await enqueueCritical({
      ...criticalConflict,
      docId: 'inc-2',
      fields: [
        { field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true },
        { field: 'status', localValue: 'open', remoteValue: 'closed', critical: true },
      ],
    });
    const res = await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ resolution: { severity: { chosen: 'local', value: 'high' } } }); // status missing
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INCOMPLETE_RESOLUTION');
    // No state change — still pending.
    expect(storedEntry(id)!.status).toBe('pending');
  });

  it('409 ALREADY_FINALIZED — re-resolving a resolved entry', async () => {
    const id = await enqueueCritical();
    await request(buildApp()).post(resolveUrl(id)).set(asAdmin).send(validResolution);
    const again = await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ resolution: { severity: { chosen: 'local', value: 'high' } } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ALREADY_FINALIZED');
  });

  it('COMPLIANCE — resolve response carries no external-organism push surface', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(resolveUrl(id)).set(asAdmin).send(validResolution);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/suseso|sii|minsal|mutualidad|push_to|externalApi/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. POST /:projectId/conflict-queue/:queueId/reject (approver-gated)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/conflict-queue/:queueId/reject', () => {
  const validReject = { reason: 'Duplicate report produced by a sync race condition.' };

  it('401 — no token', async () => {
    const res = await request(buildApp()).post(rejectUrl('any')).send(validReject);
    expect(res.status).toBe(401);
  });

  it('403 — worker (non-approver) blocked by role gate', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(rejectUrl(id)).set(asWorker).send(validReject);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('approver_role_required');
  });

  it('400 — empty reason rejected by real Zod schema (min(1))', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(rejectUrl(id)).set(asAdmin).send({ reason: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — missing reason key rejected by real Zod schema', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(rejectUrl(id)).set(asAdmin).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('404 — approver rejects a missing queueId', async () => {
    const res = await request(buildApp())
      .post(rejectUrl('does-not-exist'))
      .set(asAdmin)
      .send(validReject);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('200 happy path — admin rejects, persists rejected + reason + audit', async () => {
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(rejectUrl(id)).set(asAdmin).send(validReject);
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('rejected');
    expect(res.body.entry.resolvedByUid).toBe(ADMIN_UID);
    const stored = storedEntry(id)!;
    expect(stored.status).toBe('rejected');
    expect(stored.notes).toBe(validReject.reason);
    const audit = auditRows().find((a) => a.action === 'conflict_queue.rejected');
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(ADMIN_UID);
  });

  it('409 REASON_TOO_SHORT — Zod passes (>=1) but engine requires >=5 chars', async () => {
    // The route's Zod schema only requires min(1), so a 2-char reason passes
    // validation and reaches rejectAsInvalid, which enforces >=5 chars and
    // throws ConflictQueueValidationError('REASON_TOO_SHORT') → mapped to 409.
    const id = await enqueueCritical();
    const res = await request(buildApp()).post(rejectUrl(id)).set(asAdmin).send({ reason: 'no' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REASON_TOO_SHORT');
    // No state change — still pending.
    expect(storedEntry(id)!.status).toBe('pending');
  });

  it('409 ALREADY_FINALIZED — rejecting an already-resolved entry', async () => {
    const id = await enqueueCritical();
    await request(buildApp())
      .post(resolveUrl(id))
      .set(asAdmin)
      .send({ resolution: { severity: { chosen: 'remote', value: 'medium' } } });
    const res = await request(buildApp()).post(rejectUrl(id)).set(asAdmin).send(validReject);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_FINALIZED');
  });
});
