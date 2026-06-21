// Real-router supertest for the Agenda + Focus Blocks + Reminders + Digests
// HTTP surface (src/server/routes/agenda.ts). Five stateless POST endpoints
// over the pure engine in src/services/agenda/agendaScheduler.ts:
//
//   POST /:projectId/agenda/schedule-reminders   → { reminders }
//   POST /:projectId/agenda/select-channel        → { channel }
//   POST /:projectId/agenda/should-deliver         → { decision }
//   POST /:projectId/agenda/in-focus-block         → { focus }
//   POST /:projectId/agenda/build-daily-digest     → { digest }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the
// project (never by mocking the gate). verifyAuth + logger + observability
// are mocked; the engine itself runs UNMOCKED so every 200 re-derives real
// output from the deterministic scheduler — never copied from the handler.

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

import agendaRouter from '../../server/routes/agenda.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  scheduleReminders,
  selectChannelForUrgency,
  shouldDeliverNow,
  isInFocusBlock,
  buildDailyDigest,
  type AgendaItem,
  type UserPreferences,
} from '../../services/agenda/agendaScheduler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', agendaRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// A valid agenda item matching the router's itemSchema (and the engine type).
function makeItem(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 'item-1',
    workerUid: 'w1',
    title: 'Inspección de andamios',
    startAt: '2026-05-01T12:00:00.000Z',
    endAt: '2026-05-01T13:00:00.000Z',
    focusBlock: false,
    urgency: 'high',
    reminders: [
      { atOffsetMinutes: 1440, channel: 'email' },
      { atOffsetMinutes: 30, channel: 'push' },
    ],
    ...overrides,
  };
}

