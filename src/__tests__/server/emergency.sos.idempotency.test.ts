// Audit 2026-07-02 §3.1 #5 (VIDA) — POST /api/emergency/sos server-side
// idempotency, exercised through the REAL router AND the REAL idempotencyKey
// middleware (unlike emergency.router.test.ts, which mocks the middleware to
// a no-op to focus on handler logic).
//
// The bug this pins: the SOS outbox retries on transport failure. When the
// first POST reached the server (alert doc written, fan-out fired) but the
// RESPONSE was lost (flaky mobile network), the retry used to create a SECOND
// emergency_alerts doc and re-fire pushes to the whole supervisor roster.
// With idempotencyKey() on the route, the retry replays the recorded response:
// exactly one alert, exactly one fan-out, same alertId back to the client.
//
// Also pins the middleware's safety semantics on this life-critical route:
//   • header absent → passes through (legacy clients unaffected)
//   • same key + different body → 422 (Stripe fingerprint semantics)
//   • non-2xx is NOT cached (a failed SOS stays retryable against fresh state)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import 'express-async-errors';

// ── hoisted holder ───────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  fcmSendEach: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] }),
  emailSendBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  emailEnabled: false,
}));

// ── firebase-admin mock (shared fake Firestore also backs the idempotency cache) ──
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const fakeMessaging = {
    sendEachForMulticast: (...args: unknown[]) => H.fcmSendEach(...args),
  };
  const base = adminMock(() => H.db!);
  return {
    ...base,
    default: {
      ...base.default,
      messaging: () => fakeMessaging,
    },
    messaging: () => fakeMessaging,
  };
});

// ── verifyAuth: x-test-uid→user, absent→401 ─────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: `${uid}@test.com`,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

// NOTE: idempotencyKey middleware is NOT mocked here — that is the point.

// ── sosLimiter: no-op in tests ───────────────────────────────────────────────
vi.mock('express-rate-limit', () => {
  const rateLimit = () => (_req: Request, _res: Response, next: NextFunction) => next();
  rateLimit.ipKeyGenerator = () => 'ip';
  return { default: rateLimit, ipKeyGenerator: () => 'ip' };
});

// ── logger / error capture / tracing ─────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: async (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
}));
// The REAL idempotencyKey middleware imports getErrorTracker from the
// observability barrel — stub it so no Sentry SDK loads in the test process.
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// ── membership fast-path + email (mirror emergency.router.test.ts) ──────────
vi.mock('../../services/auth/customClaims.js', () => ({
  resolveAssignedSitesCheck: () => ({ resolved: false, member: false }),
}));
vi.mock('../../services/email/resendService.js', () => ({
  EmailService: {
    fromEnv: () => (H.emailEnabled ? {
      sendBatch: (...args: unknown[]) => H.emailSendBatch(...args),
    } : null),
  },
}));
vi.mock('../../services/email/templates.js', () => ({
  sosBackupTemplate: () => '<html>SOS</html>',
}));

// ── import the REAL router AFTER mocks ──────────────────────────────────────
import emergencyRouter, { __clearUserTokenCache } from '../../server/routes/emergency.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { IDEMPOTENCY_CACHE_COLLECTION } from '../../server/middleware/idempotencyKey.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/emergency', emergencyRouter);
  return app;
}

function seedProject(
  db: ReturnType<typeof createFakeFirestore>,
  projectId: string,
  { members = [] as string[] } = {},
) {
  db._seed(`projects/${projectId}`, {
    tenantId: projectId,
    createdBy: members[0] ?? 'owner',
    members,
    name: projectId,
  });
}

/** Docs whose path contains the given collection segment. */
function docsUnder(db: ReturnType<typeof createFakeFirestore>, segment: string): string[] {
  return Object.keys(db._dump()).filter((p) => p.includes(`/${segment}/`) || p.startsWith(`${segment}/`));
}

/**
 * The middleware's response-cache write is deliberately fire-and-forget
 * (void writeCache(...) inside the res.json patch). Drain the microtask +
 * immediate queue so the cache row is durably in the fake store before the
 * retry is issued — this is exactly the real-world ordering (retries happen
 * seconds later, not in the same tick).
 */
async function drainCacheWrite(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

const SOS = '/api/emergency/sos';
const BODY = {
  type: 'sos',
  projectId: 'p1',
  geo: { lat: -33.45, lng: -70.66 },
  timestamp: '2026-07-02T10:00:00.000Z',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.fcmSendEach.mockClear();
  H.fcmSendEach.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] });
  H.emailSendBatch.mockClear();
  H.emailEnabled = false;
  __clearUserTokenCache();
  seedProject(H.db!, 'p1', { members: ['u1'] });
  H.db!._seed('projects/p1/members/u1', { role: 'worker' });
  H.db!._seed('users/sup1', { fcmTokens: ['tok-1'] });
  H.db!._seed('projects/p1/members/sup1', { role: 'supervisor' });
});

