// Real-router supertest for the Communication Map route
// (src/server/routes/comms.ts — Sprint K §216-221).
//
// Five stateless POST endpoints that exercise the pure engine in
// src/services/comms/communicationMap.ts:
//   /:projectId/comms/best-channel-for-zone
//   /:projectId/comms/detect-dead-zones
//   /:projectId/comms/compute-escalation
//   /:projectId/comms/build-contactability-report
//   /:projectId/comms/plan-channel-failover
//
// Mounted in server.ts under '/api/sprint-k'. Tests cover:
//   • 401 (no token) for every endpoint
//   • 403 when caller is not a project member
//   • 400 on schema violations (via real validate() middleware)
//   • 200 happy-path with correct response shape and real engine output
//   • Business-logic branches (null channel, dead zones, escalation levels,
//     contactability stats, failover recommendation)
//
// No Firestore writes happen here (pure compute) so we only need the
// fakeFirestore to seed project docs for the membership guard.

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

import commsRouter from '../../server/routes/comms.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PROJECT_ID = 'p-comms-1';
const MEMBER_UID = 'member-uid-1';
const STRANGER_UID = 'stranger-uid-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', commsRouter);
  return app;
}

// Seed a project doc so MEMBER_UID passes the membership guard.
function seedProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    members: [MEMBER_UID],
    createdBy: MEMBER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const contact = {
  workerUid: 'w1',
  role: 'operador',
  channels: ['radio_uhf', 'phone_cell', 'app_push'],
};

const zone = {
  zoneId: 'zona-norte',
  availableChannels: ['radio_uhf', 'whatsapp'],
};

const zoneNoOverlap = {
  zoneId: 'zona-aislada',
  availableChannels: ['phone_satellite'],
};

// ─── 1. POST /:projectId/comms/best-channel-for-zone ─────────────────────────

describe('POST /:projectId/comms/best-channel-for-zone', () => {
  const url = (pid = PROJECT_ID) => `/api/sprint-k/${pid}/comms/best-channel-for-zone`;

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url()).send({ contact, zone });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', STRANGER_UID)
      .send({ contact, zone });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on missing contact field (schema validation)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: { workerUid: 'w1' }, zone }); // missing role + channels
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on invalid channel enum value', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: { ...contact, channels: ['INVALID_CHANNEL'] }, zone });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns the best matching channel', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact, zone });
    expect(res.status).toBe(200);
    // contact.channels[0] = 'radio_uhf', zone has 'radio_uhf' → match
    expect(res.body).toEqual({ channel: 'radio_uhf' });
  });

  it('200 returns null when no channel overlaps (dead contact)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact, zone: zoneNoOverlap });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ channel: null });
  });

  it('403 when projectId does not exist in Firestore', async () => {
    const res = await request(buildApp())
      .post(url('nonexistent-project'))
      .set('x-test-uid', MEMBER_UID)
      .send({ contact, zone });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ─── 2. POST /:projectId/comms/detect-dead-zones ─────────────────────────────

describe('POST /:projectId/comms/detect-dead-zones', () => {
  const url = (pid = PROJECT_ID) => `/api/sprint-k/${pid}/comms/detect-dead-zones`;

  const zones = [
    { zoneId: 'z1', availableChannels: ['radio_uhf', 'phone_cell'] },
    { zoneId: 'z2', availableChannels: ['phone_satellite'] },
    { zoneId: 'z3', availableChannels: [] },
  ];
  const requiredChannels = ['radio_uhf'];

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url()).send({ zones, requiredChannels });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', STRANGER_UID)
      .send({ zones, requiredChannels });
    expect(res.status).toBe(403);
  });

  it('400 on missing requiredChannels', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ zones }); // no requiredChannels
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns zones without required channel coverage (dead zones)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ zones, requiredChannels });
    expect(res.status).toBe(200);
    // z1 has radio_uhf → covered. z2 and z3 lack it → dead.
    expect(Array.isArray(res.body.deadZones)).toBe(true);
    const ids = (res.body.deadZones as Array<{ zoneId: string }>).map((z) => z.zoneId);
    expect(ids).toContain('z2');
    expect(ids).toContain('z3');
    expect(ids).not.toContain('z1');
  });

  it('200 returns empty array when all zones are covered', async () => {
    const allCovered = zones.map((z) => ({ ...z, availableChannels: ['radio_uhf'] }));
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ zones: allCovered, requiredChannels });
    expect(res.status).toBe(200);
    expect(res.body.deadZones).toHaveLength(0);
  });
});

