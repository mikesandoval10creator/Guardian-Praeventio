// Praeventio Guard — Sprint 24 Bucket KK.3: onboarding completion integration tests.
//
// Covers POST /api/onboarding/complete (src/server/routes/onboarding.ts):
//   • 401 unauthed (verifyAuth gate).
//   • 400 on each validation branch (industry / country / tier / project name).
//   • Happy path persists tenantConfig + creates project + marks onboarded.
//   • Paid tier sets `pendingTier` + `status: pending_payment` rather than
//     activating directly (the paid invoice gate in subscription.test.ts
//     is the only thing that can flip status to active).
//   • Step-3 invitation email failures are swallowed (best-effort step):
//     a flaky Resend MUST NOT 5xx the wizard.
//
// We mock firebase-admin with a tiny in-memory store so the handler runs
// without touching real Firestore. The shape mirrors what onboarding.ts
// actually calls: `firestore().collection().doc().set()/get()/update()`,
// `firestore.FieldValue.serverTimestamp()`, and `firestore.Timestamp`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ─── In-memory firestore stub ────────────────────────────────────────────
// Path-addressed store keyed by `<collection>/<docId>(/...)*`. The route
// writes to:
//   users/{uid}                                          (step 1, 5)
//   tenants/{uid}/projects/{auto}                        (step 2)
//   tenants/{uid}/projects/{pid}/invitations/{token}     (step 3)
//   tenants/{uid}/imports/onboarding-{ts}                (step 4)
// so we expose enough of the chain to reach those paths.

interface DocSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  id: string;
}

class FakeDocRef {
  constructor(
    public readonly path: string,
    public readonly store: Map<string, Record<string, unknown>>,
    public readonly id: string,
  ) {}
  collection(name: string): FakeColRef {
    return new FakeColRef(`${this.path}/${name}`, this.store);
  }
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    const existing = this.store.get(this.path);
    if (opts?.merge && existing) {
      this.store.set(this.path, { ...existing, ...data });
    } else {
      this.store.set(this.path, { ...data });
    }
  }
  async get(): Promise<DocSnap> {
    const data = this.store.get(this.path);
    return {
      exists: data !== undefined,
      data: () => data,
      id: this.id,
    };
  }
  async update(data: Record<string, unknown>): Promise<void> {
    const existing = this.store.get(this.path) ?? {};
    this.store.set(this.path, { ...existing, ...data });
  }
}

class FakeColRef {
  constructor(
    public readonly path: string,
    public readonly store: Map<string, Record<string, unknown>>,
  ) {}
  doc(id?: string): FakeDocRef {
    const docId = id ?? `auto-${Math.random().toString(36).slice(2, 10)}`;
    return new FakeDocRef(`${this.path}/${docId}`, this.store, docId);
  }
}

const firestoreStore = new Map<string, Record<string, unknown>>();

// Knobs flipped per-test to simulate failure modes.
const failNextSet: { value: 'users' | 'project' | null } = { value: null };

class FakeFirestore {
  collection(name: string): FakeColRef {
    const col = new FakeColRef(name, firestoreStore);
    if (failNextSet.value) {
      const original = col.doc.bind(col);
      col.doc = (id?: string) => {
        const ref = original(id);
        const origSet = ref.set.bind(ref);
        ref.set = async (...args) => {
          if (
            (failNextSet.value === 'users' && ref.path.startsWith('users/')) ||
            (failNextSet.value === 'project' && ref.path.includes('/projects/'))
          ) {
            failNextSet.value = null;
            throw new Error('simulated_firestore_failure');
          }
          return origSet(...args);
        };
        return ref;
      };
    }
    return col;
  }
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    // The route doesn't use runTransaction; idempotency middleware does,
    // but we bypass that middleware entirely (see mock below).
    return fn({});
  }
}

const fakeFirestoreInstance = new FakeFirestore();
const firestoreFn = vi.fn(() => fakeFirestoreInstance);
// firestore.FieldValue.serverTimestamp() returns a sentinel; equality
// against any real Timestamp is irrelevant for these tests.
(firestoreFn as unknown as Record<string, unknown>).FieldValue = {
  serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
};
(firestoreFn as unknown as Record<string, unknown>).Timestamp = {
  fromMillis: (ms: number) => ({ __ts: ms, toMillis: () => ms }),
};