describe('POST /api/emergency/sos — server-side idempotency (§3.1 #5 VIDA)', () => {
  it('a retried SOS with the same Idempotency-Key creates exactly ONE alert and ONE fan-out, and replays the same alertId', async () => {
    const app = buildApp();

    const res1 = await request(app)
      .post(SOS)
      .set('x-test-uid', 'u1')
      .set('Idempotency-Key', 'evt-uuid-1')
      .send(BODY);
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    const alertId1 = res1.body.alertId as string;
    expect(alertId1).toBeTruthy();

    await drainCacheWrite();

    // The transport retry: same event, same key, same body.
    const res2 = await request(app)
      .post(SOS)
      .set('x-test-uid', 'u1')
      .set('Idempotency-Key', 'evt-uuid-1')
      .send(BODY);

    expect(res2.status).toBe(200);
    expect(res2.headers['idempotent-replayed']).toBe('true');
    expect(res2.body.alertId).toBe(alertId1);

    // Exactly ONE alert doc, exactly ONE push fan-out — the whole point.
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(1);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
  });

  it('writes the response cache row on the first 2xx (wiring pin: /sos is actually behind the middleware)', async () => {
    await request(buildApp())
      .post(SOS)
      .set('x-test-uid', 'u1')
      .set('Idempotency-Key', 'evt-uuid-2')
      .send(BODY);
    await drainCacheWrite();

    const cacheDocs = Object.keys(H.db!._dump()).filter((p) =>
      p.startsWith(`${IDEMPOTENCY_CACHE_COLLECTION}/`),
    );
    expect(cacheDocs).toHaveLength(1);
  });

  it('two DIFFERENT keys are two real SOS: two alert docs, two fan-outs', async () => {
    const app = buildApp();
    await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-a').send(BODY);
    await drainCacheWrite();
    await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-b').send(BODY);

    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(2);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(2);
  });

  it('header absent → passes through untouched (legacy clients keep working, no accidental dedupe)', async () => {
    const app = buildApp();
    const r1 = await request(app).post(SOS).set('x-test-uid', 'u1').send(BODY);
    await drainCacheWrite();
    const r2 = await request(app).post(SOS).set('x-test-uid', 'u1').send(BODY);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.headers['idempotent-replayed']).toBeUndefined();
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(2);
  });

  it('same key with a DIFFERENT body → 422 (Stripe fingerprint semantics; a key is one event)', async () => {
    const app = buildApp();
    await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-c').send(BODY);
    await drainCacheWrite();

    const res = await request(app)
      .post(SOS)
      .set('x-test-uid', 'u1')
      .set('Idempotency-Key', 'evt-c')
      .send({ ...BODY, geo: { lat: -20.2, lng: -70.1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('idempotency_key_reused_with_different_params');
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(1);
  });

  it('a 4xx is NOT cached: the same key stays retryable against fresh state (no replay of failures)', async () => {
    const app = buildApp();
    const bad = { ...BODY, geo: { lat: 999, lng: 0 } };

    const r1 = await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-d').send(bad);
    expect(r1.status).toBe(400);
    await drainCacheWrite();

    const r2 = await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-d').send(bad);
    expect(r2.status).toBe(400);
    expect(r2.headers['idempotent-replayed']).toBeUndefined();

    const cacheDocs = Object.keys(H.db!._dump()).filter((p) =>
      p.startsWith(`${IDEMPOTENCY_CACHE_COLLECTION}/`),
    );
    expect(cacheDocs).toHaveLength(0);
  });

  it('keys are scoped per-uid: the same key from another user does NOT replay a foreign SOS', async () => {
    const app = buildApp();
    // u2 is also a member of p1.
    H.db!._seed('projects/p1/members/u2', { role: 'worker' });
    const p1 = H.db!._dump()['projects/p1'] as { members?: string[] };
    H.db!._seed('projects/p1', { ...p1, members: ['u1', 'u2', 'sup1'] });

    const r1 = await request(app).post(SOS).set('x-test-uid', 'u1').set('Idempotency-Key', 'evt-shared').send(BODY);
    await drainCacheWrite();
    const r2 = await request(app).post(SOS).set('x-test-uid', 'u2').set('Idempotency-Key', 'evt-shared').send(BODY);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.headers['idempotent-replayed']).toBeUndefined();
    expect(r2.body.alertId).not.toBe(r1.body.alertId);
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(2);
  });
});
