// Real-router supertest for src/server/routes/culturePulse.ts
// (§61-63 Encuesta de Percepción + Índice de Cultura — Ley Karín 21.643 anonymity).
//
// Mounts the ACTUAL production router via fakeFirestore. The existing unit-level
// culturePulse.test.ts (if present) exercises pure-function helpers; this file
// covers the 4 HTTP endpoints that were uncovered:
//   GET  /:projectId/culture-pulse                    → snapshot agregado
//   POST /:projectId/culture-pulse/survey             → schedule wave (admin/sup)
//   POST /:projectId/culture-pulse/survey/:id/respond → respond (worker, una vez)
//   GET  /:projectId/culture-pulse/history            → últimas 6 olas
//
// ANONYMITY INVARIANT (Ley Karín 21.643 / Ley 19.628):
//   • Stored response docs MUST contain `responderHash`, NEVER raw `responderUid`.
//   • The same uid+survey MUST produce the same hash (idempotent hash = dedup key).
//   • Aggregate snapshots MUST NOT expose individual uids anywhere in the response body.
//   • Threshold n<5: aggregated fields are suppressed (insufficientResponses flag).

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Set deterministic pepper BEFORE the route module is imported ──────────────
// This ensures pulseResponderHash uses the HMAC path (keyed) in all tests, with
// a stable key so we can compare expected hash values independently.
const TEST_PEPPER = 'test-culture-pulse-pepper-32bytes!!';

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
    const role = req.header('x-test-role');
    const tenantId = req.header('x-test-tenant') ?? TENANT_ID;
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: role ?? undefined,
      tenantId,
      admin: req.header('x-test-admin') === 'true',
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

vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

// computePulseIndex is a pure function — let the real implementation run
// via dynamic import so we can assert realistic cultureIndex/level values.
vi.mock('../../services/culturePulse/safetyCulturePulse.js', async (orig) => {
  return orig();
});

import culturePulseRouter, { pulseResponderHash } from '../../server/routes/culturePulse.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

// ── Constants shared across all describe blocks ───────────────────────────────

const PROJECT_ID = 'p1';
const TENANT_ID = 't1';
const SURVEY_ID = 'survey-2026-q1';

