// Real-router supertest for src/server/routes/shiftHandover.ts
// (Plan v3 Fase 1 — 6 pure-compute POST endpoints, 0 Firestore writes).
//
// The route is a Sprint 39 J.8 addition (not yet mounted in server.ts —
// all other Sprint-39 routes use /api/sprint-k so we adopt that prefix).
// Every endpoint: verifyAuth → validate(zodSchema) → guard(assertProjectMember)
// → pure-compute service function. No Firestore writes, no limiters, no
// idempotency keys, no dynamic imports.
//
// Status codes exercised:
//   401 — missing x-test-uid (verifyAuth gate)
//   400 — schema validation fails (validate middleware)
//   403 — caller not a project member (guard / assertProjectMember)
//   200 — happy path; business branches (engine throws HandoverValidationError → 400)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Hoisted db holder ────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock (firestore only; auth not read by this route) ────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── verifyAuth: trust x-test-uid header ─────────────────────────────────────
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

// ── projectMembership: use real implementation; membership determined by seed ─
vi.mock('../../services/auth/projectMembership.js', async () => {
  const real = await import('../../services/auth/projectMembership.js');
  return real;
});

// ── logger + observability stubs ─────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────
import shiftHandoverRouter from '../../server/routes/shiftHandover.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PROJECT_ID = 'p-sh-test';
const SUPERVISOR_UID = 'uid-supervisor-out';
const INCOMING_UID = 'uid-supervisor-in';
const SHIFT_ID = 'shift-2026-05-30-morning';

const BASE_SHIFT = {
  id: SHIFT_ID,
  projectId: PROJECT_ID,
  kind: 'morning' as const,
  startedAt: '2026-05-30T08:00:00.000Z',
  supervisorUid: SUPERVISOR_UID,
  logEntries: [],
  handoverNotes: [],
};

const ENDED_SHIFT = {
  ...BASE_SHIFT,
  endedAt: '2026-05-30T16:00:00.000Z',
};

const ACKNOWLEDGED_SHIFT = {
  ...ENDED_SHIFT,
  acknowledgedByUid: INCOMING_UID,
  acknowledgedAt: '2026-05-30T16:05:00.000Z',
};

const VALID_NOTE = {
  category: 'open_incidents' as const,
  text: 'Incidente eléctrico en zona norte pendiente de cierre.',
  severity: 'urgent' as const,
};

const VALID_ENTRY = {
  authorUid: SUPERVISOR_UID, // will be overridden by route to callerUid
  authorRole: 'supervisor',
  at: '2026-05-30T10:00:00.000Z',
  text: 'Inspección completada sin novedades adicionales.',
  requiresFollowUp: false,
};

// ── App builder ──────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', shiftHandoverRouter);
  return app;
}

function seedProject(db: NonNullable<typeof H.db>, extraMembers: string[] = []) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Project',
    members: [SUPERVISOR_UID, INCOMING_UID, ...extraMembers],
    createdBy: SUPERVISOR_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ════════════════════════════════════════════════════════════════════════════
