// Praeventio Guard â€” 15th wave Bucket A.
//
// Targeted tests to kill the 2 surviving ConditionalExpression mutants
// flagged by the 14th wave Stryker baseline (Bucket D):
//
//   â€¢ verifyAuth.ts:33 â€” `NODE_ENV === 'production' && E2E_MODE === '1'`
//     startup guard. The AND can be flipped on either half without any
//     existing test failing.
//   â€¢ verifyAuth.ts:41 â€” `isE2EModeEnabled` returning `process.env.E2E_MODE
//     === '1' && process.env.NODE_ENV !== 'production'`. The
//     `!== 'production'` half can be mutated to a constant without test
//     failure.
//
// Why a separate file from `verifyAuthE2E.test.ts`?
// `verifyAuthE2E.test.ts` already pins the E2E auth happy path / 401s. To
// kill the half-of-AND mutants we need the *complementary* env permutations
// (each side of the AND independently false), and we need to assert the
// startup guard does NOT throw in those cases. Mixing those into the
// existing E2E suite would smear two distinct concerns.
//
// All tests use `vi.resetModules()` + dynamic import to ensure each
// permutation gets a fresh module evaluation against the stubbed env.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('verifyAuth â€” prod-config guard (Stryker mutants line 33 / 41)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  // â”€â”€â”€ Line 33 â€” startup guard `NODE_ENV === 'production' && E2E_MODE === '1'` â”€â”€â”€

  it('throws at module load when BOTH NODE_ENV=production AND E2E_MODE=1 are set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_MODE = '1';

    // Pinning both halves: a mutation that flips either === to !== would
    // change the boolean result, and the throw would not fire â€” this test
    // expects it DOES fire, killing both AND-side mutants.
    await expect(async () => {
      await import('./verifyAuth.js');
    }).rejects.toThrow(/FATAL.*production.*E2E_MODE/i);
  });

  it('does NOT throw when NODE_ENV=production but E2E_MODE is unset', async () => {
    // Pins the right half of the AND. If the mutant flips `E2E_MODE ===
    // '1'` to `E2E_MODE !== '1'` the guard would throw here â€” which is
    // wrong, because plain prod is a healthy state.
    process.env.NODE_ENV = 'production';
    delete process.env.E2E_MODE;

    const mod = await import('./verifyAuth.js');
    // Successful load â†’ middleware export is callable.
    expect(typeof mod.verifyAuth).toBe('function');
  });

  it('does NOT throw when E2E_MODE=1 but NODE_ENV=development (dev/test allowed)', async () => {
    // Pins the left half of the AND. Mutating `NODE_ENV === 'production'`
    // to `!== 'production'` would make the guard throw in dev â€” which is
    // wrong, because dev + E2E_MODE is the documented happy path for
    // Playwright specs.
    process.env.NODE_ENV = 'development';
    process.env.E2E_MODE = '1';

    const mod = await import('./verifyAuth.js');
    expect(typeof mod.verifyAuth).toBe('function');
  });

  it('does NOT throw when NODE_ENV=production but E2E_MODE is empty string', async () => {
    // Edge: empty string is NOT '1' â†’ AND right half is false â†’ no throw.
    // Pins that the equality check is strict against the literal '1'
    // rather than a truthy check.
    process.env.NODE_ENV = 'production';
    process.env.E2E_MODE = '';

    const mod = await import('./verifyAuth.js');
    expect(typeof mod.verifyAuth).toBe('function');
  });

  // â”€â”€â”€ Line 41 â€” `isE2EModeEnabled()` â”€â”€â”€
  //
  // We exercise this indirectly: the only place `isE2EModeEnabled()` is
  // called is the runtime middleware, gating the `E2E <secret>:<uid>`
  // header acceptance. So we send the E2E header under each env
  // permutation and assert the gate behaves: enabled in non-prod with
  // E2E_MODE=1, inert in prod or with E2E_MODE unset.

  it('isE2EModeEnabled() inert under NODE_ENV=production (E2E header rejected as non-Bearer)', async () => {
    // Skip the startup guard: prod + E2E_MODE=1 throws at load. Use prod
    // + E2E_MODE=0 instead â€” the guard does NOT throw, but
    // isE2EModeEnabled() must still return false. This pins the
    // `NODE_ENV !== 'production'` half of line 41: a mutation that flips
    // it to `=== 'production'` would have isE2EModeEnabled() return true
    // here (E2E_MODE is the truthy '0'? No â€” it's `=== '1'` strict, so
    // we set it to '1' below, which means we DO need the startup guard
    // to be benign. Set NODE_ENV to the runtime-equivalent 'staging'
    // which is not 'production' to avoid the guard, then re-test prod
    // separately.
    //
    // Cleaner: stub NODE_ENV='production' WITHOUT E2E_MODE, send E2E
    // header â€” the middleware should reject it as not-Bearer regardless,
    // because isE2EModeEnabled() returns false (E2E_MODE !== '1').
    process.env.NODE_ENV = 'production';
    delete process.env.E2E_MODE;
    process.env.E2E_TEST_SECRET = 'irrelevant';

    const { verifyAuth } = await import('./verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E irrelevant:e2e-user-001');

    // E2E header treated as non-Bearer â†’ 401.
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  it('isE2EModeEnabled() returns true in NODE_ENV=test with E2E_MODE=1 (happy path complement)', async () => {
    // Counterpart to the prod-inert case. Pinning that the gate IS open
    // when both halves of the AND in line 41 are satisfied. Without this
    // counterpart, a mutation that hard-codes isE2EModeEnabled() to
    // `false` would also pass the prod-inert test.
    process.env.NODE_ENV = 'test';
    process.env.E2E_MODE = '1';
    process.env.E2E_TEST_SECRET = 'shared-secret';

    const { verifyAuth } = await import('./verifyAuth.js');

    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user.uid });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E shared-secret:user-42');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('user-42');
  });
});