vi.mock('firebase-admin', () => ({
  default: { firestore: firestoreFn },
  firestore: firestoreFn,
}));

// ─── Middleware mocks ────────────────────────────────────────────────────

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = auth.slice('Bearer '.length);
    const [, uid, email] = token.split(':');
    req.user = { uid: uid ?? 'uid-test', email: email || `${uid}@test.com` };
    return next();
  },
}));

// idempotencyKey() is a factory; we pass-through.
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const auditServerEventMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: auditServerEventMock,
}));

const captureRouteErrorMock = vi.fn(() => {});
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: captureRouteErrorMock,
}));

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock('../../utils/logger.js', () => ({ logger: loggerMock }));

// ─── EmailService + template mocks ───────────────────────────────────────
// `EmailService.fromEnv()` returns null when RESEND_API_KEY is absent;
// when we want to exercise step-3 we return a stub whose send() resolves
// or rejects per test.

const emailSendMock = vi.fn(async () => ({ ok: true, id: 'msg_x' }));
const fromEnvMock = vi.fn(() => ({ send: emailSendMock }));
vi.mock('../../services/email/resendService.js', () => ({
  EmailService: { fromEnv: fromEnvMock },
}));

vi.mock('../../services/email/templates.js', () => ({
  projectInvitationTemplate: vi.fn(() => '<html>invite</html>'),
}));

// ─── TIERS mock ──────────────────────────────────────────────────────────
// We expose just enough to drive the `VALID_TIER_IDS` Set the route
// builds at module-load — `gratis` + one paid tier `oro` are sufficient
// to cover the free-vs-paid branch. Any other tier id must trigger 400.
vi.mock('../../services/pricing/tiers.js', () => ({
  TIERS: [
    { id: 'gratis' },
    { id: 'oro' },
  ],
}));

// ─── App builder ─────────────────────────────────────────────────────────

async function buildApp(): Promise<Express> {
  const { onboardingRouter } = await import('../../server/routes/onboarding.js');
  const app = express();
  app.use(express.json());
  app.use('/api', onboardingRouter);
  return app;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    industry: 'mining',
    countries: ['CL'],
    tier: 'gratis',
    inviteEmails: [],
    projectName: 'Faena Norte',
    workersCsv: null,
    ...overrides,
  };
}

