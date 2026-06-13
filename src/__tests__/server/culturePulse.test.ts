// Real-router supertest for the Culture Pulse survey endpoints (§61-63 —
// percepción de seguridad + índice de cultura). Mounts the ACTUAL router
// (src/server/routes/culturePulse.ts) through the reusable fakeFirestore, so
// this is genuine coverage of the production handlers (the route had 0 tests).
//
// Focus: the two state-changing POSTs (schedule + respond) — auth, the
// scheduler role-gate, the survey-window enforcement (409 closed/not-open),
// idempotent one-response-per-worker, and the PRIVACY contract: a stored
// response must NEVER carry the responder uid (only the anonymizing hash).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

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
      admin: req.header('x-test-admin') === 'true',
    };
    next();
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import culturePulseRouter, { pulseResponderHash } from '../../server/routes/culturePulse.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', culturePulseRouter);
  return app;
}

const PULSE = '/api/sprint-k/p1/culture-pulse';
const PAST = '2020-01-01T00:00:00.000Z';
const PAST2 = '2020-06-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const FUTURE2 = '2999-06-01T00:00:00.000Z';
const CP_COLL = 'tenants/t1/projects/p1/culture_pulse';

// Predict response doc IDs by reusing the PRODUCTION hash verbatim, so these
// stay correct whether or not a pepper is configured in the test env (the
// real-router tests below run with no pepper → the legacy unkeyed path).
const responderHash = pulseResponderHash;

// Legacy unkeyed reference (pre-pepper) — used only by the pepper tests to
// prove the peppered output is NOT reproducible without the server secret.
function legacyUnkeyedHash(uid: string, surveyId: string): string {
  return createHash('sha256').update(`${uid}:${surveyId}`).digest('hex').slice(0, 32);
}

const validAnswers = {
  felt_safe_today: 4,
  manager_listens: 5,
  free_to_stop: 3,
  reported_incident_safely: 4,
  has_resources_to_be_safe: 5,
};

function seedSurvey(id: string, over: Record<string, unknown> = {}) {
  H.db!._seed(`${CP_COLL}/${id}`, {
    id, status: 'open', openAt: PAST, closeAt: FUTURE,
    title: 'Ola 1', createdAt: PAST, createdBy: 'boss', ...over,
  });
}

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', members: ['boss', 'w1'] });
});

