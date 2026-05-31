// Praeventio Guard — Real-router supertest for
// src/server/routes/eventReplay.ts (Sprint 53 §147-152).
//
// Three stateless POST endpoints over the event-sourcing audit engine:
//   POST /:projectId/event-replay/execute       → 200 {result} / 400 / 401 / 403
//   POST /:projectId/event-replay/diff-states   → 200 {diff}   / 401 / 403
//   POST /:projectId/event-replay/export-trail  → 200 {trail}  / 400 / 401 / 403
//
// Pure compute — no Firestore writes. Firestore is only touched by the
// guard() helper that reads projects/{projectId} to assert membership.
// We seed that doc into H.db so the guard resolves without stubbing it.
//
// Mounted in server.ts at: app.use('/api/sprint-k', eventReplayRouter)

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

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import eventReplayRouter from '../../server/routes/eventReplay.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// The prefix used in server.ts for this router.
const PREFIX = '/api/sprint-k';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, eventReplayRouter);
  return app;
}

// Project ID constants for tests.
const PROJECT_ID = 'proj-audit-1';
const OTHER_UID = 'uid-stranger';
const MEMBER_UID = 'uid-member';

// Seed a project doc so guard() resolves membership for MEMBER_UID.
function seedProject(projectId = PROJECT_ID, memberUid = MEMBER_UID) {
  H.db!._seed(`projects/${projectId}`, {
    members: [memberUid],
    createdBy: memberUid,
    name: 'Test Project',
  });
}

// Minimal valid domain event for body construction.
function makeDomainEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-001',
    occurredAt: '2026-01-15T10:00:00.000Z',
    type: 'incident_created',
    entityRef: 'incidents/inc-1',
    tenantId: 'tenant-cl',
    actorUid: MEMBER_UID,
    payload: { severity: 'high' },
    schemaVersion: 1,
    ...overrides,
  };
}

// Minimal valid query for execute endpoint.
function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-cl',
    entityRef: 'incidents/inc-1',
    pointInTime: '2026-01-16T00:00:00.000Z',
    auditorUid: MEMBER_UID, // server overrides this with caller uid anyway
    reason: 'compliance_audit',
    ...overrides,
  };
}