// Valid preferences matching prefsSchema (and the engine type).
function makePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    workerUid: 'w1',
    workDayStartHour: 8,
    workDayEndHour: 18,
    channelByUrgency: {
      low: 'in_app',
      medium: 'email',
      high: 'push',
      urgent: 'whatsapp',
    },
    focusBlocksPerDay: 2,
    doNotDisturbAfterHour: 20,
    ...overrides,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/agenda/schedule-reminders', () => {
  const url = '/api/p1/agenda/schedule-reminders';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ item: makeItem() });
    expect(res.status).toBe(401);
  });

  it('200 returns the real scheduled reminders from the engine', async () => {
    const item = makeItem();
    const res = await request(buildApp()).post(url).set(uid).send({ item });
    expect(res.status).toBe(200);
    // Re-derive from the REAL engine — pins offset→triggersAt math + urgency copy.
    expect(res.body.reminders).toEqual(scheduleReminders(item));
    // Sanity on the actual computed instants (not just round-tripped equality).
    expect(res.body.reminders).toHaveLength(2);
    expect(res.body.reminders[0]).toMatchObject({
      itemId: 'item-1',
      triggersAt: '2026-04-30T12:00:00.000Z', // start − 1440min (24h)
      channel: 'email',
      urgency: 'high',
    });
    expect(res.body.reminders[1].triggersAt).toBe('2026-05-01T11:30:00.000Z'); // start − 30min
  });

  it('400 on invalid body (missing item)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid item (bad urgency enum)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ item: makeItem({ urgency: 'critical' as AgendaItem['urgency'] }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/agenda/schedule-reminders')
      .set(uid)
      .send({ item: makeItem() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/agenda/schedule-reminders')
      .set(uid)
      .send({ item: makeItem() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/agenda/select-channel', () => {
  const url = '/api/p1/agenda/select-channel';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ prefs: makePrefs(), urgency: 'high' });
    expect(res.status).toBe(401);
  });

  it('200 maps urgency to the configured channel via the real engine', async () => {
    const prefs = makePrefs();
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ prefs, urgency: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe(selectChannelForUrgency(prefs, 'high'));
    expect(res.body.channel).toBe('push');
  });

  it('200 resolves urgent to whatsapp', async () => {
    const prefs = makePrefs();
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ prefs, urgency: 'urgent' });
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe('whatsapp');
  });

  it('400 on invalid body (missing prefs)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ urgency: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on prefs with an out-of-range hour', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ prefs: makePrefs({ workDayStartHour: 25 }), urgency: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/agenda/select-channel')
      .set(uid)
      .send({ prefs: makePrefs(), urgency: 'high' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/agenda/should-deliver', () => {
  const url = '/api/p1/agenda/should-deliver';

  const reminder = {
    itemId: 'item-1',
    triggersAt: '2026-05-01T22:00:00.000Z',
    channel: 'push' as const,
    urgency: 'medium' as const,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ reminder, prefs: makePrefs(), nowIso: '2026-05-01T22:00:00.000Z' });
    expect(res.status).toBe(401);
  });

  it('200 defers a non-urgent reminder during do-not-disturb hours', async () => {
    const prefs = makePrefs(); // DnD after hour 20
    const nowIso = '2026-05-01T22:00:00.000Z'; // UTC hour 22 ≥ 20 → defer
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ reminder, prefs, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.decision).toEqual(shouldDeliverNow(reminder, prefs, nowIso));
    expect(res.body.decision.deliver).toBe(false);
    expect(res.body.decision.reason).toContain('DnD');
  });

  it('200 always delivers an urgent reminder even inside DnD', async () => {
    const urgent = { ...reminder, urgency: 'urgent' as const };
    const prefs = makePrefs();
    const nowIso = '2026-05-01T23:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ reminder: urgent, prefs, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.decision.deliver).toBe(true);
    expect(res.body.decision).toEqual(shouldDeliverNow(urgent, prefs, nowIso));
  });

  it('200 delivers inside the work window', async () => {
    const prefs = makePrefs();
    const nowIso = '2026-05-01T12:00:00.000Z'; // UTC hour 12, within 8..20
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ reminder, prefs, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.decision.deliver).toBe(true);
  });

  it('400 on invalid body (missing nowIso)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ reminder, prefs: makePrefs() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/agenda/should-deliver')
      .set(uid)
      .send({ reminder, prefs: makePrefs(), nowIso: '2026-05-01T22:00:00.000Z' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/agenda/in-focus-block', () => {
  const url = '/api/p1/agenda/in-focus-block';

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ items: [], nowIso: '2026-05-01T12:30:00.000Z' });
    expect(res.status).toBe(401);
  });

  it('200 returns the active focus block covering now', async () => {
    const focusItem = makeItem({ id: 'focus-1', focusBlock: true });
    const items = [makeItem({ id: 'other', focusBlock: false }), focusItem];
    const nowIso = '2026-05-01T12:30:00.000Z'; // inside 12:00..13:00
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ items, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.focus).toEqual(isInFocusBlock(items, nowIso));
    expect(res.body.focus.id).toBe('focus-1');
  });

  it('200 returns null when no focus block is active', async () => {
    const items = [makeItem({ focusBlock: false })];
    const nowIso = '2026-05-01T12:30:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ items, nowIso });
    expect(res.status).toBe(200);
    expect(res.body.focus).toBeNull();
  });

  it('400 when items is not an array', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ items: 'nope', nowIso: '2026-05-01T12:30:00.000Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/agenda/in-focus-block')
      .set(uid)
      .send({ items: [], nowIso: '2026-05-01T12:30:00.000Z' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/agenda/build-daily-digest', () => {
  const url = '/api/p1/agenda/build-daily-digest';

  const inputs = {
    upcomingItems: [makeItem({ focusBlock: true })],
    overdueActions: 3,
    pendingApprovals: 1,
    freshIncidents: 0,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ workerUid: 'w1', forDate: '2026-05-01', inputs });
    expect(res.status).toBe(401);
  });

  it('200 builds the real digest with the populated sections', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', forDate: '2026-05-01', inputs });
    expect(res.status).toBe(200);
    expect(res.body.digest).toEqual(buildDailyDigest('w1', '2026-05-01', inputs));
    // freshIncidents=0 must NOT produce a section; the other three do.
    const titles = res.body.digest.sections.map((s: { title: string }) => s.title);
    expect(titles).toEqual(['Agenda hoy', 'Pendientes urgentes', 'Aprobaciones']);
    // The agenda bullet renders HH:MM + title + foco tag for a focus block.
    expect(res.body.digest.sections[0].bullets[0]).toBe('12:00 Inspección de andamios (foco)');
  });

  it('200 produces an empty section list when nothing is pending', async () => {
    const empty = {
      upcomingItems: [],
      overdueActions: 0,
      pendingApprovals: 0,
      freshIncidents: 0,
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ workerUid: 'w1', forDate: '2026-05-02', inputs: empty });
    expect(res.status).toBe(200);
    expect(res.body.digest.sections).toEqual([]);
    expect(res.body.digest.workerUid).toBe('w1');
    expect(res.body.digest.forDate).toBe('2026-05-02');
  });

  it('400 on invalid body (negative overdueActions)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        workerUid: 'w1',
        forDate: '2026-05-01',
        inputs: { ...inputs, overdueActions: -1 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/agenda/build-daily-digest')
      .set(uid)
      .send({ workerUid: 'w1', forDate: '2026-05-01', inputs });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