// 1. POST /:projectId/shift-handover/start
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/start', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/start`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ id: SHIFT_ID, kind: 'morning' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('400 when id is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ kind: 'morning' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when kind is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ id: SHIFT_ID, kind: 'turno-invalido' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ id: SHIFT_ID, kind: 'morning' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-project/shift-handover/start`)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ id: SHIFT_ID, kind: 'morning' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 creates a new shift record with caller as supervisorUid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ id: SHIFT_ID, kind: 'morning' });
    expect(res.status).toBe(200);
    const { shift } = res.body as { shift: Record<string, unknown> };
    expect(shift.id).toBe(SHIFT_ID);
    expect(shift.projectId).toBe(PROJECT_ID);
    expect(shift.kind).toBe('morning');
    // supervisorUid must come from the token, not the body
    expect(shift.supervisorUid).toBe(SUPERVISOR_UID);
    expect(Array.isArray(shift.logEntries)).toBe(true);
    expect(Array.isArray(shift.handoverNotes)).toBe(true);
    expect(typeof shift.startedAt).toBe('string');
    expect(shift.endedAt).toBeUndefined();
    expect(shift.acknowledgedByUid).toBeUndefined();
  });

  it('200 accepts all valid shift kinds', async () => {
    for (const kind of ['morning', 'afternoon', 'night', 'extended'] as const) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', SUPERVISOR_UID)
        .send({ id: `shift-${kind}`, kind });
      expect(res.status).toBe(200);
      expect(res.body.shift.kind).toBe(kind);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. POST /:projectId/shift-handover/log-entry
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/log-entry', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/log-entry`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ shift: BASE_SHIFT, entry: VALID_ENTRY });
    expect(res.status).toBe(401);
  });

  it('400 when shift is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ entry: VALID_ENTRY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when entry.requiresFollowUp is not a boolean', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({
        shift: BASE_SHIFT,
        entry: { ...VALID_ENTRY, requiresFollowUp: 'yes' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ shift: BASE_SHIFT, entry: VALID_ENTRY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 appends log entry and overrides authorUid from token', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT, entry: VALID_ENTRY });
    expect(res.status).toBe(200);
    const { shift } = res.body as { shift: Record<string, unknown> };
    const entries = shift.logEntries as Record<string, unknown>[];
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe(VALID_ENTRY.text);
    // authorUid must be forced from the token, not client-supplied value
    expect(entries[0].authorUid).toBe(SUPERVISOR_UID);
    expect(entries[0].requiresFollowUp).toBe(false);
    expect(typeof entries[0].at).toBe('string');
  });

  it('400 (HandoverValidationError) when shift is already ended', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ENDED_SHIFT, entry: VALID_ENTRY });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SHIFT_ENDED/);
  });

  it('400 (HandoverValidationError) when entry text is too short', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({
        shift: BASE_SHIFT,
        entry: { ...VALID_ENTRY, text: 'abc' }, // less than 5 chars
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ENTRY_TOO_SHORT/);
  });

  it('200 entry with requiresFollowUp=true is preserved', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({
        shift: BASE_SHIFT,
        entry: { ...VALID_ENTRY, requiresFollowUp: true },
      });
    expect(res.status).toBe(200);
    const entries = res.body.shift.logEntries as Record<string, unknown>[];
    expect(entries[0].requiresFollowUp).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/shift-handover/add-note
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/add-note', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/add-note`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ shift: BASE_SHIFT, note: VALID_NOTE });
    expect(res.status).toBe(401);
  });

  it('400 when note.category is not a valid enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT, note: { ...VALID_NOTE, category: 'invalid_category' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when note.severity is not a valid enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT, note: { ...VALID_NOTE, severity: 'critical' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ shift: BASE_SHIFT, note: VALID_NOTE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 appends handover note with correct shape', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT, note: VALID_NOTE });
    expect(res.status).toBe(200);
    const notes = res.body.shift.handoverNotes as Record<string, unknown>[];
    expect(notes).toHaveLength(1);
    expect(notes[0].category).toBe('open_incidents');
    expect(notes[0].severity).toBe('urgent');
    expect(notes[0].text).toBe(VALID_NOTE.text);
  });

  it('200 accepts all valid categories', async () => {
    const categories = [
      'open_incidents', 'equipment_down', 'pending_controls',
      'absent_workers', 'restricted_zones', 'active_permits',
      'admin_pending', 'weather_alert', 'observation',
    ] as const;
    for (const category of categories) {
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', SUPERVISOR_UID)
        .send({
          shift: BASE_SHIFT,
          note: { category, text: 'Nota de prueba válida.', severity: 'info' },
        });
      expect(res.status).toBe(200);
      const notes = res.body.shift.handoverNotes as { category: string }[];
      expect(notes[notes.length - 1].category).toBe(category);
    }
  });

  it('200 note with optional referenceId is preserved', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({
        shift: BASE_SHIFT,
        note: { ...VALID_NOTE, referenceId: 'INC-0042' },
      });
    expect(res.status).toBe(200);
    const notes = res.body.shift.handoverNotes as Record<string, unknown>[];
    expect(notes[0].referenceId).toBe('INC-0042');
  });

  it('400 (HandoverValidationError) when shift is already ended', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ENDED_SHIFT, note: VALID_NOTE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SHIFT_ENDED/);
  });

  it('400 (HandoverValidationError) when note text is too short', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT, note: { ...VALID_NOTE, text: 'abc' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NOTE_TOO_SHORT/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. POST /:projectId/shift-handover/end
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/end', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/end`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(401);
  });

  it('400 when shift is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 stamps endedAt and returns updated shift', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(200);
    const { shift } = res.body as { shift: Record<string, unknown> };
    expect(typeof shift.endedAt).toBe('string');
    // endedAt must be a valid ISO date
    expect(new Date(shift.endedAt as string).getTime()).toBeGreaterThan(0);
    expect(shift.id).toBe(SHIFT_ID);
  });

  it('200 is idempotent — already-ended shift returns the same endedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(200);
    const { shift } = res.body as { shift: Record<string, unknown> };
    // endShift is idempotent: returns the existing shift unchanged
    expect(shift.endedAt).toBe(ENDED_SHIFT.endedAt);
  });

  it('200 preserves existing logEntries after ending shift', async () => {
    const shiftWithEntries = {
      ...BASE_SHIFT,
      logEntries: [{ ...VALID_ENTRY, at: '2026-05-30T10:00:00.000Z' }],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: shiftWithEntries });
    expect(res.status).toBe(200);
    expect(res.body.shift.logEntries).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. POST /:projectId/shift-handover/acknowledge
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/acknowledge', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/acknowledge`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(401);
  });

  it('400 when shift is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when notes exceeds max length', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({ shift: ENDED_SHIFT, notes: 'n'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 acknowledges with incomingSupervisorUid from token (not body)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(200);
    const { shift } = res.body as { shift: Record<string, unknown> };
    // acknowledgedByUid must come from the token, not anything in the body
    expect(shift.acknowledgedByUid).toBe(INCOMING_UID);
    expect(typeof shift.acknowledgedAt).toBe('string');
    expect(new Date(shift.acknowledgedAt as string).getTime()).toBeGreaterThan(0);
    expect(shift.acknowledgmentNotes).toBeUndefined();
  });

  it('200 passes optional acknowledgment notes through', async () => {
    const notes = 'Recibí el turno. Zona norte en monitoreo.';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({ shift: ENDED_SHIFT, notes });
    expect(res.status).toBe(200);
    expect(res.body.shift.acknowledgmentNotes).toBe(notes);
  });

  it('400 (SHIFT_NOT_ENDED) when shift has not been ended yet', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SHIFT_NOT_ENDED/);
  });

  it('400 (ALREADY_ACKNOWLEDGED) when shift was already acknowledged', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', INCOMING_UID)
      .send({ shift: ACKNOWLEDGED_SHIFT });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ALREADY_ACKNOWLEDGED/);
  });

  it('400 (SAME_SUPERVISOR) when incoming uid equals outgoing supervisorUid', async () => {
    // The token uid matches the supervisorUid of the shift
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID) // same as ENDED_SHIFT.supervisorUid
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SAME_SUPERVISOR/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. POST /:projectId/shift-handover/summarize
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/shift-handover/summarize', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/shift-handover/summarize`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(401);
  });

  it('400 when shift is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns ShiftSummary shape for a completed shift', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(200);
    const { summary } = res.body as { summary: Record<string, unknown> };
    expect(summary.shiftId).toBe(SHIFT_ID);
    expect(typeof summary.durationMinutes).toBe('number');
    expect(summary.durationMinutes).toBeGreaterThan(0); // 08:00 → 16:00 = 480 min
    expect(summary.entriesCount).toBe(0);
    expect(summary.notesCount).toBe(0);
    expect(summary.urgentNotesCount).toBe(0);
    expect(summary.hasUnacknowledgedHandover).toBe(true);
    expect(summary.pendingFollowUps).toBe(0);
  });

  it('200 durationMinutes is 480 for an 8-hour shift', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ENDED_SHIFT });
    expect(res.status).toBe(200);
    expect(res.body.summary.durationMinutes).toBe(480);
  });

  it('200 counts urgentNotesCount correctly', async () => {
    const shiftWithNotes = {
      ...ENDED_SHIFT,
      handoverNotes: [
        { category: 'open_incidents', text: 'Urgente uno.', severity: 'urgent' },
        { category: 'weather_alert', text: 'Viento alto en zona.', severity: 'attention' },
        { category: 'observation', text: 'Sin novedad mayor.', severity: 'info' },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: shiftWithNotes });
    expect(res.status).toBe(200);
    expect(res.body.summary.urgentNotesCount).toBe(1);
    expect(res.body.summary.notesCount).toBe(3);
  });

  it('200 pendingFollowUps counts log entries with requiresFollowUp=true', async () => {
    const shiftWithEntries = {
      ...ENDED_SHIFT,
      logEntries: [
        { ...VALID_ENTRY, at: '2026-05-30T10:00:00.000Z', requiresFollowUp: true },
        { ...VALID_ENTRY, at: '2026-05-30T11:00:00.000Z', requiresFollowUp: false },
        { ...VALID_ENTRY, at: '2026-05-30T12:00:00.000Z', requiresFollowUp: true },
      ],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: shiftWithEntries });
    expect(res.status).toBe(200);
    expect(res.body.summary.pendingFollowUps).toBe(2);
    expect(res.body.summary.entriesCount).toBe(3);
  });

  it('200 hasUnacknowledgedHandover=false when shift is acknowledged', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: ACKNOWLEDGED_SHIFT });
    expect(res.status).toBe(200);
    expect(res.body.summary.hasUnacknowledgedHandover).toBe(false);
  });

  it('200 hasUnacknowledgedHandover=false for an open (not ended) shift', async () => {
    // shift.endedAt is undefined → engine treats it as open, so hasUnacknowledgedHandover=false
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(200);
    // service: !!shift.endedAt && !shift.acknowledgedAt → false for open shift
    expect(res.body.summary.hasUnacknowledgedHandover).toBe(false);
  });

  it('200 returns summary for in-progress shift (endedAt absent)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', SUPERVISOR_UID)
      .send({ shift: BASE_SHIFT });
    expect(res.status).toBe(200);
    expect(res.body.summary.shiftId).toBe(SHIFT_ID);
    // durationMinutes uses now as endMs when endedAt is missing
    expect(typeof res.body.summary.durationMinutes).toBe('number');
  });
});
