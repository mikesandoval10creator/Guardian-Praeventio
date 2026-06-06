// Praeventio Guard — Google OAuth callback security suite.
//
// Covers the dual-router design in src/server/routes/oauthGoogle.ts:
//   • oauthGoogleAuthRouter mounted at `/auth`     â†’ /auth/google/callback
//   • oauthGoogleApiRouter  mounted at `/api`      â†’ /api/drive/auth/callback
//
// Both callbacks consume a per-flow `state` (CSRF token) that was minted by
// the matching URL-issuance endpoint and stamped on `req.session`. The
// tests below exercise:
//
//   1. State tampering (missing/invalid `state` â†’ 403).
//   2. Cross-router CSRF (state issued for `/auth/google/callback` cannot
//      be redeemed at `/api/drive/auth/callback`, even with a real `code`).
//   3. Happy path: valid state + valid `code` â†’ token exchange runs and
//      tokens are persisted via saveTokens().
//   4. Missing access_token in token-exchange response â†’ 500 (error
//      propagated, no tokens saved).
//
// The production handlers exchange the OAuth code by calling
// `fetch('https://oauth2.googleapis.com/token', â€¦)` directly — the
// `googleapis` package is NOT used in this route (it's used elsewhere for
// Calendar/Fit). We therefore stub `global.fetch` rather than `googleapis`.
//
// We also mock `oauthTokenStore` and `auditLog` so the handler runs without
// touching Firebase Admin (which would otherwise demand real credentials).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// â”€â”€â”€ Module mocks (must be hoisted via vi.mock before route import) â”€â”€â”€â”€

const saveTokensMock = vi.fn(async () => {});
const getValidAccessTokenMock = vi.fn(async () => null);
const revokeTokensMock = vi.fn(async () => {});

vi.mock('../../services/oauthTokenStore.js', () => ({
  saveTokens: saveTokensMock,
  getValidAccessToken: getValidAccessTokenMock,
  revokeTokens: revokeTokensMock,
}));

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, _res: Response, next: NextFunction) => {
    // Trust a `Bearer test:<uid>` convention so the URL-issuance endpoints
    // can stamp the session with a known uid.
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    const [, uid] = token.split(':');
    req.user = { uid: uid ?? 'uid-test', email: `${uid ?? 'uid-test'}@test.com` };
    next();
  },
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => {}),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// firebase-admin mock — needed because the Drive auth-URL route is now gated by
// `requireTier` (directive #11), which reads users/{uid}.subscription.planId.
const HADMIN = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => HADMIN.db!);
});
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));

// Tiny in-memory session middleware — the production code does
// `req.session as any` and writes properties; we just need a stable object
// across requests in the same supertest agent.
function makeSessionMiddleware() {
  const sessions = new Map<string, Record<string, unknown>>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const sid = req.header('x-test-session') ?? 'default';
    if (!sessions.has(sid)) sessions.set(sid, {});
    (req as any).session = sessions.get(sid);
    next();
  };
}

// Build an Express app that mounts the two oauthGoogle routers exactly as
// server.ts does (apiRouter under /api, authRouter under /auth root).
async function buildApp(): Promise<Express> {
  const { oauthGoogleApiRouter, oauthGoogleAuthRouter } = await import(
    '../../server/routes/oauthGoogle.js'
  );
  const app = express();
  app.use(express.json());
  app.use(makeSessionMiddleware());
  app.use('/api', oauthGoogleApiRouter);
  app.use('/auth', oauthGoogleAuthRouter);
  return app;
}

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

