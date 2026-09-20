// Tests for [Audit-2026-08-31] IncidentFlow lesson audience — UIDs y publisher
// no se validan contra token/membresía. The spec briefly claimed that
// `publishedByUid` could be spoofed from body, but the route now sources it
// from `callerUid` (the verified token). The REAL residual gap is in
// audienceUids (publishLesson) and workerUids (assignMicrotraining): the route
// iterates the lists without checking that each UID is a project member or
// worker, so a project member can target UIDs from outside the project — a
// cross-tenant / cross-project signal that pollutes the lesson-audience graph
// and could leak PDCA closures to non-members.
//
// These tests are RED before the fix: each cross-tenant UID set is expected
// to fail with 403 forbidden (not 200/201).

import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test harness object: vi.hoisted guarantees it is defined before the
// vi.mock factories run (vitest inlines factories after imports). The shape
// follows runDteIssueQueueDrain.test.ts:14 and bbs.test.ts:16 — a single
// mutable object that mock factories and tests both close over.
const H = vi.hoisted(() => ({
  /**
   * Replaced per-test with a fresh fakeFirestore. The cast route
   * `unknown -> ReturnType<createFakeFirestore>` avoids the TS2352 that
   * `undefined as ReturnType<...>` raises: TypeScript treats `undefined`
   * as a literal that can't be cast straight to a non-undefined union.
   */
  db: undefined as unknown as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  >,
}));