// ─── 3. POST /:projectId/comms/compute-escalation ────────────────────────────

describe('POST /:projectId/comms/compute-escalation', () => {
  const url = (pid = PROJECT_ID) => `/api/sprint-k/${pid}/comms/compute-escalation`;

  const chain = [
    { level: 1, uids: ['supervisor-1'], waitMinutes: 5 },
    { level: 2, uids: ['jefe-terreno'], waitMinutes: 10 },
    { level: 3, uids: ['gerencia'], waitMinutes: 30 },
  ];

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url()).send({ chain, minutesSinceTrigger: 0 });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', STRANGER_UID)
      .send({ chain, minutesSinceTrigger: 0 });
    expect(res.status).toBe(403);
  });

  it('400 on invalid minutesSinceTrigger (negative)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ chain, minutesSinceTrigger: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when chain is missing', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ minutesSinceTrigger: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 — level 1 at t=0 (just triggered)', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ chain, minutesSinceTrigger: 0 });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { currentLevel: number; recipientsToNotify: string[]; shouldEscalate: boolean } };
    expect(decision.currentLevel).toBe(1);
    expect(decision.recipientsToNotify).toContain('supervisor-1');
    expect(decision.shouldEscalate).toBe(false);
  });

  it('200 — escalates to level 2 at t=5 min', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ chain, minutesSinceTrigger: 5 });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { currentLevel: number; recipientsToNotify: string[] } };
    expect(decision.currentLevel).toBe(2);
    expect(decision.recipientsToNotify).toContain('jefe-terreno');
  });

  it('200 — reaches last level at t=60 min', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ chain, minutesSinceTrigger: 60 });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { currentLevel: number; recipientsToNotify: string[] } };
    expect(decision.currentLevel).toBe(3);
    expect(decision.recipientsToNotify).toContain('gerencia');
  });

  it('200 — empty chain returns a safe default', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ chain: [], minutesSinceTrigger: 0 });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBeDefined();
  });
});

// ─── 4. POST /:projectId/comms/build-contactability-report ───────────────────

describe('POST /:projectId/comms/build-contactability-report', () => {
  const url = (pid = PROJECT_ID) =>
    `/api/sprint-k/${pid}/comms/build-contactability-report`;

  const tests = [
    { workerUid: 'w1', testedAt: '2024-06-01T10:00:00Z', reachable: true, channelUsed: 'radio_uhf', responseSeconds: 8 },
    { workerUid: 'w2', testedAt: '2024-06-01T10:01:00Z', reachable: false },
    { workerUid: 'w3', testedAt: '2024-06-01T10:02:00Z', reachable: true, channelUsed: 'phone_cell', responseSeconds: 42 },
  ];

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url()).send({ tests });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', STRANGER_UID)
      .send({ tests });
    expect(res.status).toBe(403);
  });

  it('400 when tests entry is missing reachable field', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ tests: [{ workerUid: 'w1', testedAt: '2024-06-01T10:00:00Z' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns correct contactability stats', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ tests });
    expect(res.status).toBe(200);
    const { report } = res.body as {
      report: {
        totalTested: number;
        reachable: number;
        unreachable: number;
        reachabilityPercent: number;
        unreachableUids: string[];
      };
    };
    expect(report.totalTested).toBe(3);
    expect(report.reachable).toBe(2);
    expect(report.unreachable).toBe(1);
    expect(report.reachabilityPercent).toBe(67); // Math.round(2/3*100)
    expect(report.unreachableUids).toContain('w2');
    expect(report.unreachableUids).not.toContain('w1');
  });

  it('200 with zero tests returns 0% reachability', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ tests: [] });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: { totalTested: number; reachabilityPercent: number } };
    expect(report.totalTested).toBe(0);
    expect(report.reachabilityPercent).toBe(0);
  });

  it('200 when all workers are unreachable', async () => {
    const allUnreachable = tests.map((t) => ({ ...t, reachable: false, channelUsed: undefined, responseSeconds: undefined }));
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ tests: allUnreachable });
    expect(res.status).toBe(200);
    const { report } = res.body as { report: { reachable: number; reachabilityPercent: number; unreachableUids: string[] } };
    expect(report.reachable).toBe(0);
    expect(report.reachabilityPercent).toBe(0);
    expect(report.unreachableUids).toHaveLength(3);
  });
});