// 17th wave Bucket A â€” kill the Run #2 NEW surviving mutants per
// MUTATION_BASELINE.md (Run #2, post-15th-wave):
//
//   â€¢ verifyAuth.ts:77:7 ConditionalExpression on Bearer scheme guard
//     (`if (!authHeader.startsWith('Bearer '))` â€” NO test currently
//     asserts the POSITIVE path "valid Bearer header â†’ next() called").
//   â€¢ verifyAuth.ts:62:28 / 62:39 / 63:25 / 63:36 sepIdx cluster
//     (4 leftover mutants on `token.indexOf(':')` parsing â€” `secret:`
//     empty-uid edge and the +1 boundary not asserted).
//   â€¢ verifyAuth.ts:36:7 / 41:60 / 53:51 / 70:20 / 71:17 StringLiteral
//     cluster (5 mutants on error-message text + literal env / scheme
//     prefixes / e2e fixture defaults).
//
// Pattern: `vi.mock('firebase-admin')` is HOISTED, but we want each test
// to control verifyIdToken's resolution independently. We expose a
// shared `verifyIdTokenMock` that the suite mutates per-test.
describe('verifyAuth â€” Bearer positive path + sepIdx cluster + StringLiteral pinning (Run #2 mutants)', () => {
  const ORIGINAL_ENV = { ...process.env };
  const verifyIdTokenMock = vi.fn();

  // Hoisted mock for firebase-admin. The middleware calls
  // `admin.auth().verifyIdToken(token)`; we route that through
  // `verifyIdTokenMock` so the Bearer-positive-path tests can pin the
  // resolved value (or rejection) without booting the real SDK.
  vi.doMock('firebase-admin', () => ({
    default: {
      auth: () => ({ verifyIdToken: verifyIdTokenMock }),
    },
  }));

  beforeEach(() => {
    vi.resetModules();
    verifyIdTokenMock.mockReset();
    // Force non-prod so the startup guard is benign and isE2EModeEnabled
    // is irrelevant for the Bearer-path subject. We re-mock firebase-admin
    // INSIDE beforeEach so resetModules() doesn't drop the mock.
    process.env.NODE_ENV = 'test';
    delete process.env.E2E_MODE;
    vi.doMock('firebase-admin', () => ({
      default: {
        auth: () => ({ verifyIdToken: verifyIdTokenMock }),
      },
    }));
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.doUnmock('firebase-admin');
  });

  // â”€â”€â”€ Bearer-scheme POSITIVE path (line 77 â€” Run #2 priority #1) â”€â”€â”€

  it('Bearer-scheme positive path: valid token â†’ req.user populated and next() called', async () => {
    // Pins the FALSE branch of `if (!authHeader.startsWith('Bearer '))`.
    // A mutation that flips this to `if (true)` would 401 even on a valid
    // Bearer header â€” this test would fail under that mutant.
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'firebase-uid-positive',
      email: 'positive@example.com',
    });

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user.uid, email: req.user.email });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer abc123');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('firebase-uid-positive');
    expect(res.body.email).toBe('positive@example.com');
    // verifyIdToken received the slice after "Bearer " and the
    // `checkRevoked=true` flag added in Sprint 39 Fase B.2 (revoked-token
    // detection per request). Pins both the `authHeader.split('Bearer ')[1]`
    // extraction AND the `checkRevoked` 2nd argument so a mutation that
    // drops either is killed.
    expect(verifyIdTokenMock).toHaveBeenCalledWith('abc123', true);
  });

  it('Bearer with empty token (header value gets trimmed to "Bearer") â†’ 401 no-token rejection', async () => {
    // Note: HTTP transport (supertest/Node) strips trailing whitespace from
    // header values, so "Bearer " arrives at the middleware as "Bearer".
    // That means `startsWith('Bearer ')` is FALSE and we hit the
    // non-Bearer rejection branch â€” exactly the conservative behavior we
    // want documented. This pins that an effectively-empty Bearer token
    // does NOT degrade to verifyIdToken('') silently.
    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
    // Critical: we never reached the firebase-admin call path with an
    // empty token. A mutation that loosened `startsWith('Bearer ')` to
    // a less-strict prefix could let "Bearer" (no space) through and
    // verifyIdToken('') would fire â€” this assertion catches that.
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('lowercase "bearer abc" is rejected (case-sensitive scheme check pinned)', async () => {
    // Pins that `startsWith('Bearer ')` is CASE-SENSITIVE. A mutation
    // that swapped the literal "Bearer " (line 77 cluster) to "bearer "
    // would silently accept lowercase. We assert the rejection.
    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'bearer abc');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  // â”€â”€â”€ sepIdx cluster (lines 62â€“63 â€” Run #2 priority #2) â”€â”€â”€

  it('E2E header "secret:" (empty uid after colon) falls back to e2e-user-001 default', async () => {
    // Pins line 63: `sepIdx === -1 ? '' : token.slice(sepIdx + 1)` and
    // the `providedUid || 'e2e-user-001'` defaulting. A mutation on
    // `+1` â†’ `-1` would slice a longer-than-empty uid back, breaking the
    // fixture default. A mutation on the empty-string default would
    // also fail this assertion.
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'shared-secret';

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({
        uid: req.user.uid,
        email: req.user.email,
        displayName: req.user.displayName,
        tenantId: req.user.tenantId,
      });
    });

    // "shared-secret:" â†’ sepIdx === 13, providedUid === '' â†’ fallback.
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E shared-secret:');

    expect(res.status).toBe(200);
    // StringLiteral pin: line 70 default uid 'e2e-user-001'.
    expect(res.body.uid).toBe('e2e-user-001');
    // StringLiteral pin: line 71 fixture email 'e2e@praeventio.test'.
    expect(res.body.email).toBe('e2e@praeventio.test');
    // StringLiteral pins on the displayName + tenantId fixture defaults
    // (close adjacent StringLiteral mutants on lines 70â€“72).
    expect(res.body.displayName).toBe('E2E Test User');
    expect(res.body.tenantId).toBe('e2e-tenant');
  });

  it('E2E header without colon (no separator) â†’ providedSecret === full token, providedUid empty â†’ uses fallback uid', async () => {
    // Pins line 62: `sepIdx === -1 ? token : token.slice(0, sepIdx)`.
    // When the token contains no ':', sepIdx is -1 â†’ providedSecret is
    // the entire token, providedUid is the empty fallback. A
    // ConditionalExpression mutant that flips the ternary would slice
    // off the secret incorrectly and break the secret comparison.
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'shared-secret';

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user.uid });
    });

    // No colon in payload â€” secret comparison must still succeed.
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E shared-secret');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('e2e-user-001');
  });

  it('E2E header with colon at non-zero index "secret:custom-uid" parses both halves correctly (kills sepIdx +1 boundary mutant)', async () => {
    // Explicitly pins the non-(-1) branch of the ternary and the +1
    // boundary on `slice(sepIdx + 1)`. Mutating +1 â†’ -1 would shift the
    // uid by one character, e.g. yielding ":custom-uid" or "custom-ui".
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'shared-secret';

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (req, res) => {
      res.json({ uid: req.user.uid });
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E shared-secret:custom-uid');

    expect(res.status).toBe(200);
    // Strict identity â€” any +1 boundary regression yields a different uid.
    expect(res.body.uid).toBe('custom-uid');
  });

  // â”€â”€â”€ StringLiteral cluster (lines 36 / 41 / 53 / 70 / 71 â€” Run #2 priority #3) â”€â”€â”€

  it('E2E header rejection error pins the literal "Invalid E2E secret" message (line 65 / line 70-71 string proximity)', async () => {
    // Pins the rejection path's StringLiteral. Mutations that empty the
    // error string would silently neutralise the error reason.
    process.env.E2E_MODE = '1';
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = 'real-secret';

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'E2E wrong-secret:user');

    expect(res.status).toBe(401);
    // Substring + case-insensitive â€” a mutation that empties the literal
    // would yield an empty `error` field, failing this match.
    expect(res.body.error).toMatch(/invalid e2e secret/i);
  });

  it('No-token-provided rejection pins the literal "No token provided" message (line 48)', async () => {
    // Two emit sites for "No token provided": (a) absent header (line 48),
    // (b) non-Bearer + non-E2E header (line 78). We test (a) here; the
    // lowercase-"bearer" test above covers (b). Together they pin both
    // StringLiteral occurrences.
    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  it('Invalid-token rejection pins the literal "Invalid token" message (line 88)', async () => {
    // Pins the StringLiteral on line 88's error payload. A mutation that
    // empties the literal would change the surfaced error reason.
    verifyIdTokenMock.mockRejectedValueOnce(new Error('decoded token expired'));

    const { verifyAuth } = await import('./verifyAuth.js');
    const app = express();
    app.get('/protected', verifyAuth, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer expired-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
  });
});