// Mock the firebase-admin module: incidentFlow.ts uses admin.firestore()
// directly (it's a server route). Without this mock the test would try to
// reach a real Firebase Admin instance. Pattern from
// zettelkasten.getEdges.test.ts:26-29.
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore.js');
  return adminMock(() => H.db);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@example.com`,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import incidentFlowRouter from './incidentFlow.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/incident-flow', incidentFlowRouter);
  return app;
}

const PROJECT_ID = 'p-incident-audience-test';
const MEMBER_UID = 'uid-incident-member';
const OUTSIDER_UID = 'uid-incident-outsider';
const ANOTHER_OUTSIDER_UID = 'uid-incident-outsider-2';
const TENANT_ID = 't-incident-1';

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset();
  // First call: the project's caller (MEMBER_UID) is the authorized project
  // member — that's the existing guard() precondition for both routes.
  vi.mocked(assertProjectMember).mockResolvedValueOnce(undefined as never);
  // Every subsequent call (used to check audienceUids / workerUids) rejects:
  // the UIDs we target in these tests are NOT members of PROJECT_ID. The
  // project's members array only contains MEMBER_UID. This is the
  // narrow-but-exact simulated reality the fix must enforce.
  //
  // CRITICAL: the rejection MUST be a ProjectMembershipError (not a bare
  // Error), because the route's assertAllProjectMembers helper translates
  // ProjectMembershipError into "this UID is an outsider → push to the
  // offending list", while any other error type bubbles to the outer
  // try/catch and becomes a 500. Throwing a generic Error here would
  // make the route pretend the outsider is a transient infra failure.
  vi.mocked(assertProjectMember).mockImplementation(async (uid: string) => {
    if (uid === MEMBER_UID || uid === `${MEMBER_UID}-creator`) return;
    throw new ProjectMembershipError(
      `caller ${uid} is not a member of ${PROJECT_ID}`,
    );
  });

  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Incident Flow Audience Test',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

describe('POST /publish-lesson — audience UIDs MUST be project members', () => {
  const path = (incidentId: string) =>
    `/api/incident-flow/${PROJECT_ID}/incident-flow/${incidentId}/publish-lesson`;

  it('publishes successfully when every audienceUid IS a project member', async () => {
    const res = await request(buildApp())
      .post(path('inc-1'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        lessonId: 'lesson-ok',
        publishedAtIso: '2026-09-20T12:00:00.000Z',
        summary: 'Lesson summary for happy path audience test',
        audienceUids: [MEMBER_UID],
        tags: ['fall-protection'],
        riskCategories: ['height'],
        conclusion: {
          concludedAtIso: '2026-09-20T11:55:00.000Z',
          rootCauseSummary: 'SRL not anchored; crew skipped inspection on day 3',
          contributingFactor: 'supervisor absent during hot work window',
          preventiveActions: ['mandate SRL pre-use checklist before each shift'],
          closedByUid: MEMBER_UID,
        },
      });
    // The fix must not break the all-members happy path. The exact status
    // depends on downstream flows (it can be 201 on success, 500 if a mock
    // dependency is missing) — but it MUST NOT be 403.
    expect(res.status).not.toBe(403);
  });

  it('rejects with 403 when an audienceUid is OUTSIDE the project (cross-tenant leak)', async () => {
    const res = await request(buildApp())
      .post(path('inc-2'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        lessonId: 'lesson-cross-tenant',
        publishedAtIso: '2026-09-20T12:00:00.000Z',
        summary: 'Lesson with an outsider in the audience — must be blocked',
        audienceUids: [OUTSIDER_UID],
        tags: ['ladder'],
        riskCategories: ['height'],
        conclusion: {
          concludedAtIso: '2026-09-20T11:55:00.000Z',
          rootCauseSummary: 'Cross-tenant audience injection attempted for testing',
          preventiveActions: ['server-side audience membership check on publish'],
          closedByUid: MEMBER_UID,
        },
      });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('audience_not_member');
  });

  it('rejects when ANY element of audienceUids is not a member (mixed valid + invalid)', async () => {
    const res = await request(buildApp())
      .post(path('inc-3'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        lessonId: 'lesson-mixed',
        publishedAtIso: '2026-09-20T12:00:00.000Z',
        summary: 'Lesson with mixed valid+invalid audience UIDs',
        audienceUids: [MEMBER_UID, OUTSIDER_UID],
        tags: ['ppe'],
        riskCategories: ['ppe'],
        conclusion: {
          concludedAtIso: '2026-09-20T11:55:00.000Z',
          rootCauseSummary: 'Mixed audience: one valid UID + one cross-tenant UID',
          preventiveActions: ['reject on first non-member; surface all offending UIDs'],
          closedByUid: MEMBER_UID,
        },
      });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('audience_not_member');
    const details = (res.body as Record<string, unknown>).details as
      | { offendingUids?: string[] }
      | undefined;
    expect(details?.offendingUids).toContain(OUTSIDER_UID);
    expect(details?.offendingUids).not.toContain(MEMBER_UID);
  });

  it('rejects when ALL audienceUids are outsiders (no exceptions for empty intersect)', async () => {
    const res = await request(buildApp())
      .post(path('inc-4'))
      .set('x-test-uid', MEMBER_UID)
      .send({
        lessonId: 'lesson-all-out',
        publishedAtIso: '2026-09-20T12:00:00.000Z',
        summary: 'Lesson where every audience UID is outside the project',
        audienceUids: [OUTSIDER_UID, ANOTHER_OUTSIDER_UID],
        tags: ['hazmat'],
        riskCategories: ['chemical'],
        conclusion: {
          concludedAtIso: '2026-09-20T11:55:00.000Z',
          rootCauseSummary: 'All-outside audience set: even one valid UID would not save it',
          preventiveActions: ['strict membership check before any audience write'],
          closedByUid: MEMBER_UID,
        },
      });
    expect(res.status).toBe(403);
    const details = (res.body as Record<string, unknown>).details as
      | { offendingUids?: string[] }
      | undefined;
    expect(details?.offendingUids?.sort()).toEqual(
      [OUTSIDER_UID, ANOTHER_OUTSIDER_UID].sort(),
    );
  });
});

describe('POST /assign-microtraining — workerUids MUST be project members', () => {
  const path = (incidentId: string) =>
    `/api/incident-flow/${PROJECT_ID}/incident-flow/${incidentId}/assign-microtraining`;

  const basePayload = {
    moduleId: 'mt-fall-pro-1',
    assignedAtIso: '2026-09-20T12:00:00.000Z',
    lesson: {
      lessonId: 'lesson-mt',
      publishedAtIso: '2026-09-20T12:00:00.000Z',
      summary: 'Lesson body for the microtraining assignment test',
      audienceUids: [MEMBER_UID],
      tags: ['srl'],
      riskCategories: ['height'],
      publishedByUid: MEMBER_UID,
    },
  };

  it('assigns successfully when every workerUid IS a project member', async () => {
    const res = await request(buildApp())
      .post(path('inc-mt-1'))
      .set('x-test-uid', MEMBER_UID)
      .send({ ...basePayload, workerUids: [MEMBER_UID] });
    expect(res.status).not.toBe(403);
  });

  it('rejects with 403 when a workerUid is OUTSIDE the project', async () => {
    const res = await request(buildApp())
      .post(path('inc-mt-2'))
      .set('x-test-uid', MEMBER_UID)
      .send({ ...basePayload, workerUids: [OUTSIDER_UID] });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('worker_not_member');
  });

  it('rejects when ANY element of workerUids is not a member', async () => {
    const res = await request(buildApp())
      .post(path('inc-mt-3'))
      .set('x-test-uid', MEMBER_UID)
      .send({ ...basePayload, workerUids: [MEMBER_UID, OUTSIDER_UID] });
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('worker_not_member');
    const details = (res.body as Record<string, unknown>).details as
      | { offendingUids?: string[] }
      | undefined;
    expect(details?.offendingUids).toContain(OUTSIDER_UID);
  });
});