// ─── 5. POST /:projectId/comms/plan-channel-failover ─────────────────────────

describe('POST /:projectId/comms/plan-channel-failover', () => {
  const url = (pid = PROJECT_ID) => `/api/sprint-k/${pid}/comms/plan-channel-failover`;

  const contactWithFallback = {
    workerUid: 'w1',
    role: 'operador',
    channels: ['radio_uhf', 'phone_cell', 'app_push'],
  };

  const zoneBothAvailable = {
    zoneId: 'z1',
    availableChannels: ['radio_uhf', 'phone_cell', 'app_push'],
  };

  it('401 without token', async () => {
    const res = await request(buildApp())
      .post(url())
      .send({ contact: contactWithFallback, zone: zoneBothAvailable, isPrimaryDown: false });
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', STRANGER_UID)
      .send({ contact: contactWithFallback, zone: zoneBothAvailable, isPrimaryDown: false });
    expect(res.status).toBe(403);
  });

  it('400 when isPrimaryDown is missing', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: contactWithFallback, zone: zoneBothAvailable }); // no isPrimaryDown
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when zone is missing availableChannels', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: contactWithFallback, zone: { zoneId: 'z1' }, isPrimaryDown: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 recommends primary when it is available and not down', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: contactWithFallback, zone: zoneBothAvailable, isPrimaryDown: false });
    expect(res.status).toBe(200);
    const { decision } = res.body as {
      decision: {
        primaryChannel: string;
        primaryAvailable: boolean;
        fallbackChannel: string | null;
        fallbackAvailable: boolean;
        recommendedChannel: string | null;
      };
    };
    expect(decision.primaryChannel).toBe('radio_uhf');
    expect(decision.primaryAvailable).toBe(true);
    expect(decision.recommendedChannel).toBe('radio_uhf');
  });

  it('200 recommends fallback when primary is down', async () => {
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: contactWithFallback, zone: zoneBothAvailable, isPrimaryDown: true });
    expect(res.status).toBe(200);
    const { decision } = res.body as {
      decision: {
        primaryAvailable: boolean;
        fallbackChannel: string | null;
        recommendedChannel: string | null;
      };
    };
    expect(decision.primaryAvailable).toBe(false);
    expect(decision.fallbackChannel).toBe('phone_cell');
    expect(decision.recommendedChannel).toBe('phone_cell');
  });

  it('200 recommendedChannel is null when primary down AND no fallback available in zone', async () => {
    const zoneNoFallback = { zoneId: 'z-isolated', availableChannels: ['radio_uhf'] };
    // Primary is down; only radio_uhf is in zone which is also the primary
    const res = await request(buildApp())
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ contact: contactWithFallback, zone: zoneNoFallback, isPrimaryDown: true });
    expect(res.status).toBe(200);
    const { decision } = res.body as { decision: { recommendedChannel: string | null; fallbackAvailable: boolean } };
    expect(decision.recommendedChannel).toBeNull();
    expect(decision.fallbackAvailable).toBe(false);
  });
});