// A minimal ReplayResult shape for export-trail endpoint.
function makeReplayResult(overrides: Record<string, unknown> = {}) {
  return {
    entityRef: 'incidents/inc-1',
    pointInTime: '2026-01-16T00:00:00.000Z',
    reconstructedState: { status: 'open' },
    eventsApplied: 2,
    eventTypeBreakdown: { incident_created: 1, incident_updated: 1 },
    auditEntry: {
      queryId: 'audit|tenant-cl|incidents_inc-1|2026-01-16T00:00:00.000Z|uid-member|compliance_audit|2|2026-01-16T01:00:00.000Z',
      auditorUid: MEMBER_UID,
      reason: 'compliance_audit',
      executedAt: '2026-01-16T01:00:00.000Z',
      eventsScanned: 2,
    },
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/event-replay/execute
// ────────────────────────────────────────────────────────────────────────

describe(`POST ${PREFIX}/:projectId/event-replay/execute`, () => {
  const url = (pid = PROJECT_ID) => `${PREFIX}/${pid}/event-replay/execute`;

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send({
      events: [makeDomainEvent()],
      query: makeQuery(),
    });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject(PROJECT_ID, MEMBER_UID);
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', OTHER_UID)
      .send({ events: [makeDomainEvent()], query: makeQuery() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    // No project seeded — assertProjectMember throws ProjectMembershipError.
    const res = await request(buildApp())
      .post(url('nonexistent-project'))
      .set('x-test-uid', MEMBER_UID)
      .send({ events: [makeDomainEvent()], query: makeQuery() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on invalid body — missing required events field', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ query: makeQuery() }); // no events array
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — query missing required pointInTime', async () => {
    seedProject();
    const q = makeQuery();
    delete (q as Record<string, unknown>).pointInTime;
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ events: [makeDomainEvent()], query: q });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — query reason not in allowed enum', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ events: [makeDomainEvent()], query: makeQuery({ reason: 'bad_reason_value' }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — domain event missing required type field', async () => {
    seedProject();
    const badEvent = makeDomainEvent();
    delete (badEvent as Record<string, unknown>).type;
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ events: [badEvent], query: makeQuery() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 from engine — missing entityRef triggers ReplayAuditError', async () => {
    seedProject();
    // query.entityRef is optional in the Zod schema (z.string().optional())
    // but validateQuery() inside the engine throws ReplayAuditError if absent.
    const q = makeQuery();
    delete (q as Record<string, unknown>).entityRef;
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ events: [makeDomainEvent()], query: q });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('missing_entity');
  });

  it('200 happy path — replays events and returns audit metadata (identity reducer)', async () => {
    seedProject();
    const event1 = makeDomainEvent({ id: 'evt-1', occurredAt: '2026-01-15T09:00:00.000Z', type: 'incident_created' });
    const event2 = makeDomainEvent({ id: 'evt-2', occurredAt: '2026-01-15T10:00:00.000Z', type: 'incident_updated' });
    // event3 is AFTER pointInTime and must be excluded.
    const event3 = makeDomainEvent({ id: 'evt-3', occurredAt: '2026-01-17T00:00:00.000Z', type: 'incident_resolved' });

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        events: [event1, event2, event3],
        query: makeQuery({ pointInTime: '2026-01-16T00:00:00.000Z' }),
        nowOverride: '2026-01-16T12:00:00.000Z',
      });

    expect(res.status).toBe(200);
    const { result } = res.body as {
      result: {
        entityRef: string;
        eventsApplied: number;
        eventTypeBreakdown: Record<string, number>;
        auditEntry: { auditorUid: string; reason: string };
      };
    };
    expect(result.entityRef).toBe('incidents/inc-1');
    // Only the two events before pointInTime are applied.
    expect(result.eventsApplied).toBe(2);
    expect(result.eventTypeBreakdown.incident_created).toBe(1);
    expect(result.eventTypeBreakdown.incident_updated).toBe(1);
    // Server overrides auditorUid with the caller's uid (security invariant).
    expect(result.auditEntry.auditorUid).toBe(MEMBER_UID);
    expect(result.auditEntry.reason).toBe('compliance_audit');
  });

  it('200 with no events — returns zero eventsApplied and empty breakdown', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        events: [],
        query: makeQuery(),
        nowOverride: '2026-01-16T12:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.result.eventsApplied).toBe(0);
    expect(res.body.result.eventTypeBreakdown).toEqual({});
  });

  it('200 — auditorUid in body is ignored; server stamps caller uid', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        events: [makeDomainEvent()],
        query: makeQuery({ auditorUid: 'some-other-uid-from-client' }),
        nowOverride: '2026-01-16T12:00:00.000Z',
      });

    expect(res.status).toBe(200);
    // Regardless of what the client sent, auditorUid must be the authenticated caller.
    expect(res.body.result.auditEntry.auditorUid).toBe(MEMBER_UID);
  });

  it('200 — eventTypeIn filter reduces applied events to matching types only', async () => {
    seedProject();
    const event1 = makeDomainEvent({ id: 'evt-a', type: 'incident_created', occurredAt: '2026-01-10T00:00:00.000Z' });
    const event2 = makeDomainEvent({ id: 'evt-b', type: 'incident_updated', occurredAt: '2026-01-11T00:00:00.000Z' });
    const event3 = makeDomainEvent({ id: 'evt-c', type: 'incident_resolved', occurredAt: '2026-01-12T00:00:00.000Z' });

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        events: [event1, event2, event3],
        query: makeQuery({
          pointInTime: '2026-01-16T00:00:00.000Z',
          eventTypeIn: ['incident_created', 'incident_resolved'],
        }),
        nowOverride: '2026-01-16T12:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.result.eventsApplied).toBe(2);
    expect(res.body.result.eventTypeBreakdown).toEqual({
      incident_created: 1,
      incident_resolved: 1,
    });
  });

  it('200 — project creator (not in members[]) is also authorized', async () => {
    const CREATOR_UID = 'uid-creator';
    H.db!._seed(`projects/${PROJECT_ID}`, {
      members: [],
      createdBy: CREATOR_UID,
      name: 'Creator Project',
    });

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CREATOR_UID)
      .send({
        events: [makeDomainEvent()],
        query: makeQuery(),
        nowOverride: '2026-01-16T12:00:00.000Z',
      });

    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/event-replay/diff-states
// ────────────────────────────────────────────────────────────────────────

describe(`POST ${PREFIX}/:projectId/event-replay/diff-states`, () => {
  const url = (pid = PROJECT_ID) => `${PREFIX}/${pid}/event-replay/diff-states`;

  const validBody = {
    before: { status: 'open', severity: 'high', assignee: null },
    after: { status: 'closed', severity: 'high', resolution: 'repaired' },
    meta: {
      beforeAt: '2026-01-15T10:00:00.000Z',
      afterAt: '2026-01-16T10:00:00.000Z',
    },
  };

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', OTHER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on invalid body — meta missing beforeAt', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ before: {}, after: {}, meta: { afterAt: '2026-01-16T10:00:00.000Z' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — meta missing afterAt', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ before: {}, after: {}, meta: { beforeAt: '2026-01-15T10:00:00.000Z' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 happy path — detects changed and added fields in diff', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(validBody);

    expect(res.status).toBe(200);
    const { diff } = res.body as {
      diff: {
        beforeAt: string;
        afterAt: string;
        changedFields: Array<{ field: string; before: unknown; after: unknown }>;
      };
    };
    expect(diff.beforeAt).toBe(validBody.meta.beforeAt);
    expect(diff.afterAt).toBe(validBody.meta.afterAt);
    // 'status' changed, 'assignee' removed (null→undefined→gone in after), 'resolution' added.
    const fieldNames = diff.changedFields.map((f) => f.field).sort();
    // assignee: null vs undefined — shallow diff detects this change.
    // status: 'open' vs 'closed'.
    // resolution: undefined vs 'repaired'.
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('resolution');
  });

  it('200 — returns empty changedFields when before and after are identical', async () => {
    seedProject();
    const state = { status: 'open', severity: 'high' };
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ before: state, after: state, meta: validBody.meta });

    expect(res.status).toBe(200);
    expect(res.body.diff.changedFields).toEqual([]);
  });

  it('200 — diff accepts null/undefined states gracefully', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ before: null, after: { newField: 'value' }, meta: validBody.meta });

    expect(res.status).toBe(200);
    expect(res.body.diff.changedFields[0].field).toBe('newField');
  });

  it('200 — changedFields are sorted alphabetically for determinism', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        before: { z: 1, a: 1, m: 1 },
        after: { z: 2, a: 2, m: 2 },
        meta: validBody.meta,
      });

    expect(res.status).toBe(200);
    const names = res.body.diff.changedFields.map((f: { field: string }) => f.field);
    expect(names).toEqual([...names].sort());
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/event-replay/export-trail
// ────────────────────────────────────────────────────────────────────────

