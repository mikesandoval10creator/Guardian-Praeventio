// Real-router supertest for src/server/routes/efficacyVerification.ts
// (Plan v3 Fase 1 — server lever, Sprint 44 F.11).
//
// Route is mounted at /api/sprint-k in server.ts:
//   app.use('/api/sprint-k', efficacyVerificationRouter)
//
// Two stateless POST endpoints (pure compute, no Firestore writes):
//   POST /:projectId/efficacy/verify         → { result: EfficacyVerificationResult }
//   POST /:projectId/efficacy/default-window → { window: PostActionWindow }
//
// The route uses:
//   verifyAuth         — gate on x-test-uid presence (mocked)
//   validate(schema)   — Zod 400 guard
//   guard()            — assertProjectMember reads Firestore (fakeFirestore)
//
// Bug coverage: verifyEfficacyInputSchema was z.unknown() (accepted undefined
// → 500 when body.input is absent). Fixed to z.record() → now returns 400.

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

import efficacyVerificationRouter from '../../server/routes/efficacyVerification.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', efficacyVerificationRouter);
  return app;
}

const PROJECT_ID = 'p-efficacy-test';
const CALLER_UID = 'uid-efficacy-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Efficacy Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable fixture payloads
// ────────────────────────────────────────────────────────────────────────────

/** Minimal valid VerifyEfficacyInput — no recurrences, effective outcome. */
const minEfficacyInput = {
  baseline: {
    incidentId: 'inc-001',
    riskKind: 'caida-altura',
    severity: 'medium',
    preIncidenceRate30d: 2,
    conditions: { location: 'Planta A', crewKind: 'soldadura' },
  },
  window: {
    windowStart: '2025-01-01T00:00:00.000Z',
    windowEnd: '2025-01-31T00:00:00.000Z',
    recurrenceIncidents: [],
    leadingIndicators: {
      positiveObservations: 5,
      controlVerificationsCount: 3,
    },
  },
  actions: [
    {
      id: 'act-001',
      title: 'Instalar barandas',
      level: 'engineering',
      closedAt: '2025-01-01T00:00:00.000Z',
      closedByUid: CALLER_UID,
      evidenceCount: 2,
    },
  ],
};

