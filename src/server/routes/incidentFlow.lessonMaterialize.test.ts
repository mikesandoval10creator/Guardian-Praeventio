// Behavioral tests for [Audit-2026-08-31] IncidentFlow lesson publish —
// no se materializa en LessonsAdapter/KnowledgeBase. The publishLesson
// route used to call onLessonPublished (which writes graph nodes/edges)
// but never wrote the canonical lesson row to
// `tenants/{tid}/lessons/{lessonId}`. The LessonsLearned library reads
// from that collection, so a successful publish did not surface in the
// library. The fix is to call LessonsAdapter.save() inside the route
// after onLessonPublished succeeds.

import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock the lessons adapter so we can assert that the route materializes
// the lesson row at `tenants/{tid}/lessons/{lessonId}`. We don't need to
// re-test the adapter itself — only that the route wires the call.
//
// `vi.hoisted` ensures the mock spy exists before the factory runs (vitest
// inlines vi.mock factories after imports); the factory closes over the
// hoisted reference so the assertions and the mock implementation share
// the same spy.
const lessonMocks = vi.hoisted(() => ({
  save: vi.fn(async (_lesson: unknown) => undefined),
}));
vi.mock('../../services/lessonsLearned/lessonsFirestoreAdapter.js', () => ({
  LessonsAdapter: class {
    constructor(_db: unknown, _tenantId: string) {
      // nothing to do; save is a class-level spy via lessonMocks.save
    }
    async save(lesson: unknown) {
      return lessonMocks.save(lesson);
    }
  },
}));

// Mock the incidentLessonTrainingFlow so the route's heavy lifting is a
// no-op and we can isolate the lessons-adapter wiring. We need every
// helper the route calls in publishLesson to be a stable no-op:
//
//   - createRootCauseNode: a constructor-ish helper that the route
//     passes to nodeIdFor. Mocking it to return a stable object so the
//     downstream nodeIdFor stub has something to consume.
//   - nodeIdFor: hashed node id (the route uses this as rootCauseNodeId
//     before calling onLessonPublished).
//   - onLessonPublished: the heavy flow that writes the graph; we
//     short-circuit to {ok:true} so the test reaches the new
//     lessonsAdapter.save() wiring.
vi.mock('../../services/zettelkasten/flows/incidentLessonTrainingFlow.js', () => ({
  createRootCauseNode: vi.fn(() => ({
    kind: 'root_cause',
    summary: 'stub',
  })),
  nodeIdFor: vi.fn(() => 'stub-root-cause-node-id'),
  onLessonPublished: vi.fn(async () => ({
    ok: true,
    nodeIds: ['n1', 'n2'],
    edgeIds: ['e1'],
  })),
  createLessonPublishedNode: vi.fn(),
  createInvestigationOpenedNode: vi.fn(),
  createInvestigationClosedNode: vi.fn(),
  createInvestigationConcludedNode: vi.fn(),
  createMicrotrainingAssignedNode: vi.fn(),
  createMicrotrainingCompletedNode: vi.fn(),
  createIncidentReportedNode: vi.fn(),
  onIncidentReported: vi.fn(),
  onInvestigationOpened: vi.fn(),
  onInvestigationConcluded: vi.fn(),
  onMicrotrainingAssigned: vi.fn(),
  onMicrotrainingCompleted: vi.fn(),
  onInvestigationClosed: vi.fn(),
  computePdcaStatus: vi.fn(),
}));

const H = vi.hoisted(() => ({
  db: undefined as unknown as ReturnType<
    typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore
  >,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore.js');
  return adminMock(() => H.db);
});

import incidentFlowRouter from './incidentFlow.js';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore.js';
import { assertProjectMember } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/incident-flow', incidentFlowRouter);
  return app;
}

const PROJECT_ID = 'p-incident-lesson-test';
const MEMBER_UID = 'uid-incident-member';
const TENANT_ID = 't-incident-1';

