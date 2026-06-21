// Real-router supertest for the Meeting Pack + Briefing HTTP surface
// (src/server/routes/meetingPack.ts). Three stateless POST endpoints over the
// pure, deterministic engine in src/services/meetingPack/meetingPackBuilder.ts:
//
//   POST /:projectId/meeting-pack/build-summary              → { summary }
//   POST /:projectId/meeting-pack/build-supervisor-briefing  → { pack }
//   POST /:projectId/meeting-pack/extract-action-items       → { suggestions }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so every 200 asserts the real compute by
// re-deriving the expected shape from the engine's documented policy
// (quorum thresholds, flag rules, SIF headline, action-item regex triggers).

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
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import meetingPackRouter from '../../server/routes/meetingPack.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  buildMeetingSummary,
  buildSupervisorBriefingPack,
  extractActionItems,
  type MeetingSnapshot,
  type BriefingInputs,
} from '../../services/meetingPack/meetingPackBuilder.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', meetingPackRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ─────────────────────────────────────────────────────────────────────────
// 1. build-summary
// ─────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/meeting-pack/build-summary', () => {
  const url = '/api/p1/meeting-pack/build-summary';

  // A cphs_monthly meeting (min quorum 0.5). 2 invited, 1 attended → ratio 0.5
  // → quorumValid true. One discussion point carries a decision; one action
  // item is `critical` → followUpReason about critical actions.
  const snapshot: MeetingSnapshot = {
    meetingId: 'm-001',
    kind: 'cphs_monthly',
    scheduledFor: '2026-05-10T14:00:00.000Z',
    durationMinutes: 60,
    facilitatorUid: 'fac-1',
    attendees: [
      { uid: 'w1', name: 'Ana Pérez', role: 'operador', attended: true },
      { uid: 'w2', name: 'Beto Soto', role: 'operador', attended: false, absenceReason: 'licencia' },
    ],
    discussionPoints: [
      { id: 'd1', topic: 'Andamios', summary: 'Revisión de anclajes', decision: 'Re-certificar todos' },
      { id: 'd2', topic: 'EPP', summary: 'Stock de guantes bajo' },
    ],
    actionItems: [
      { description: 'Comprar guantes', assignedToUid: 'w1', dueDate: '2026-05-20', priority: 'critical' },
    ],
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ snapshot });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine summary (re-derived from the pure engine)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot });
    expect(res.status).toBe(200);
    // Re-derive the expected output from the REAL pure engine — never reimplement.
    const expected = buildMeetingSummary(snapshot);
    expect(res.body.summary).toEqual(expected);
    // Pin the load-bearing fields explicitly so the engine policy is verified.
    expect(res.body.summary.quorum).toEqual({ attended: 1, invited: 2, ratio: 0.5 });
    expect(res.body.summary.quorumValid).toBe(true);
    expect(res.body.summary.decisions).toEqual([
      { topic: 'Andamios', decision: 'Re-certificar todos' },
    ]);
    expect(res.body.summary.requiresFollowUp).toBe(true);
    expect(res.body.summary.followUpReasons).toContain(
      '1 action(s) crítica(s) requieren validación supervisor.',
    );
    expect(res.body.summary.absentees).toHaveLength(1);
    expect(res.body.summary.absentees[0].uid).toBe('w2');
  });

  it('200 flags insufficient quorum for a pre_shift_briefing below 80%', async () => {
    // pre_shift_briefing requires 0.8; 1/2 attended = 0.5 → quorum invalid.
    const lowQuorum: MeetingSnapshot = { ...snapshot, kind: 'pre_shift_briefing' };
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot: lowQuorum });
    expect(res.status).toBe(200);
    expect(res.body.summary.quorumValid).toBe(false);
    expect(res.body.summary.followUpReasons[0]).toContain('Quorum insuficiente');
  });

  it('400 on invalid body (missing snapshot)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
  });

  it('400 on invalid snapshot (unknown meeting kind)', async () => {
    const bad = { ...snapshot, kind: 'not_a_kind' };
    const res = await request(buildApp()).post(url).set(uid).send({ snapshot: bad });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/meeting-pack/build-summary')
      .set(uid)
      .send({ snapshot });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/meeting-pack/build-summary')
      .set(uid)
      .send({ snapshot });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. build-supervisor-briefing
// ─────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/meeting-pack/build-supervisor-briefing', () => {
  const url = '/api/p1/meeting-pack/build-supervisor-briefing';

  // SIF risk present → headline becomes the SIF warning and in-person handover
  // is required. A fatigued worker + expired-cert worker produce two flags.
  const body = {
    shiftStart: '2026-05-11T06:00:00.000Z',
    workersAssigned: [
      { uid: 'w1', name: 'Ana Pérez', role: 'operador', fatigueLevel: 'critical' as const },
      { uid: 'w2', name: 'Beto Soto', role: 'soldador', expiredCerts: ['altura'] },
    ],
    criticalRisksForToday: [
      { id: 'r1', description: 'Caída en altura', severity: 'sif' as const },
    ],
    pendingActions: [
      { id: 'a1', description: 'Inspeccionar grúa', dueDate: '2026-05-12' },
    ],
    weather: { temperatureC: 34, uvIndex: 9 },
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(body);
    expect(res.status).toBe(401);
  });

  it('200 returns the real briefing pack, stamping supervisorUid from the token', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    // The server forces supervisorUid = callerUid and projectId = route param.
    const expectedInput: BriefingInputs = {
      supervisorUid: 'u1',
      projectId: 'p1',
      ...body,
    };
    const expected = buildSupervisorBriefingPack(expectedInput);
    expect(res.body.pack).toEqual(expected);
    // Pin the load-bearing fields (identity-from-token + SIF policy).
    expect(res.body.pack.supervisorUid).toBe('u1');
    expect(res.body.pack.headline).toContain('SIF');
    expect(res.body.pack.inPersonHandoverRequired).toBe(true);
    // Two flagged workers: fatigue (critical) + expired cert.
    const flagKinds = res.body.pack.flaggedWorkers.map((f: { flagKind: string }) => f.flagKind);
    expect(flagKinds).toContain('fatigue');
    expect(flagKinds).toContain('expired_cert');
    // Weather advisory triggered by 34°C heat + UV 9.
    expect(res.body.pack.weatherAdvisory).toContain('WBGT');
  });

  it('200 IGNORA un supervisorUid/projectId forjado en el body (anti-spoof, CLAUDE.md #3)', async () => {
    // Un atacante autenticado manda identidad + scope falsos en el body. El
    // server DEBE sobrescribir ambos desde el token verificado + el path param,
    // nunca confiar en lo enviado por el cliente. (Regresión: spread body-last
    // dejaba que el body ganara → spoof de identidad.)
    const spoofed = { ...body, supervisorUid: 'attacker-spoof', projectId: 'evil-project' };
    const res = await request(buildApp()).post(url).set(uid).send(spoofed);
    expect(res.status).toBe(200);
    expect(res.body.pack.supervisorUid).toBe('u1');
  });

  it('200 with no risks/flags produces a calm headline and no in-person requirement', async () => {
    const calm = {
      shiftStart: '2026-05-11T06:00:00.000Z',
      workersAssigned: [{ uid: 'w1', name: 'Ana', role: 'operador' }],
      criticalRisksForToday: [],
      pendingActions: [],
    };
    const res = await request(buildApp()).post(url).set(uid).send(calm);
    expect(res.status).toBe(200);
    expect(res.body.pack.inPersonHandoverRequired).toBe(false);
    expect(res.body.pack.flaggedWorkers).toEqual([]);
    expect(res.body.pack.headline).toContain('1 trabajadores asignados');
  });

  it('400 on invalid body (temperature out of range)', async () => {
    const bad = { ...body, weather: { temperatureC: 999 } };
    const res = await request(buildApp()).post(url).set(uid).send(bad);
    expect(res.status).toBe(400);
  });

  it('400 on invalid body (bad severity enum)', async () => {
    const bad = {
      ...body,
      criticalRisksForToday: [{ id: 'r1', description: 'x', severity: 'low' }],
    };
    const res = await request(buildApp()).post(url).set(uid).send(bad);
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/meeting-pack/build-supervisor-briefing')
      .set(uid)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. extract-action-items
// ─────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/meeting-pack/extract-action-items', () => {
  const url = '/api/p1/meeting-pack/extract-action-items';

  // "debemos…" matches the high-confidence trigger; @w3 + ISO date are parsed.
  const text = 'Debemos reforzar los anclajes @w3 antes del 2026-05-25';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ text });
    expect(res.status).toBe(401);
  });

  it('200 extracts a real suggestion (re-derived from the pure engine)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ text });
    expect(res.status).toBe(200);
    const expected = extractActionItems(text);
    expect(res.body.suggestions).toEqual(expected);
    // Pin the parse: assignee from @uid, dueDate from ISO date, confidence.
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].proposedAssigneeUid).toBe('w3');
    expect(res.body.suggestions[0].proposedDueDate).toBe('2026-05-25');
    expect(res.body.suggestions[0].confidence).toBe(0.85);
  });

  it('200 returns an empty list when no trigger phrases are present', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ text: 'La reunión transcurrió con normalidad sin novedades.' });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('400 when text is not a string', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ text: 123 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/meeting-pack/extract-action-items')
      .set(uid)
      .send({ text });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