beforeEach(() => {
  firestoreStore.clear();
  failNextSet.value = null;
  auditServerEventMock.mockClear();
  captureRouteErrorMock.mockClear();
  emailSendMock.mockClear();
  emailSendMock.mockResolvedValue({ ok: true, id: 'msg_x' });
  fromEnvMock.mockClear();
  fromEnvMock.mockReturnValue({ send: emailSendMock });
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

describe('POST /api/onboarding/complete', () => {
  it('returns 401 when no Authorization header is supplied', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .send(validPayload());
    expect(res.status).toBe(401);
    // Storage must NOT have been mutated.
    expect(firestoreStore.size).toBe(0);
  });

  it('returns 400 when industry is missing', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ industry: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry');
  });

  it('returns 400 when industry is not in the allow-list', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ industry: 'galactic-mining' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry');
  });

  it('returns 400 when country code is not in the allow-list', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ countries: ['ZZ'] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid_country/);
  });

  it('returns 400 when tier id is unknown (not in TIERS)', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ tier: 'galactic-emperor' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_tier');
  });

  it('returns 400 when projectName is shorter than 2 chars', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ projectName: 'x' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_project_name');
  });

  it('happy path (free tier): persists tenantConfig, creates project, marks onboarded=true', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send(validPayload({ tier: 'gratis', projectName: 'Faena Norte' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.projectId).toBeTruthy();
    expect(res.body.pendingPayment).toBe(false);

    // Step 1: users/{uid} written with tenantConfig + onboarded flag.
    const userDoc = firestoreStore.get('users/uid-A') as Record<string, unknown>;
    expect(userDoc).toBeDefined();
    expect((userDoc.tenantConfig as Record<string, unknown>).industry).toBe('mining');
    expect((userDoc.tenantConfig as Record<string, unknown>).tier).toBe('gratis');
    expect(userDoc.onboarded).toBe(true);
    // Free tier → planId already gratis, status active (no pendingTier).
    const sub = userDoc.subscription as Record<string, unknown>;
    expect(sub.planId).toBe('gratis');
    expect(sub.status).toBe('active');
    expect(sub.pendingTier).toBeUndefined();

    // Step 2: project doc lives under tenants/{uid}/projects/.
    const projectKey = [...firestoreStore.keys()].find((k) =>
      k.startsWith('tenants/uid-A/projects/'),
    );
    expect(projectKey).toBeDefined();
    const project = firestoreStore.get(projectKey!) as Record<string, unknown>;
    expect(project.name).toBe('Faena Norte');
    expect(project.ownerUid).toBe('uid-A');
    expect(project.source).toBe('onboarding-wizard');

    // Step ✓: audit row emitted.
    expect(auditServerEventMock).toHaveBeenCalledTimes(1);
    expect(auditServerEventMock.mock.calls[0][1]).toBe('onboarding.completed');
  });

  it('paid tier records pendingTier + status=pending_payment instead of activating', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-B:b@test.com')
      .send(validPayload({ tier: 'oro' }));

    expect(res.status).toBe(200);
    expect(res.body.pendingPayment).toBe(true);

    const userDoc = firestoreStore.get('users/uid-B') as Record<string, unknown>;
    const sub = userDoc.subscription as Record<string, unknown>;
    // Critical: planId stays 'gratis' until the paid-invoice flow flips it.
    // Activating here would bypass DT-01/DT-05 (free Ilimitado attack).
    expect(sub.planId).toBe('gratis');
    expect(sub.pendingTier).toBe('oro');
    expect(sub.status).toBe('pending_payment');
  });

  it('best-effort email: send() failure does NOT 5xx the onboarding', async () => {
    // Resend goes down mid-wizard. The invitation row must still be
    // persisted (it's the source of truth) and the route must return
    // 200 with the project created.
    emailSendMock.mockRejectedValueOnce(new Error('resend_unavailable'));

    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-C:c@test.com')
      .send(
        validPayload({
          tier: 'gratis',
          inviteEmails: ['teammate@test.com'],
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The invited email IS returned (the invitation row was persisted
    // even though the email delivery failed) — that matches the route's
    // best-effort comment.
    expect(res.body.invitedEmails).toContain('teammate@test.com');

    // The failure was logged at warn level, not error / 5xx.
    expect(loggerMock.warn).toHaveBeenCalled();
    const warnEvents = loggerMock.warn.mock.calls.map((c) => c[0]);
    expect(warnEvents).toContain('onboarding_email_failed');

    // Invitation row was written under the project's invitations subcollection.
    const inviteKey = [...firestoreStore.keys()].find((k) =>
      k.includes('/invitations/'),
    );
    expect(inviteKey).toBeDefined();
    const invite = firestoreStore.get(inviteKey!) as Record<string, unknown>;
    expect(invite.email).toBe('teammate@test.com');
    expect(invite.status).toBe('pending');
  });

  it('marks users/{uid}.onboarded=true so App.tsx redirect guard stops bouncing the user', async () => {
    // This is the App.tsx contract — once onboarded=true the redirect
    // guard short-circuits. We assert the flag explicitly because losing
    // it regresses straight back to an infinite loop.
    const app = await buildApp();
    const res = await request(app)
      .post('/api/onboarding/complete')
      .set('Authorization', 'Bearer test:uid-D:d@test.com')
      .send(validPayload());

    expect(res.status).toBe(200);
    const userDoc = firestoreStore.get('users/uid-D') as Record<string, unknown>;
    expect(userDoc.onboarded).toBe(true);
    expect(userDoc.onboardedAt).toBeTruthy();
  });
});