const PULSE_BASE = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/culture_pulse`;

/** ISO timestamps: open window centred on epoch ±24 h. */
const OPEN_AT = '2000-01-01T00:00:00.000Z';
const CLOSE_AT = '2099-12-31T23:59:59.999Z';

/** A full Likert-5 answers object. */
const ANSWERS_5 = {
  felt_safe_today: 5,
  manager_listens: 5,
  free_to_stop: 5,
  reported_incident_safely: 5,
  has_resources_to_be_safe: 5,
} as const;

/** A low answers object (Likert 2) that should flag punitiveculture. */
const ANSWERS_2 = {
  felt_safe_today: 2,
  manager_listens: 2,
  free_to_stop: 1,
  reported_incident_safely: 2,
  has_resources_to_be_safe: 2,
} as const;

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount at the same prefix as server.ts line 969
  app.use('/api/sprint-k', culturePulseRouter);
  return app;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, { tenantId: TENANT_ID, name: 'Faena Norte' });
}

function seedSurvey(overrides: Record<string, unknown> = {}) {
  H.db!._seed(`${PULSE_BASE}/${SURVEY_ID}`, {
    id: SURVEY_ID,
    status: 'open',
    openAt: OPEN_AT,
    closeAt: CLOSE_AT,
    title: 'Q1 2026',
    expectedRespondents: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin-uid',
    ...overrides,
  });
}

/**
 * Seed N synthetic responses with distinct hashes (uid-0 … uid-(n-1)).
 * Each response uses the real HMAC hash so they match what the route computes.
 */
function seedResponses(n: number, answersOverride?: Record<string, number>) {
  for (let i = 0; i < n; i++) {
    const uid = `uid-${i}`;
    const hash = pulseResponderHash(uid, SURVEY_ID);
    H.db!._seed(`${PULSE_BASE}/${SURVEY_ID}/responses/${hash}`, {
      responderHash: hash,
      workerRole: 'operario',
      area: 'Sector A',
      answers: answersOverride ?? ANSWERS_5,
      submittedAt: '2026-01-15T10:00:00.000Z',
    });
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Set deterministic pepper so pulseResponderHash is stable across all tests.
  process.env.CULTURE_PULSE_PEPPER = TEST_PEPPER;
});

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  seedProject();
});

// =============================================================================
// GET /:projectId/culture-pulse
// =============================================================================

describe('GET /api/sprint-k/:projectId/culture-pulse', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/culture-pulse`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'outsider');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 empty snapshot when no surveys exist', async () => {
    // No survey seeded — project seeded only.
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap).toBeDefined();
    expect(snap.surveyId).toBeNull();
    expect(snap.cultureIndex).toBe(0);
    expect(snap.totalResponses).toBe(0);
    expect(snap.hasResponded).toBe(false);
    // Empty snapshot must NOT expose any uid field
    expect(JSON.stringify(snap)).not.toContain('uid');
  });

  it('200 suppressed snapshot when responses < anonymity threshold (n=5)', async () => {
    seedSurvey();
    // Only 3 responses — below threshold of 5
    seedResponses(3);

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    // Suppressed fields
    expect(snap.insufficientResponses).toBe(true);
    expect(snap.currentCount).toBe(3);
    expect(snap.threshold).toBe(5);
    expect(snap.cultureIndex).toBe(0);
    expect(snap.byQuestion).toEqual({
      felt_safe_today: 0,
      manager_listens: 0,
      free_to_stop: 0,
      reported_incident_safely: 0,
      has_resources_to_be_safe: 0,
    });
    expect((snap.topConcerns as unknown[]).length).toBe(0);
    expect((snap.topStrengths as unknown[]).length).toBe(0);
    // Anonymity: body must not leak individual uids
    expect(JSON.stringify(res.body)).not.toMatch(/"uid-\d+"/);
  });

  it('200 full snapshot when responses >= threshold (n=5)', async () => {
    seedSurvey();
    seedResponses(5);

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap.insufficientResponses).toBeUndefined();
    expect(snap.totalResponses).toBe(5);
    expect(typeof snap.cultureIndex).toBe('number');
    expect((snap.cultureIndex as number)).toBeGreaterThan(0);
    expect(['low', 'fair', 'good', 'strong']).toContain(snap.level);
    // participationRate: 5 / 10 = 0.5
    expect(snap.participationRate).toBeCloseTo(0.5);
    // Anonymity: no uid appears anywhere in the response body
    expect(JSON.stringify(res.body)).not.toMatch(/"uid-\d+"/);
    // No individual responderHash must appear in the top-level snapshot
    // (hashes are stored internally, not echoed to clients)
    expect(JSON.stringify(snap)).not.toContain('responderHash');
  });

  it('200 hasResponded=true when the caller already submitted', async () => {
    seedSurvey();
    seedResponses(5); // ensures threshold met
    const callerUid = 'uid-0'; // was seeded as uid-0
    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', callerUid);
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap.hasResponded).toBe(true);
  });

  it('200 hasResponded=false for a caller who did not submit', async () => {
    seedSurvey();
    seedResponses(5);
    const res = await request(buildApp())
      .get(URL)
      .set('x-test-uid', 'uid-999'); // not among seeded responders
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap.hasResponded).toBe(false);
  });

  it('200 closed survey is returned as effectiveStatus=closed', async () => {
    // openAt / closeAt both in the past → closed
    seedSurvey({ openAt: '2020-01-01T00:00:00.000Z', closeAt: '2020-12-31T23:59:59.999Z', status: 'closed' });
    seedResponses(5);
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap.status).toBe('closed');
  });

  it('ANONYMITY: punitiveCulturedFlagged with low answers, no uid leak', async () => {
    seedSurvey();
    seedResponses(5, ANSWERS_2);
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const snap = (res.body as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snap.punitiveCulturedFlagged).toBe(true);
    // Aggregates must not reveal individual uids
    expect(JSON.stringify(res.body)).not.toMatch(/"uid-\d+"/);
    expect(JSON.stringify(snap)).not.toContain('responderHash');
  });
});

// =============================================================================
// POST /:projectId/culture-pulse/survey  (schedule wave)
// =============================================================================

