// Real-router supertest for src/server/routes/legalObligations.ts
// Plan v3 Fase 1 — raises line coverage on the 444-LOC legal-calendar wire
// (was 0 tests). Mounts the ACTUAL router through fakeFirestore so the real
// handler code (verifyAuth gate, validate middleware, guard helper, the
// advanceObligation / computeCalendar / summarizeCalendar engine calls,
// the best-effort Firestore persist, subcollection history reads) is exercised.
//
// Compliance assertion: the route NEVER auto-pushes to SUSESO / SII / MINSAL /
// Mutualidad. We assert that the acknowledge and snooze responses carry only
// the rolled obligation — no external API call surface exists in the handler.

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

vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../server/middleware/validate.js', () => ({
  validate:
    (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } }) =>
    (req: Request, res: Response, next: NextFunction) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error?.issues ?? [] });
        return;
      }
      (req as Request & { validated: unknown }).validated = parsed.data;
      next();
    },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// assertProjectMember is a real function but we mock the Firestore under it via
// fakeFirestore — so we let the real code run against H.db (no module-level mock).
// The guard helper inside the route calls assertProjectMember(uid, projectId, admin.firestore())
// which resolves to H.db. We seed `projects/<id>` in each test that needs access.

import legalObligationsRouter from '../../server/routes/legalObligations.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { LegalObligation } from '../../services/legalCalendar/legalObligationsCalendar.js';

// Mount prefix matches the comment at the top of legalObligations.ts: /api/sprint-k
const PREFIX = '/api/sprint-k';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, legalObligationsRouter);
  return app;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-legal-1';
const CALLER_UID = 'uid-supervisor-1';

/** Seed a project doc so assertProjectMember passes. */
function seedProject(projectId = PROJECT_ID, uid = CALLER_UID) {
  H.db!._seed(`projects/${projectId}`, { members: [uid], createdBy: uid });
}

const FUTURE_DATE = new Date(Date.now() + 90 * 86_400_000).toISOString(); // 90 days ahead
const PAST_DATE = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago

const baseObligation: LegalObligation = {
  id: 'obl-1',
  kind: 'cphs_meeting',
  label: 'Reunión mensual CPHS',
  legalCitation: 'DS 54 art. 24',
  recurrence: 'monthly',
  alertLeadDays: 7,
  nextDueAt: FUTURE_DATE,
};

const overdueObligation: LegalObligation = {
  ...baseObligation,
  id: 'obl-overdue',
  nextDueAt: PAST_DATE,
};

