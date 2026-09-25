/**
 * CONCURRENCY probe — P0 VIDA ticket:
 * "[Jev-audit][P0][VIDA] emergency delivery puede duplicar fan-out FCM bajo
 * concurrencia"
 *
 * The existing idempotency suite (emergency.sos.idempotency.test.ts) proves
 * SEQUENTIAL retry safety only (request → drainCacheWrite → retry). It never
 * exercises two in-flight requests racing on the same Idempotency-Key.
 *
 * This probe fires N CONCURRENT POST /api/emergency/sos requests with the
 * SAME key and asserts the P0 contract at the behaviour level, independent
 * of the dedup mechanism chosen:
 *
 *   - exactly ONE emergency_alerts document is created;
 *   - the FCM fan-out fires exactly ONCE (the VIDA-safety claim);
 *   - at least one caller gets 200; the others get 200-replay or 409;
 *   - never a 5xx and never two undistinguished 200s (phantom delivery).
 *
 * Evidence contract (Jev-audit handoff): passing here is test-confirmed on
 * the Node test runtime. It does not certify Android reachability or
 * production Firestore semantics (runtime-pending).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import 'express-async-errors';

// ── hoisted holder (mirrors emergency.sos.idempotency.test.ts) ──────────────
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

vi.mock('firebase-admin/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase-admin/firestore')>(
    'firebase-admin/firestore',
  );
  return {
    ...actual,
    getFirestore: (..._args: unknown[]) => {
      if (!H.db) throw new Error('firebase-admin/firestore called before H.db was seeded');
      return H.db;
    },
  };
});

vi.mock('firebase-admin/messaging', async () => {
  const actual = await vi.importActual<typeof import('firebase-admin/messaging')>(
    'firebase-admin/messaging',
  );
  return {
    ...actual,
    getMessaging: () => ({
      sendEachForMulticast: (...args: unknown[]) => H.fcmSendEach(...args),
    }),
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

// ── import the REAL router + middleware AFTER mocks ─────────────────────────
import emergencyRouter, { __clearUserTokenCache } from '../../server/routes/emergency.js';
import { idempotencyKey } from '../../server/middleware/idempotencyKey.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

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

// ── shared HTTP server + real parallel fetch ─────────────────────────────────
// WHY: supertest boots a fresh HTTP server per request, and the per-request
// transport serialises them — the second request only reaches the middleware
// after the first has already written its cache row, so supertest can never
// produce the in-flight race this probe is about. One shared listener + N
// parallel fetches drives both requests through the middleware inside the
// same event loop, which is the concurrency the P0 ticket describes.
let server: Server | null = null;
let baseUrl = '';

function startServer(): void {
  const app = buildApp();
  server = app.listen(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  const current = server;
  server = null;
  baseUrl = '';
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
}

function postSos(key: string): Promise<globalThis.Response> {
  const url = new URL(`${baseUrl}${SOS}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          connection: 'close',
          'x-test-uid': 'u1',
          'Idempotency-Key': key,
        },
        agent: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value);
            else if (Array.isArray(value)) responseHeaders.set(name, value.join(', '));
          }
          resolve(
            new globalThis.Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 0,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(BODY));
  });
}

/** Lets the fire-and-forget cache write (void writeCache) settle. */
async function drainCacheWrite(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('idempotencyKey middleware — deterministic in-flight race (component probe)', () => {
  /**
   * WHY component-level: over real HTTP the local transport serialises the
   * two requests enough that the second one lands after the first has already
   * written its cache row (see the shared-server suite above). That masks the
   * race. Here BOTH middleware invocations start in the same tick and block on
   * the same `ref.get()` await, so both observe the cache-miss — exactly the
   * window the P0 ticket describes. The P0 contract is behavioural: the
   * downstream handler (next) must run exactly ONCE for one key.
   */
  it('two in-flight middleware invocations with the same key run next() exactly ONCE', async () => {
    const mw = idempotencyKey();
    const KEY = 'evt-uuid-component-race';

    let nextCalls = 0;
    const responses: Array<{ statusCode: number; body: unknown; replayed: boolean }> = [];

    function makeReq() {
      return {
        method: 'POST',
        originalUrl: '/api/emergency/sos',
        url: '/api/emergency/sos',
        body: BODY,
        headers: { 'idempotency-key': KEY } as Record<string, string>,
        get(name: string) {
          return this.headers[name.toLowerCase()];
        },
        user: { uid: 'u1', tenantId: undefined },
      } as unknown as Parameters<ReturnType<typeof idempotencyKey>>[0];
    }

    function makeRes(onDone?: () => void) {
      const headers: Record<string, string> = {};
      const res = {
        statusCode: 200,
        headers,
        body: undefined as unknown,
        setHeader(n: string, v: string) {
          headers[n.toLowerCase()] = String(v);
          return this;
        },
        getHeader(n: string) {
          return headers[n.toLowerCase()];
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        send(payload: unknown) {
          this.body = payload;
          responses.push({
            statusCode: this.statusCode,
            body: payload,
            replayed: headers['idempotent-replayed'] === 'true',
          });
          onDone?.();
          return this;
        },
        json(payload: unknown) {
          this.body = payload;
          responses.push({
            statusCode: this.statusCode,
            body: payload,
            replayed: headers['idempotent-replayed'] === 'true',
          });
          onDone?.();
          return this;
        },
      };
      return res as unknown as Parameters<ReturnType<typeof idempotencyKey>>[1];
    }

    async function runOne() {
      const req = makeReq();
      let onDone: (() => void) | undefined;
      const done = new Promise<void>((resolve) => {
        onDone = resolve;
      });
      const res = makeRes(() => onDone?.());
      // Fire the middleware; it either runs the handler (winner) or answers
      // 409 directly (loser). `done` resolves when a response is sent either
      // way.
      void mw(req, res, (() => {
        nextCalls += 1;
        // Simulated handler work (fan-out window).
        setTimeout(() => {
          res.json({ ok: true, alertId: `alert-${nextCalls}` });
        }, 20);
      }) as unknown as Parameters<ReturnType<typeof idempotencyKey>>[2]);
      await done;
      return res;
    }

    // Both invocations enter the middleware in the same tick.
    await Promise.all([runOne(), runOne()]);
    await drainCacheWrite();

    // ── THE P0 CONTRACT ──────────────────────────────────────────────
    // The handler (next) is the fan-out gateway. Exactly one execution.
    expect(nextCalls).toBe(1);

    // Outcomes must still be sane: one 200 creator, the other replay-or-409.
    expect(responses.length).toBe(2);
    for (const r of responses) {
      expect([200, 409]).toContain(r.statusCode);
    }
  });
});

describe('POST /api/emergency/sos — CONCURRENT idempotency (P0 VIDA probe)', () => {
  beforeAll(startServer);
  afterAll(stopServer);

  it('two in-flight same-key SOS requests trigger exactly ONE alert and ONE fan-out', async () => {

    const [r1, r2] = await Promise.all([
      postSos('evt-uuid-concurrent-1'),
      postSos('evt-uuid-concurrent-1'),
    ]);
    await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);

    // Both callers must get a sane outcome: one 200 (creator); the other a
    // replayed 200 or a retryable 409. Never a 5xx.
    const statuses = [r1.status, r2.status];
    expect(statuses).toContain(200);
    for (const s of statuses) {
      expect([200, 409]).toContain(s);
    }

    // If both are 200, exactly one must be flagged as a replay — otherwise
    // the second "success" is a phantom duplicate delivery.
    const ok200 = [r1, r2].filter((r) => r.status === 200);
    if (ok200.length === 2) {
      const replayed = [r1, r2].filter(
        (r) => r.headers.get('idempotent-replayed') === 'true',
      );
      expect(replayed.length).toBe(1);
    }

    // ── THE P0 CONTRACT ──────────────────────────────────────────────
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(1);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
  });

  it('five in-flight same-key SOS requests fan out exactly ONCE', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postSos('evt-uuid-concurrent-5')),
    );
    await Promise.all(responses.map((response) => response.arrayBuffer()));

    for (const r of responses) {
      expect([200, 409]).toContain(r.status);
    }
    expect(responses.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);

    // ── THE P0 CONTRACT ──────────────────────────────────────────────
    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(1);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
  });

  it('sequential retry AFTER a concurrent race still replays the same alertId (no phantom alert)', async () => {
    const [r1, r2] = await Promise.all([
      postSos('evt-uuid-concurrent-seq'),
      postSos('evt-uuid-concurrent-seq'),
    ]);
    const bodies = await Promise.all([r1.json(), r2.json()]);
    const winner = [r1, r2]
      .map((r, i) => ({ r, body: bodies[i] as { alertId?: string } }))
      .find(({ r, body }) => r.status === 200 && body.alertId);
    expect(winner).toBeTruthy();

    // Later transport retry, same key, same body — must replay, never re-send.
    const res3 = await postSos('evt-uuid-concurrent-seq');
    const body3 = (await res3.json()) as { alertId?: string };

    expect(res3.status).toBe(200);
    expect(res3.headers.get('idempotent-replayed')).toBe('true');
    expect(body3.alertId).toBe(winner!.body.alertId);

    expect(docsUnder(H.db!, 'emergency_alerts')).toHaveLength(1);
    expect(H.fcmSendEach).toHaveBeenCalledTimes(1);
  });
});