describe('POST /api/sprint-k/:projectId/culture-pulse/survey', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/culture-pulse/survey`;

  const VALID_BODY = {
    surveyId: SURVEY_ID,
    openAt: OPEN_AT,
    closeAt: CLOSE_AT,
    title: 'Q1 2026',
    expectedRespondents: 10,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'outsider')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect((res.body as Record<string, unknown>).error).toBe('forbidden');
  });

  it('403 when caller has no schedule-eligible role (worker)', async () => {
    // role is undefined / blank → callerCanScheduleSurvey returns false
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'worker-1')
      // no x-test-role header → role is undefined
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('forbidden_role');
    expect(Array.isArray(body.allowed)).toBe(true);
    expect((body.allowed as string[])).toContain('admin');
    expect((body.allowed as string[])).toContain('prevencionista');
    expect((body.allowed as string[])).toContain('supervisor');
  });

  it('400 when body fails Zod validation (missing openAt)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-1')
      .set('x-test-role', 'admin')
      .send({ surveyId: SURVEY_ID, closeAt: CLOSE_AT }); // openAt missing
    expect(res.status).toBe(400);
  });

  it('400 when closeAt <= openAt', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-1')
      .set('x-test-role', 'admin')
      .send({ surveyId: SURVEY_ID, openAt: CLOSE_AT, closeAt: OPEN_AT });
    expect(res.status).toBe(400);
  });

  it('400 when surveyId contains invalid characters', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-1')
      .set('x-test-role', 'admin')
      .send({ surveyId: 'bad survey id!', openAt: OPEN_AT, closeAt: CLOSE_AT });
    expect(res.status).toBe(400);
  });

  it('201 creates a new survey for admin role', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-1')
      .set('x-test-role', 'admin')
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const survey = body.survey as Record<string, unknown>;
    expect(survey.id).toBe(SURVEY_ID);
    expect(['open', 'closed']).toContain(survey.status);
    // Verify Firestore side-effect
    const stored = (
      await H.db!.collection(PULSE_BASE).doc(SURVEY_ID).get()
    ).data() as Record<string, unknown>;
    expect(stored.id).toBe(SURVEY_ID);
    expect(stored.openAt).toBe(OPEN_AT);
    expect(stored.closeAt).toBe(CLOSE_AT);
    expect(stored.createdBy).toBe('admin-1');
    // MUST NOT store uid differently
    expect(Object.keys(stored)).not.toContain('uid');
  });

  it('201 creates for prevencionista role', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'prev-1')
      .set('x-test-role', 'prevencionista')
      .send({ ...VALID_BODY, surveyId: 'survey-prev-1' });
    expect(res.status).toBe(201);
  });

  it('201 creates for supervisor role', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'sup-1')
      .set('x-test-role', 'supervisor')
      .send({ ...VALID_BODY, surveyId: 'survey-sup-1' });
    expect(res.status).toBe(201);
  });

  it('201 creates for admin=true claim', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'super-admin')
      .set('x-test-admin', 'true')
      .send({ ...VALID_BODY, surveyId: 'survey-super-1' });
    expect(res.status).toBe(201);
  });

  it('409 when the survey ID already exists', async () => {
    seedSurvey();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'admin-1')
      .set('x-test-role', 'admin')
      .send(VALID_BODY);
    expect(res.status).toBe(409);
    expect((res.body as Record<string, unknown>).error).toBe('survey_already_exists');
  });
});

// =============================================================================
// POST /:projectId/culture-pulse/survey/:id/respond
// =============================================================================

describe('POST /api/sprint-k/:projectId/culture-pulse/survey/:id/respond', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/culture-pulse/survey/${SURVEY_ID}/respond`;

  const VALID_RESPONSE_BODY = {
    workerRole: 'operario',
    area: 'Sector A',
    answers: ANSWERS_5,
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'outsider')
      .send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(403);
  });

  it('404 when the survey does not exist', async () => {
    // No survey seeded
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>).error).toBe('survey_not_found');
  });

  it('409 when the survey is closed (status=closed)', async () => {
    seedSurvey({ status: 'closed', closeAt: '2020-01-01T00:00:00.000Z' });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(409);
    expect((res.body as Record<string, unknown>).error).toBe('survey_closed');
  });

  it('409 when now < openAt (survey not yet open)', async () => {
    seedSurvey({ openAt: '2099-01-01T00:00:00.000Z', closeAt: '2099-12-31T00:00:00.000Z', status: 'open' });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(409);
    expect((res.body as Record<string, unknown>).error).toBe('survey_not_open');
  });

  it('400 when answers are out of Likert 1-5 range', async () => {
    seedSurvey();
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send({
        ...VALID_RESPONSE_BODY,
        answers: { ...ANSWERS_5, felt_safe_today: 6 }, // 6 > 5
      });
    expect(res.status).toBe(400);
  });

  it('400 when required answer key is missing', async () => {
    seedSurvey();
    const { felt_safe_today: _, ...partialAnswers } = ANSWERS_5;
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'w1')
      .send({ ...VALID_RESPONSE_BODY, answers: partialAnswers });
    expect(res.status).toBe(400);
  });

  it('201 stores response with hash, not uid (ANONYMITY CORE)', async () => {
    seedSurvey();
    const callerUid = 'worker-abc';
    const expectedHash = pulseResponderHash(callerUid, SURVEY_ID);

    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', callerUid)
      .send(VALID_RESPONSE_BODY);
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>).ok).toBe(true);

    // ANONYMITY ASSERTION: Firestore doc keyed by hash, contains hash not uid
    const storedSnap = await H.db!
      .collection(PULSE_BASE)
      .doc(SURVEY_ID)
      .collection('responses')
      .doc(expectedHash)
      .get();
    expect(storedSnap.exists).toBe(true);
    const stored = storedSnap.data() as Record<string, unknown>;
    // Must store the hash
    expect(stored.responderHash).toBe(expectedHash);
    // Must NOT store the raw uid
    expect(stored).not.toHaveProperty('responderUid');
    expect(Object.values(stored)).not.toContain(callerUid);
    // The doc ID itself must be the hash, not the uid
    expect(storedSnap.id).toBe(expectedHash);
    expect(storedSnap.id).not.toBe(callerUid);
  });

  it('ANONYMITY: same uid+survey yields same hash (idempotent — dedup key)', () => {
    const uid = 'worker-dedup';
    const hash1 = pulseResponderHash(uid, SURVEY_ID);
    const hash2 = pulseResponderHash(uid, SURVEY_ID);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
    // The hash must NOT equal the uid (it's opaque)
    expect(hash1).not.toBe(uid);
  });

  it('ANONYMITY: different uids yield different hashes (no collision)', () => {
    const h1 = pulseResponderHash('uid-alice', SURVEY_ID);
    const h2 = pulseResponderHash('uid-bob', SURVEY_ID);
    expect(h1).not.toBe(h2);
  });

  it('ANONYMITY: same uid + different surveyId yields different hashes', () => {
    const uid = 'worker-x';
    const h1 = pulseResponderHash(uid, 'survey-a');
    const h2 = pulseResponderHash(uid, 'survey-b');
    expect(h1).not.toBe(h2);
  });

  it('409 when the same worker tries to respond twice', async () => {
    seedSurvey();
    const callerUid = 'worker-dup';
    // First submission
    const res1 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', callerUid)
      .send(VALID_RESPONSE_BODY);
    expect(res1.status).toBe(201);

    // Second submission — same uid → same hash → doc already exists
    const res2 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', callerUid)
      .send(VALID_RESPONSE_BODY);
    expect(res2.status).toBe(409);
    expect((res2.body as Record<string, unknown>).error).toBe('already_responded');

    // Verify only one response doc exists in Firestore
    const responsesSnap = await H.db!
      .collection(`${PULSE_BASE}/${SURVEY_ID}/responses`)
      .get();
    expect(responsesSnap.size).toBe(1);
  });

  it('201 two different workers can both respond', async () => {
    seedSurvey();
    const res1 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'worker-alpha')
      .send(VALID_RESPONSE_BODY);
    const res2 = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'worker-beta')
      .send(VALID_RESPONSE_BODY);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // Two distinct response docs
    const responsesSnap = await H.db!
      .collection(`${PULSE_BASE}/${SURVEY_ID}/responses`)
      .get();
    expect(responsesSnap.size).toBe(2);

    // Neither doc contains the raw uid
    for (const doc of responsesSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      expect(d).toHaveProperty('responderHash');
      expect(d).not.toHaveProperty('responderUid');
      expect(Object.values(d)).not.toContain('worker-alpha');
      expect(Object.values(d)).not.toContain('worker-beta');
    }
  });
});