/** Seed an obligation doc in the legal_obligations collection. */
function seedObligation(obl: LegalObligation, projectId = PROJECT_ID) {
  H.db!._seed(`legal_obligations/${obl.id}`, { ...obl, projectId });
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /:projectId/legal-calendar/upcoming
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/legal-calendar/upcoming', () => {
  const url = (projectId = PROJECT_ID, qs = '') =>
    `${PREFIX}/${projectId}/legal-calendar/upcoming${qs}`;

  it('401 — no token', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  it('403 — caller not a project member', async () => {
    // project doc not seeded → assertProjectMember throws ProjectMembershipError
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 — empty project returns empty entries + summary', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.totalObligations).toBe('number');
    expect(res.body.windowDays).toBe(30); // default
  });

  it('200 — upcoming obligation appears in entries, overdue excluded', async () => {
    seedProject();
    seedObligation(baseObligation); // 90 days ahead, within 365-day window
    seedObligation(overdueObligation); // past due → not in upcoming

    const res = await request(buildApp())
      .get(url(PROJECT_ID, '?days=365'))
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(365);
    // Only the non-overdue obligation should appear
    const ids = res.body.entries.map((e: { id: string }) => e.id);
    expect(ids).toContain('obl-1');
    expect(ids).not.toContain('obl-overdue');
  });

  it('200 — clamps ?days to [1, 365]', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(url(PROJECT_ID, '?days=9999'))
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(365);
  });

  it('200 — ?days=0 is falsy so falls back to default 30', async () => {
    seedProject();
    // Route: parseInt('0') || 30  → 0 is falsy → 30, then Math.max(1, 30) = 30
    const res = await request(buildApp())
      .get(url(PROJECT_ID, '?days=0'))
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(30);
  });

  it('200 — summary counters reflect the correct totals', async () => {
    seedProject();
    seedObligation(baseObligation);
    seedObligation(overdueObligation);

    const res = await request(buildApp())
      .get(url(PROJECT_ID, '?days=365'))
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // summary.totalObligations counts all (including overdue), overdue >= 1
    expect(res.body.summary.totalObligations).toBe(2);
    expect(res.body.summary.overdue).toBeGreaterThanOrEqual(1);
  });

  it('200 — obligation missing required fields (no nextDueAt) is filtered out', async () => {
    seedProject();
    // This doc is malformed — loadProjectObligations skips it (no nextDueAt)
    H.db!._seed(`legal_obligations/bad-obl`, { projectId: PROJECT_ID, kind: 'audit' });
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0); // filtered out
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /:projectId/legal-calendar/overdue
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/legal-calendar/overdue', () => {
  const url = (projectId = PROJECT_ID) =>
    `${PREFIX}/${projectId}/legal-calendar/overdue`;

  it('401 — no token', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  it('403 — caller not a project member', async () => {
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
  });

  it('200 — no obligations → empty', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  it('200 — overdue obligation appears, upcoming excluded', async () => {
    seedProject();
    seedObligation(baseObligation); // future — should NOT appear
    seedObligation(overdueObligation); // past — should appear

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const ids = res.body.entries.map((e: { id: string }) => e.id);
    expect(ids).toContain('obl-overdue');
    expect(ids).not.toContain('obl-1');
    expect(res.body.count).toBe(1);
  });

  it('200 — count matches entries length', async () => {
    seedProject();
    seedObligation(overdueObligation);
    const secondOverdue: LegalObligation = {
      ...overdueObligation,
      id: 'obl-overdue-2',
    };
    seedObligation(secondOverdue);

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.entries.length);
    expect(res.body.count).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/legal-calendar/acknowledge
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/legal-calendar/acknowledge', () => {
  const url = (projectId = PROJECT_ID) =>
    `${PREFIX}/${projectId}/legal-calendar/acknowledge`;

  it('401 — no token', async () => {
    const res = await request(buildApp()).post(url()).send({ obligation: baseObligation });
    expect(res.status).toBe(401);
  });

  it('400 — missing obligation field', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ notes: 'sin obligación' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 — invalid obligation kind', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: { ...baseObligation, kind: 'not_a_valid_kind' } });
    expect(res.status).toBe(400);
  });

  it('403 — caller not a project member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation });
    expect(res.status).toBe(403);
  });

  it('403 — cross-project IDOR: cannot acknowledge another project\'s obligation', async () => {
    seedProject(); // caller IS a member of PROJECT_ID …
    // … but the obligation with this id actually belongs to a DIFFERENT project.
    seedObligation(baseObligation, 'other-project-xyz');
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_cross_project');
    // The other project's obligation must be untouched (no reassign / overwrite).
    const stored = (
      await H.db!.collection('legal_obligations').doc(baseObligation.id).get()
    ).data() as Record<string, unknown>;
    expect(stored.projectId).toBe('other-project-xyz');
    expect(stored.lastAcknowledgedByUid).toBeUndefined();
  });

  it('200 — returns obligation with rolled nextDueAt (monthly → +30 days)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation });
    expect(res.status).toBe(200);
    expect(res.body.obligation).toBeDefined();
    const returnedNextDue = new Date(res.body.obligation.nextDueAt).getTime();
    const originalNextDue = new Date(baseObligation.nextDueAt).getTime();
    // monthly = 30 days × 86400000 ms
    expect(returnedNextDue).toBeCloseTo(originalNextDue + 30 * 86_400_000, -3);
  });

  it('200 — Firestore doc is updated with new nextDueAt', async () => {
    seedProject();
    seedObligation(baseObligation); // pre-seed so the doc exists in store
    await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation });

    const stored = (
      await H.db!.collection('legal_obligations').doc('obl-1').get()
    ).data() as Record<string, unknown>;
    expect(typeof stored.nextDueAt).toBe('string');
    // The persisted nextDueAt must be later than the original
    const storedMs = new Date(stored.nextDueAt as string).getTime();
    const originalMs = new Date(baseObligation.nextDueAt).getTime();
    expect(storedMs).toBeGreaterThan(originalMs);
    // lastAcknowledgedByUid must be the caller
    expect(stored.lastAcknowledgedByUid).toBe(CALLER_UID);
  });

  it('200 — notes are persisted and do not appear in the response obligation shape', async () => {
    seedProject();
    seedObligation(baseObligation);
    await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation, notes: 'Firmado por Jefe de Turno' });

    const stored = (
      await H.db!.collection('legal_obligations').doc('obl-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.lastAcknowledgeNotes).toBe('Firmado por Jefe de Turno');
  });

  it('200 — empty notes → persists empty string (no crash)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation }); // notes optional
    expect(res.status).toBe(200);
  });

  // compliance: no external organism push
  it('COMPLIANCE — acknowledge response has no SUSESO/SII/MINSAL/Mutualidad push fields', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation });
    expect(res.status).toBe(200);
    // The response should only carry the rolled obligation — no external API data
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(/suseso|sii|minsal|mutualidad|push_to|externalApi/i);
    expect(res.body).not.toHaveProperty('externalSubmission');
    expect(res.body).not.toHaveProperty('pushResult');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. POST /:projectId/legal-calendar/snooze
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/legal-calendar/snooze', () => {
  const url = (projectId = PROJECT_ID) =>
    `${PREFIX}/${projectId}/legal-calendar/snooze`;

  const validSnooze = {
    obligation: baseObligation,
    days: 14,
    reason: 'Mutualidad aprobó prórroga de 14 días según comunicación oficial.',
  };

  it('401 — no token', async () => {
    const res = await request(buildApp()).post(url()).send(validSnooze);
    expect(res.status).toBe(401);
  });

  it('400 — missing reason', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation, days: 7 }); // reason missing
    expect(res.status).toBe(400);
  });

  it('400 — reason too short (< 10 chars)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation, days: 7, reason: 'corto' });
    expect(res.status).toBe(400);
  });

  it('400 — days out of range (0)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation, days: 0, reason: 'razón válida suficientemente larga para pasar validación.' });
    expect(res.status).toBe(400);
  });

  it('400 — days out of range (366)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({ obligation: baseObligation, days: 366, reason: 'razón válida suficientemente larga para pasar validación.' });
    expect(res.status).toBe(400);
  });

  it('403 — caller not a project member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validSnooze);
    expect(res.status).toBe(403);
  });

  it('200 — returns obligation with nextDueAt pushed by days', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validSnooze);
    expect(res.status).toBe(200);
    expect(res.body.obligation).toBeDefined();
    const returnedMs = new Date(res.body.obligation.nextDueAt).getTime();
    const originalMs = new Date(baseObligation.nextDueAt).getTime();
    expect(returnedMs).toBeCloseTo(originalMs + 14 * 86_400_000, -3);
  });

  it('200 — Firestore doc updated with snooze metadata', async () => {
    seedProject();
    seedObligation(baseObligation);
    await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validSnooze);

    const stored = (
      await H.db!.collection('legal_obligations').doc('obl-1').get()
    ).data() as Record<string, unknown>;
    expect(stored.lastSnoozedByUid).toBe(CALLER_UID);
    expect(stored.lastSnoozeReason).toBe(validSnooze.reason);
    expect(stored.lastSnoozeDays).toBe(14);
    // nextDueAt advanced
    const storedMs = new Date(stored.nextDueAt as string).getTime();
    const originalMs = new Date(baseObligation.nextDueAt).getTime();
    expect(storedMs).toBeGreaterThan(originalMs);
  });

  it('200 — snooze with 1 day (minimum valid)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        obligation: baseObligation,
        days: 1,
        reason: 'Prórroga de un día aprobada por el cliente conforme solicitud formal.',
      });
    expect(res.status).toBe(200);
    const returnedMs = new Date(res.body.obligation.nextDueAt).getTime();
    const originalMs = new Date(baseObligation.nextDueAt).getTime();
    expect(returnedMs).toBeCloseTo(originalMs + 1 * 86_400_000, -3);
  });

  it('200 — snooze with 365 days (maximum valid)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send({
        obligation: baseObligation,
        days: 365,
        reason: 'Diferimiento máximo aprobado por la autoridad competente, conforme protocolo vigente.',
      });
    expect(res.status).toBe(200);
    const returnedMs = new Date(res.body.obligation.nextDueAt).getTime();
    const originalMs = new Date(baseObligation.nextDueAt).getTime();
    expect(returnedMs).toBeCloseTo(originalMs + 365 * 86_400_000, -3);
  });

  // compliance: no external organism push
  it('COMPLIANCE — snooze response carries only the updated obligation', async () => {
    seedProject();
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', CALLER_UID)
      .send(validSnooze);
    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(/suseso|sii|minsal|mutualidad|push_to|externalApi/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. GET /:projectId/legal-calendar/history
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /:projectId/legal-calendar/history', () => {
  const url = (projectId = PROJECT_ID) =>
    `${PREFIX}/${projectId}/legal-calendar/history`;

  it('401 — no token', async () => {
    const res = await request(buildApp()).get(url());
    expect(res.status).toBe(401);
  });

  it('403 — caller not a project member', async () => {
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
  });

  it('200 — empty project returns empty entries', async () => {
    seedProject();
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  it('200 — obligation with no reminders returns reminders: []', async () => {
    seedProject();
    seedObligation(baseObligation);
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(entry.obligationId).toBe('obl-1');
    expect(entry.kind).toBe('cphs_meeting');
    expect(Array.isArray(entry.reminders)).toBe(true);
    expect(entry.reminders).toHaveLength(0);
  });

  it('200 — obligation with reminders subcollection returns the reminder data', async () => {
    seedProject();
    seedObligation(baseObligation);
    // Seed a reminder in the subcollection (path: legal_obligations/obl-1/reminders_sent/rem-1)
    H.db!._seed('legal_obligations/obl-1/reminders_sent/rem-1', {
      sentAtIso: '2026-05-01T10:00:00.000Z',
      daysUntilWhenSent: 30,
    });

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(entry.reminders).toHaveLength(1);
    expect(entry.reminders[0].sentAtIso).toBe('2026-05-01T10:00:00.000Z');
    expect(entry.reminders[0].daysUntilWhenSent).toBe(30);
  });

  it('200 — obligation with ack/snooze metadata returns those fields', async () => {
    seedProject();
    // Simulate a previously acknowledged obligation
    H.db!._seed(`legal_obligations/obl-acked`, {
      ...baseObligation,
      id: 'obl-acked',
      projectId: PROJECT_ID,
      lastAcknowledgedAt: '2026-04-15T08:00:00.000Z',
      lastAcknowledgedByUid: CALLER_UID,
    });

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const entry = res.body.entries.find((e: { obligationId: string }) => e.obligationId === 'obl-acked');
    expect(entry).toBeDefined();
    expect(entry.lastAcknowledgedAt).toBe('2026-04-15T08:00:00.000Z');
    expect(entry.lastAcknowledgedByUid).toBe(CALLER_UID);
  });

  it('200 — obligation missing kind or nextDueAt is silently skipped', async () => {
    seedProject();
    H.db!._seed('legal_obligations/incomplete-obl', {
      projectId: PROJECT_ID,
      label: 'Sin kind ni nextDueAt',
    });
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0); // skipped by the handler
  });

  it('200 — count always matches entries length', async () => {
    seedProject();
    seedObligation(baseObligation);
    seedObligation(overdueObligation);

    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.entries.length);
  });

  it('200 — history entry shape has all required fields', async () => {
    seedProject();
    seedObligation(baseObligation);
    const res = await request(buildApp())
      .get(url())
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const entry = res.body.entries[0];
    expect(entry).toHaveProperty('obligationId');
    expect(entry).toHaveProperty('kind');
    expect(entry).toHaveProperty('label');
    expect(entry).toHaveProperty('legalCitation');
    expect(entry).toHaveProperty('nextDueAt');
    expect(entry).toHaveProperty('reminders');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cross-cutting: tenant isolation (different project)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant isolation', () => {
  it('caller from project-A cannot read project-B obligations', async () => {
    const projectA = 'proj-a';
    const projectB = 'proj-b';
    const uidA = 'uid-a';
    H.db!._seed(`projects/${projectA}`, { members: [uidA], createdBy: uidA });
    // Seed obligation under projectB (different projectId field)
    H.db!._seed('legal_obligations/obl-b', {
      ...baseObligation,
      id: 'obl-b',
      projectId: projectB,
    });

    // Caller A tries to read projectB's upcoming
    const res = await request(buildApp())
      .get(`${PREFIX}/${projectB}/legal-calendar/upcoming`)
      .set('x-test-uid', uidA);
    // projectB doc not seeded → 403
    expect(res.status).toBe(403);
  });

  it('even with a project doc, obligations are scoped by projectId field', async () => {
    const projectA = 'proj-a';
    const projectB = 'proj-b';
    const uidA = 'uid-a';
    H.db!._seed(`projects/${projectA}`, { members: [uidA], createdBy: uidA });
    H.db!._seed(`projects/${projectB}`, { members: [uidA], createdBy: uidA });
    // Obligation belongs to projectA
    H.db!._seed('legal_obligations/obl-a', {
      ...baseObligation,
      id: 'obl-a',
      projectId: projectA,
    });

    // Caller A reads projectB — should see 0 obligations (none share projectB id)
    const res = await request(buildApp())
      .get(`${PREFIX}/${projectB}/legal-calendar/upcoming?days=365`)
      .set('x-test-uid', uidA);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});