/** A 'now' that is past the window end → window is complete → full score. */
const NOW_PAST_WINDOW = '2025-02-15T00:00:00.000Z';

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/efficacy/verify
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/efficacy/verify', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/efficacy/verify`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ input: minEfficacyInput });
    expect(res.status).toBe(401);
  });

  it('400 when body.input is missing (post-fix bug probe: used to be 500)', async () => {
    // Before fix: z.unknown() accepted undefined → engine dereferenced
    // input.window.windowStart → TypeError → 500.
    // After fix: z.record() rejects missing field → 400 invalid_payload.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ now: NOW_PAST_WINDOW }); // input field absent
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when body.input is a scalar (string), not an object', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: 'not-an-object', now: NOW_PAST_WINDOW });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ input: minEfficacyInput, now: NOW_PAST_WINDOW });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/efficacy/verify`)
      .set('x-test-uid', CALLER_UID)
      .send({ input: minEfficacyInput, now: NOW_PAST_WINDOW });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — effective verdict for clean window', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: minEfficacyInput, now: NOW_PAST_WINDOW });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.verdict).toBe('effective');
    expect(typeof result.score).toBe('number');
    expect((result.score as number)).toBeGreaterThanOrEqual(80);
    expect(result.recommendation).toBe('ratify_close');
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(Array.isArray(result.reopenTriggers)).toBe(true);
    expect(typeof result.evaluatedAt).toBe('string');
    expect(typeof result.windowDays).toBe('number');
  });

  it('200 with recurrences → partially_effective or ineffective verdict', async () => {
    const inputWithRecurrences = {
      ...minEfficacyInput,
      window: {
        ...minEfficacyInput.window,
        recurrenceIncidents: [
          {
            incidentId: 'rec-001',
            occurredAt: '2025-01-15T00:00:00.000Z',
            sameLocation: true,
            sameCrew: false,
            severity: 'medium',
          },
        ],
      },
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: inputWithRecurrences, now: NOW_PAST_WINDOW });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(['partially_effective', 'ineffective', 'inconclusive']).toContain(result.verdict);
    expect((result.score as number)).toBeLessThan(80);
    expect((result.reopenTriggers as string[]).some((t) => t.startsWith('recurrence'))).toBe(true);
  });

  it('200 window incomplete — engine clamps score to ≤60 → partially_effective', async () => {
    // now is before windowEnd → engine applies: if (!windowComplete && score>=80 ...)
    // score = Math.min(score, 60). Score 60 falls in partially_effective band (55-79).
    // The engine does NOT force 'inconclusive' — it clamps and verdicts normally.
    const nowBeforeWindow = '2025-01-15T00:00:00.000Z'; // mid-window
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: minEfficacyInput, now: nowBeforeWindow });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    // Clamped to 60 → partially_effective
    expect(result.verdict).toBe('partially_effective');
    expect((result.score as number)).toBeLessThanOrEqual(60);
    expect((result.reopenTriggers as string[])).toContain('window_incomplete');
  });

  it('200 no actions → ineffective verdict (score forced ≤25)', async () => {
    const inputNoActions = { ...minEfficacyInput, actions: [] };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: inputNoActions, now: NOW_PAST_WINDOW });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    expect(result.verdict).toBe('ineffective');
    expect((result.reopenTriggers as string[])).toContain('no_actions_recorded');
  });

  it('200 now param respected — evaluatedAt matches provided now string', async () => {
    const specificNow = '2025-03-01T12:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ input: minEfficacyInput, now: specificNow });
    expect(res.status).toBe(200);
    const { result } = res.body as { result: Record<string, unknown> };
    // evaluatedAt must equal the provided ISO string
    expect(result.evaluatedAt).toBe(specificNow);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/efficacy/default-window
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/efficacy/default-window', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/efficacy/default-window`;
  const CLOSED_AT = '2025-01-01T00:00:00.000Z';

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send({ closedAt: CLOSED_AT });
    expect(res.status).toBe(401);
  });

  it('400 when closedAt is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when closedAt is too short (fewer than 10 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: '2025-01' }); // 7 chars, min is 10
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when windowDays is negative', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT, windowDays: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when windowDays exceeds 365', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT, windowDays: 400 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ closedAt: CLOSED_AT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — default 30-day window from closedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT });
    expect(res.status).toBe(200);
    const { window } = res.body as {
      window: {
        windowStart: string;
        windowEnd: string;
        recurrenceIncidents: unknown[];
        leadingIndicators: Record<string, unknown>;
      };
    };
    expect(window.windowStart).toBe(CLOSED_AT);
    // Default 30 days: 2025-01-01 + 30d = 2025-01-31
    expect(window.windowEnd).toBe('2025-01-31T00:00:00.000Z');
    expect(Array.isArray(window.recurrenceIncidents)).toBe(true);
    expect(window.recurrenceIncidents).toHaveLength(0);
    expect(typeof window.leadingIndicators).toBe('object');
  });

  it('200 custom windowDays respected', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT, windowDays: 60 });
    expect(res.status).toBe(200);
    const { window } = res.body as { window: { windowEnd: string } };
    // 60 days from 2025-01-01 = 2025-03-02
    expect(window.windowEnd).toBe('2025-03-02T00:00:00.000Z');
  });

  it('200 recurrences optional field — z.unknown() accepts undefined (field absent → uses default [])', async () => {
    // windowRecurrenceSchema stays z.unknown() (field is optional + engine defaults to []).
    // Sending the field absent must still return 200 with empty recurrenceIncidents.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT }); // no recurrences field
    expect(res.status).toBe(200);
    const { window } = res.body as { window: { recurrenceIncidents: unknown[] } };
    expect(window.recurrenceIncidents).toEqual([]);
  });

  it('200 leading optional field — z.unknown() accepts undefined (field absent → uses default {})', async () => {
    // windowLeadingSchema stays z.unknown() (field is optional + engine defaults to {}).
    // Sending the field absent must still return 200 with empty leadingIndicators.
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT }); // no leading field
    expect(res.status).toBe(200);
    const { window } = res.body as { window: { leadingIndicators: Record<string, unknown> } };
    expect(typeof window.leadingIndicators).toBe('object');
  });

  it('200 with recurrences and leading indicators passthrough', async () => {
    const recurrences = [
      {
        incidentId: 'rec-001',
        occurredAt: '2025-01-10T00:00:00.000Z',
        sameLocation: true,
        sameCrew: false,
        severity: 'low',
      },
    ];
    const leading = { positiveObservations: 3, controlVerificationsCount: 2 };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ closedAt: CLOSED_AT, recurrences, leading });
    expect(res.status).toBe(200);
    const { window } = res.body as {
      window: {
        recurrenceIncidents: typeof recurrences;
        leadingIndicators: typeof leading;
      };
    };
    expect(window.recurrenceIncidents).toHaveLength(1);
    expect(window.recurrenceIncidents[0].incidentId).toBe('rec-001');
    expect(window.leadingIndicators.positiveObservations).toBe(3);
  });
});