beforeEach(() => {
  saveTokensMock.mockClear();
  getValidAccessTokenMock.mockClear();
  revokeTokensMock.mockClear();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  // Seed a titanio+ plan for the uids that exercise the (now tier-gated) Drive
  // auth-URL route, so the existing CSRF/flow tests reach the handler.
  HADMIN.db = createFakeFirestore();
  HADMIN.db._seed('users/uid-C', { subscription: { planId: 'titanio' } });
  HADMIN.db._seed('users/uid-titanio', { subscription: { planId: 'titanio' } });
  HADMIN.db._seed('users/uid-free', { subscription: { planId: 'free' } });
  vi.resetModules();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_CLIENT_ID;
  if (ORIGINAL_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
});

// Each test uses plain `request(app)` (ephemeral server, closed by supertest)
// rather than `request.agent(app)`. Session continuity here is keyed by the
// `x-test-session` HEADER (see makeSessionMiddleware), NOT cookies, so a
// persistent agent is unnecessary — and `request.agent` left an unclosed HTTP
// server socket after each test: an open handle that intermittently kept the
// vitest worker from exiting (root cause of the flaky CI "Tests" hang).
describe('Google OAuth callback security (oauthGoogle.ts)', () => {
  it('rejects /auth/google/callback when state is missing (CSRF guard)', async () => {
    const app = await buildApp();
    const agent = request(app);
    // First mint a state so the session has `oauthState` set, then call the
    // callback WITHOUT the state parameter.
    await agent
      .get('/api/auth/google/url')
      .set('x-test-session', 'sess-A')
      .set('Authorization', 'Bearer test:uid-A');
    const res = await agent
      .get('/auth/google/callback')
      .set('x-test-session', 'sess-A')
      .query({ code: 'any-code' });
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Invalid state/i);
    expect(saveTokensMock).not.toHaveBeenCalled();
  });

  it('rejects /auth/google/callback when state is tampered (does not match session)', async () => {
    const app = await buildApp();
    const agent = request(app);
    await agent
      .get('/api/auth/google/url')
      .set('x-test-session', 'sess-B')
      .set('Authorization', 'Bearer test:uid-B');
    const res = await agent
      .get('/auth/google/callback')
      .set('x-test-session', 'sess-B')
      .query({ code: 'any-code', state: 'tampered-state-value' });
    expect(res.status).toBe(403);
    expect(saveTokensMock).not.toHaveBeenCalled();
  });

  it('cross-router CSRF: state minted by /api/drive/auth/url cannot be redeemed at /auth/google/callback', async () => {
    const app = await buildApp();
    const agent = request(app);
    // Mint a Drive state — populates session.driveOauthState (NOT oauthState).
    const driveUrlRes = await agent
      .get('/api/drive/auth/url')
      .set('x-test-session', 'sess-C')
      .set('Authorization', 'Bearer test:uid-C');
    expect(driveUrlRes.status).toBe(200);
    const driveAuthUrl = new URL(driveUrlRes.body.url);
    const driveState = driveAuthUrl.searchParams.get('state');
    expect(driveState).toBeTruthy();

    // Attempt to redeem the Drive state at the Calendar/Fit callback, which
    // looks up `session.oauthState` — it is undefined, so the comparison
    // must fail with 403 even though `state` IS the genuine session-bound
    // CSRF value for the *other* router.
    const res = await agent
      .get('/auth/google/callback')
      .set('x-test-session', 'sess-C')
      .query({ code: 'any-code', state: driveState! });
    expect(res.status).toBe(403);
    expect(saveTokensMock).not.toHaveBeenCalled();
  });

  it('tier gate (#11): a below-titanio caller cannot initiate the Drive OAuth grant', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/drive/auth/url')
      .set('x-test-session', 'sess-free')
      .set('Authorization', 'Bearer test:uid-free'); // free plan
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('upgrade_required');
    expect(res.body.requiredPlan).toBe('titanio');
  });

  it('tier gate (#11): a titanio caller CAN initiate the Drive OAuth grant', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/drive/auth/url')
      .set('x-test-session', 'sess-tit')
      .set('Authorization', 'Bearer test:uid-titanio');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('accounts.google.com');
  });

  it('happy path: valid state + valid code â†’ token exchange runs and tokens are saved', async () => {
    const app = await buildApp();
    const agent = request(app);
    // Mock fetch so the token-exchange call returns a usable token bundle.
    global.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toBe('https://oauth2.googleapis.com/token');
      return new Response(
        JSON.stringify({
          access_token: 'ya29.test-access',
          refresh_token: '1//test-refresh',
          expires_in: 3599,
          scope: 'https://www.googleapis.com/auth/calendar.events',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as any;

    const urlRes = await agent
      .get('/api/auth/google/url')
      .set('x-test-session', 'sess-D')
      .set('Authorization', 'Bearer test:uid-D');
    expect(urlRes.status).toBe(200);
    const state = new URL(urlRes.body.url).searchParams.get('state');
    expect(state).toBeTruthy();

    const cb = await agent
      .get('/auth/google/callback')
      .set('x-test-session', 'sess-D')
      .query({ code: 'real-auth-code', state: state! });
    expect(cb.status).toBe(200);
    expect(cb.text).toMatch(/GOOGLE_AUTH_SUCCESS/);
    expect(saveTokensMock).toHaveBeenCalledTimes(1);
    const callArgs = saveTokensMock.mock.calls[0] as unknown as [unknown, unknown];
    expect(callArgs[0]).toEqual({ uid: 'uid-D', provider: 'google' });
    expect((callArgs[1] as any).access_token).toBe('ya29.test-access');
  });

  it('missing access_token in token-exchange response â†’ 500, tokens not saved (error propagated)', async () => {
    const app = await buildApp();
    const agent = request(app);
    // Token-exchange returns an error payload (e.g. invalid_grant, or a
    // payload with no access_token). The handler should NOT persist
    // anything and must surface 500.
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Bad code' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }) as any;

    const urlRes = await agent
      .get('/api/auth/google/url')
      .set('x-test-session', 'sess-E')
      .set('Authorization', 'Bearer test:uid-E');
    const state = new URL(urlRes.body.url).searchParams.get('state');

    const cb = await agent
      .get('/auth/google/callback')
      .set('x-test-session', 'sess-E')
      .query({ code: 'rejected-code', state: state! });
    expect(cb.status).toBe(500);
    expect(cb.text).toMatch(/Token exchange failed/i);
    expect(saveTokensMock).not.toHaveBeenCalled();
  });
});