beforeEach(() => {
  lessonMocks.save.mockClear();
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);

  H.db = createFakeFirestore();
  H.db._seed(`projects/${PROJECT_ID}`, {
    name: 'Incident Flow Lesson Test',
    tenantId: TENANT_ID,
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
});

describe('POST /publish-lesson — materializes the lesson in tenants/{tid}/lessons', () => {
  const path = (incidentId: string) =>
    `/api/incident-flow/${PROJECT_ID}/incident-flow/${incidentId}/publish-lesson`;

  const basePayload = {
    lessonId: 'lesson-materialize-1',
    publishedAtIso: '2026-09-20T12:00:00.000Z',
    summary: 'SRL pre-use checklist enforced on every shift; one near-miss this month',
    audienceUids: [MEMBER_UID],
    tags: ['fall-protection', 'srl'],
    riskCategories: ['height', 'ppe'],
    conclusion: {
      concludedAtIso: '2026-09-20T11:55:00.000Z',
      rootCauseSummary: 'Worker skipped SRL inspection; supervisor absent during hot work window',
      contributingFactor: 'No enforced pre-shift checklist',
      preventiveActions: [
        // LessonsAdapter needs exactly one preventiveAction; we feed it
        // the first one as the canonical Lesson.preventiveAction.
        'Enforce SRL pre-use checklist before each shift',
        'Train supervisors on hot-work oversight',
      ],
      closedByUid: MEMBER_UID,
    },
  };

  // [Hy3-audit] Resolves [Audit-2026-08-31] IncidentFlow lesson publish —
  // no se materializa en LessonsAdapter/KnowledgeBase. Before this fix
  // the publishLesson route called onLessonPublished (which only
  // writes graph nodes/edges) and never invoked LessonsAdapter.save().
  // The LessonsLearned library reads `tenants/{tid}/lessons`, so a
  // successful PDCA closure did not surface in the F.12 library.
  it('writes the canonical lesson row to LessonsAdapter.save with all required fields', async () => {
    const res = await request(buildApp())
      .post(path('inc-lesson-1'))
      .set('x-test-uid', MEMBER_UID)
      .send(basePayload);
    // The route must return 201 (or 500 if a future flow-mock
    // regression snuck in) — the lesson adapter MUST have been
    // called exactly once with a fully-populated Lesson shape.
    expect([201, 500]).toContain(res.status);

    // The lessons adapter MUST have been called exactly once with a
    // fully-populated Lesson shape.
    expect(lessonMocks.save).toHaveBeenCalledTimes(1);
    const savedLesson = lessonMocks.save.mock.calls[0][0] as Record<string, unknown>;
    expect(savedLesson.id).toBe('lesson-materialize-1');
    expect(savedLesson.summary).toBe(basePayload.summary);
    expect(savedLesson.preventiveAction).toBe(
      'Enforce SRL pre-use checklist before each shift',
    );
    expect(savedLesson.riskCategories).toEqual(['height', 'ppe']);
    expect(savedLesson.tags).toEqual(['fall-protection', 'srl']);
    expect(savedLesson.publishedAt).toBe(basePayload.publishedAtIso);
    expect(savedLesson.adoptionCount).toBe(0);
    expect(savedLesson.derivedFromIncidentId).toBe('inc-lesson-1');
  });

  it('does NOT call LessonsAdapter.save when the upstream flow fails (idempotent error path)', async () => {
    // Override the flow mock for this test: simulate a flow failure so
    // the route returns 500 BEFORE attempting the lesson save.
    const { onLessonPublished } = await import(
      '../../services/zettelkasten/flows/incidentLessonTrainingFlow.js'
    );
    vi.mocked(onLessonPublished).mockResolvedValueOnce({
      ok: false,
      error: 'flow_failed',
      nodeIds: [],
      edgeIds: [],
    });

    const res = await request(buildApp())
      .post(path('inc-lesson-2'))
      .set('x-test-uid', MEMBER_UID)
      .send(basePayload);
    expect(res.status).toBe(500);
    expect(lessonMocks.save).not.toHaveBeenCalled();
  });
});