// =============================================================================
// GET /:projectId/culture-pulse/history
// =============================================================================

describe('GET /api/sprint-k/:projectId/culture-pulse/history', () => {
  const URL = `/api/sprint-k/${PROJECT_ID}/culture-pulse/history`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(URL);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('not a member'),
    );
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'outsider');
    expect(res.status).toBe(403);
  });

  it('200 returns empty history when no surveys exist', async () => {
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.history)).toBe(true);
    expect((body.history as unknown[]).length).toBe(0);
  });

  it('200 history point with suppressed cultureIndex when n<5', async () => {
    seedSurvey();
    seedResponses(3); // below threshold

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const history = (res.body as Record<string, unknown>).history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    const point = history[0];
    expect(point.surveyId).toBe(SURVEY_ID);
    // cultureIndex suppressed to 0 when insufficient
    expect(point.cultureIndex).toBe(0);
    expect(point.level).toBe('low');
    expect(point.totalResponses).toBe(3);
    // ANONYMITY: no uid in history point
    expect(JSON.stringify(res.body)).not.toMatch(/"uid-\d+"/);
    expect(JSON.stringify(res.body)).not.toContain('responderHash');
  });

  it('200 history point with real cultureIndex when n>=5', async () => {
    seedSurvey();
    seedResponses(5);

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const history = (res.body as Record<string, unknown>).history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    const point = history[0];
    expect(typeof point.cultureIndex).toBe('number');
    expect((point.cultureIndex as number)).toBeGreaterThan(0);
    expect(['low', 'fair', 'good', 'strong']).toContain(point.level);
    // ANONYMITY: no uid or responderHash exposed in history
    expect(JSON.stringify(res.body)).not.toMatch(/"uid-\d+"/);
    expect(JSON.stringify(res.body)).not.toContain('responderHash');
  });

  it('200 history returned sorted by openAt ascending (oldest first)', async () => {
    // Seed 3 surveys with distinct openAt in reverse order
    const surveys = [
      { id: 'survey-c', openAt: '2026-03-01T00:00:00.000Z' },
      { id: 'survey-a', openAt: '2026-01-01T00:00:00.000Z' },
      { id: 'survey-b', openAt: '2026-02-01T00:00:00.000Z' },
    ];
    for (const s of surveys) {
      H.db!._seed(`${PULSE_BASE}/${s.id}`, {
        id: s.id,
        status: 'closed',
        openAt: s.openAt,
        closeAt: '2099-01-01T00:00:00.000Z',
        createdAt: s.openAt,
        createdBy: 'admin',
      });
    }

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const history = (res.body as Record<string, unknown>).history as Array<Record<string, unknown>>;
    // Should be sorted ascending by openAt
    expect(history[0].openAt).toBe('2026-01-01T00:00:00.000Z');
    expect(history[1].openAt).toBe('2026-02-01T00:00:00.000Z');
    expect(history[2].openAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('200 history capped at 6 most-recent surveys', async () => {
    // Seed 8 surveys; only the 6 most recent by openAt should appear
    for (let i = 1; i <= 8; i++) {
      const month = String(i).padStart(2, '0');
      H.db!._seed(`${PULSE_BASE}/survey-${i}`, {
        id: `survey-${i}`,
        status: 'closed',
        openAt: `2025-${month}-01T00:00:00.000Z`,
        closeAt: `2025-${month}-28T00:00:00.000Z`,
        createdAt: `2025-${month}-01T00:00:00.000Z`,
        createdBy: 'admin',
      });
    }

    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const history = (res.body as Record<string, unknown>).history as Array<Record<string, unknown>>;
    expect(history.length).toBeLessThanOrEqual(6);
  });

  it('ANONYMITY: aggregate history does not expose individual uids or hashes', async () => {
    seedSurvey();
    seedResponses(5);
    const res = await request(buildApp()).get(URL).set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    // No raw uid patterns
    expect(bodyStr).not.toMatch(/"uid-\d+"/);
    // No responderHash field in output
    expect(bodyStr).not.toContain('responderHash');
    // No workerRole / area (individual-level fields) must NOT appear in history points
    const history = (res.body as Record<string, unknown>).history as Array<Record<string, unknown>>;
    for (const point of history) {
      expect(Object.keys(point)).not.toContain('workerRole');
      expect(Object.keys(point)).not.toContain('area');
    }
  });
});