describe('POST /culture-pulse/survey (schedule)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a worker (no scheduler role)', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'w1')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('201 + status=open when an admin schedules a future-close survey', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE, title: 'Clima Q1' });
    expect(res.status).toBe(201);
    expect(res.body.survey.status).toBe('open');
    expect(res.body.survey.createdBy).toBe('boss');
  });

  it('201 + status=closed when closeAt is already past', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'sup')
      .set('x-test-role', 'supervisor')
      .send({ surveyId: 'wv2', openAt: PAST, closeAt: PAST2 });
    expect(res.status).toBe(201);
    expect(res.body.survey.status).toBe('closed');
  });

  it('409 survey_already_exists', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv1', openAt: PAST, closeAt: FUTURE });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_already_exists');
  });

  it('400 when closeAt is not after openAt (schema refine)', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey`)
      .set('x-test-uid', 'boss')
      .set('x-test-admin', 'true')
      .send({ surveyId: 'wv3', openAt: FUTURE, closeAt: PAST });
    expect(res.status).toBe(400);
  });
});

describe('POST /culture-pulse/survey/:id/respond', () => {
  it('401 without a token', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(401);
  });

  it('404 when the survey does not exist', async () => {
    const res = await request(buildApp())
      .post(`${PULSE}/survey/ghost/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('survey_not_found');
  });

  it('409 survey_closed when closeAt has passed', async () => {
    seedSurvey('wv1', { status: 'closed', closeAt: PAST2 });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_closed');
  });

  it('409 survey_not_open when openAt is in the future', async () => {
    seedSurvey('wv1', { openAt: FUTURE, closeAt: FUTURE2 });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('survey_not_open');
  });

  it('201 on a valid response — and the stored doc is ANONYMOUS (no uid)', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(201);
    const hash = responderHash('w1', 'wv1');
    const stored = (
      await H.db!.collection(CP_COLL).doc('wv1').collection('responses').doc(hash).get()
    ).data() as Record<string, unknown>;
    expect(stored).toBeTruthy();
    expect(stored.responderHash).toBe(hash);
    // Privacy invariant: the raw uid must NOT be persisted anywhere on the doc.
    expect(JSON.stringify(stored)).not.toContain('w1');
    expect(stored.answers).toEqual(validAnswers);
  });

  it('audit row for respond uses the anonymized hash — NOT the raw uid', async () => {
    // Ley Karín 21.643 / Ley 19.628: the response doc is anonymous, but the
    // audit trail must not re-identify the respondent either. The actor stamped
    // into audit_logs MUST be the stable responderHash, never the token uid.
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(201);

    const hash = responderHash('w1', 'wv1');
    const dump = H.db!._dump();
    const auditRows = Object.entries(dump)
      .filter(([path]) => path.startsWith('audit_logs/'))
      .map(([, data]) => data as Record<string, unknown>)
      .filter((row) => row.action === 'culturePulse.respondSurvey');

    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    // The actor is the anonymizing hash, not the raw uid.
    expect(row.userId).toBe(hash);
    expect(row.userId).not.toBe('w1');
    expect(row.userEmail).toBeNull();
    // No raw uid leaks anywhere in the persisted audit row.
    expect(JSON.stringify(row)).not.toContain('"w1"');
    // The event stays auditable: it names the survey wave it belongs to.
    expect(row.module).toBe('culturePulse');
    expect((row.details as Record<string, unknown>).surveyId).toBe('wv1');
  });

  it('409 already_responded on a second submission by the same worker', async () => {
    seedSurvey('wv1');
    H.db!._seed(`${CP_COLL}/wv1/responses/${responderHash('w1', 'wv1')}`, {
      responderHash: responderHash('w1', 'wv1'), workerRole: 'x', area: 'y',
      answers: validAnswers, submittedAt: PAST,
    });
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: validAnswers });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_responded');
  });

  it('400 when an answer is out of the 1-5 range (schema)', async () => {
    seedSurvey('wv1');
    const res = await request(buildApp())
      .post(`${PULSE}/survey/wv1/respond`)
      .set('x-test-uid', 'w1')
      .send({ workerRole: 'operario', area: 'mina', answers: { ...validAnswers, felt_safe_today: 9 } });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Anonymity pepper (security hardening 2026-05-30) — the responder hash must be
// a server-keyed HMAC so a privileged insider (DB read + uid roster) cannot
// re-identify who answered by brute-forcing SHA-256(uid:surveyId) candidates.
// Ley Karín 21.643 / Ley 19.628 worker-survey anonymity. These drive the pure
// `pulseResponderHash` directly, toggling the server pepper env var.
// ───────────────────────────────────────────────────────────────────────────
describe('pulseResponderHash — anonymity pepper', () => {
  const PEPPER_A = 'pepper-alpha-0123456789abcdef0123456789abcdef';
  const PEPPER_B = 'pepper-bravo-fedcba9876543210fedcba9876543210';
  // Capture the ambient env once so each case restores cleanly and never
  // leaks a pepper into the real-router suites above (or vice-versa).
  const ORIGINAL_PEPPER = process.env.CULTURE_PULSE_PEPPER;
  const ORIGINAL_SESSION = process.env.SESSION_SECRET;

  beforeEach(() => {
    delete process.env.CULTURE_PULSE_PEPPER;
    delete process.env.SESSION_SECRET;
  });
  afterEach(() => {
    if (ORIGINAL_PEPPER === undefined) delete process.env.CULTURE_PULSE_PEPPER;
    else process.env.CULTURE_PULSE_PEPPER = ORIGINAL_PEPPER;
    if (ORIGINAL_SESSION === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SESSION;
  });

  it('is deterministic for the same (uid, surveyId, pepper)', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    expect(pulseResponderHash('w1', 'wv1')).toBe(pulseResponderHash('w1', 'wv1'));
  });

  it('produces a 32-char lowercase-hex digest (shape preserved)', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    expect(pulseResponderHash('w1', 'wv1')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs across surveys for the same worker (no cross-survey linkage)', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(pulseResponderHash('w1', 'wv2'));
  });

  it('differs across workers within the same survey', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(pulseResponderHash('w2', 'wv1'));
  });

  it('is NOT reproducible without the pepper (insider cannot brute-force doc IDs)', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    // An attacker who knows uid + surveyId but NOT the server pepper can only
    // compute the legacy unkeyed SHA-256 — which must not match the stored hash.
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(legacyUnkeyedHash('w1', 'wv1'));
  });

  it('changes when the pepper is rotated (old guesses are invalidated)', () => {
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    const withA = pulseResponderHash('w1', 'wv1');
    process.env.CULTURE_PULSE_PEPPER = PEPPER_B;
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(withA);
  });

  it('uses SESSION_SECRET as the pepper when CULTURE_PULSE_PEPPER is unset', () => {
    process.env.SESSION_SECRET = 'session-secret-pepper-2222222222222222222222222222';
    // Keyed by SESSION_SECRET → not the unkeyed legacy hash.
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(legacyUnkeyedHash('w1', 'wv1'));
  });

  it('prefers CULTURE_PULSE_PEPPER over SESSION_SECRET when both are set', () => {
    process.env.SESSION_SECRET = 'session-secret-pepper-2222222222222222222222222222';
    const withSession = pulseResponderHash('w1', 'wv1');
    process.env.CULTURE_PULSE_PEPPER = PEPPER_A;
    expect(pulseResponderHash('w1', 'wv1')).not.toBe(withSession);
  });

  it('falls back to a deterministic unkeyed hash when no secret is configured (test/dev)', () => {
    // beforeEach already cleared both — assert graceful, reproducible fallback.
    expect(pulseResponderHash('w1', 'wv1')).toBe(legacyUnkeyedHash('w1', 'wv1'));
    expect(pulseResponderHash('w1', 'wv1')).toBe(pulseResponderHash('w1', 'wv1'));
  });
});