describe(`POST ${PREFIX}/:projectId/event-replay/export-trail`, () => {
  const url = (pid = PROJECT_ID) => `${PREFIX}/${pid}/event-replay/export-trail`;

  it('401 when no auth token is provided', async () => {
    const res = await request(buildApp()).post(url()).send({
      replays: [makeReplayResult()],
      format: 'markdown',
    });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', OTHER_UID)
      .send({ replays: [makeReplayResult()], format: 'markdown' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on invalid body — replays array is empty (min 1)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [], format: 'markdown' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — format not in allowed enum', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [makeReplayResult()], format: 'pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid body — missing replays field', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ format: 'csv' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 markdown format — trail is a string starting with compliance header', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [makeReplayResult()], format: 'markdown' });

    expect(res.status).toBe(200);
    expect(typeof res.body.trail).toBe('string');
    expect(res.body.trail).toContain('# Compliance Replay Trail');
    expect(res.body.trail).toContain('incidents/inc-1');
  });

  it('200 csv format — trail contains CSV header row', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [makeReplayResult()], format: 'csv' });

    expect(res.status).toBe(200);
    expect(typeof res.body.trail).toBe('string');
    expect(res.body.trail).toContain('query_id,entity_ref,point_in_time');
    expect(res.body.trail).toContain('incidents/inc-1');
  });

  it('200 — markdown trail includes event type breakdown section', async () => {
    seedProject();
    const replay = makeReplayResult({
      eventTypeBreakdown: { incident_created: 3, incident_updated: 1 },
    });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [replay], format: 'markdown' });

    expect(res.status).toBe(200);
    expect(res.body.trail).toContain('Event Type Breakdown');
    expect(res.body.trail).toContain('incident_created: 3');
    expect(res.body.trail).toContain('incident_updated: 1');
  });

  it('200 — csv format with multiple replays produces correct row count', async () => {
    seedProject();
    const replay1 = makeReplayResult();
    const replay2 = makeReplayResult({
      entityRef: 'incidents/inc-2',
      auditEntry: {
        ...makeReplayResult().auditEntry,
        queryId: 'audit|tenant-cl|incidents_inc-2|2026-01-16T00:00:00.000Z|uid-member|compliance_audit|1|2026-01-16T02:00:00.000Z',
      },
    });

    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [replay1, replay2], format: 'csv' });

    expect(res.status).toBe(200);
    const rows = res.body.trail.split('\n');
    // 1 header + 2 data rows.
    expect(rows).toHaveLength(3);
  });

  it('200 — markdown trail: (no events applied) shown when breakdown is empty', async () => {
    seedProject();
    const replay = makeReplayResult({ eventsApplied: 0, eventTypeBreakdown: {} });
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ replays: [replay], format: 'markdown' });

    expect(res.status).toBe(200);
    expect(res.body.trail).toContain('(no events applied)');
  });
});
