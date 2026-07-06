import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import {
  buildE2EAuthHeader,
  DEFAULT_TEST_USER,
  loginAsTestUser,
  signInBrowserViaCustomToken,
} from './fixtures/auth';

/**
 * Auth/Sesión (Bloque C3) — WebAuthn challenge lifecycle.
 *
 * Proves TWO things no client fixture can fake:
 *
 *  1. `verifyAuth` actually GATES `/api/auth/*`: no token → 401; a wrong E2E
 *     secret → 401 (the secret is really validated, not just the prefix); a
 *     valid header → 200 with the identity stamped SERVER-side.
 *  2. The challenge is REAL and SINGLE-USE: a server-generated 32-byte value
 *     persisted to `webauthn_challenges/{uid}_{challengeId}` with
 *     `consumed:false`, atomically flipped to `consumed:true` on the first
 *     /verify, and a replay of the same challengeId is rejected with
 *     reason 'consumed'. That doc transition is written only by the server's
 *     `consumeWebAuthnChallenge()` — the un-gameable signal.
 *
 * Honest limits (unit-covered, NOT E2E-testable here): real Firebase ID-token
 * verification / revocation / MAX_SESSION_HOURS live on the Bearer path the
 * E2E_MODE branch returns before; and a `verified:true` assertion needs a real
 * authenticator's private key (impossible headless) — covered by
 * webauthnChallenge/webauthnVerify unit suites.
 *
 * No project seed: these endpoints key ONLY on the verified token (req.user),
 * never a projectId. Requires the full stack (`npm run test:e2e:full`).
 */

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_TEST_SECRET ?? 'e2e-test-secret-do-not-use-in-prod';
const CHALLENGE_URL = `${API_BASE}/api/auth/webauthn/challenge`;
const VERIFY_URL = `${API_BASE}/api/auth/webauthn/verify`;

/** Read-only admin handle to the SAME Firestore emulator the server writes. */
function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        'webauthn-challenge.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.',
      );
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('WebAuthn challenge lifecycle (verifyAuth gating + single-use)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test.afterEach(async () => {
    // Keep reruns deterministic: drop any challenges this uid minted.
    const db = emulatorDb();
    const leftovers = await db
      .collection('webauthn_challenges')
      .where('uid', '==', DEFAULT_TEST_USER.uid)
      .get();
    await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
  });

  test('verifyAuth gatea el challenge: 401 sin token, 401 secret inválido, 200 con challenge real persistido', async ({ request }) => {
    // (a) No Authorization header → the middleware must reject.
    const noToken = await request.get(CHALLENGE_URL);
    expect(noToken.status(), 'sin header debe ser 401').toBe(401);

    // (b) E2E scheme but WRONG secret → still 401 (the secret is validated
    // by safeSecretEqual, not merely the "E2E " prefix).
    const badSecret = await request.get(CHALLENGE_URL, {
      headers: { Authorization: `E2E wrong-secret:${DEFAULT_TEST_USER.uid}` },
    });
    expect(badSecret.status(), 'secret inválido debe ser 401').toBe(401);
    expect(String(((await badSecret.json()) as { error?: string }).error)).toMatch(/E2E secret/i);

    // (c) Valid header → a REAL server-generated challenge.
    const ok = await request.get(CHALLENGE_URL, {
      headers: { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) },
    });
    expect(ok.status(), 'header válido debe ser 200').toBe(200);
    const body = (await ok.json()) as { challengeId?: string; challenge?: string; ttlSeconds?: number };
    expect(typeof body.challengeId === 'string' && body.challengeId.length > 0).toBe(true);
    // 32 random bytes — proves the server GENERATED it (an echoed constant or
    // client-supplied value can't satisfy the Firestore cross-check below).
    expect(Buffer.from(String(body.challenge), 'base64').length).toBe(32);
    expect(body.ttlSeconds).toBe(300);

    // ── UN-GAMEABLE: the server persisted the challenge, stamping the uid
    // from the VERIFIED header (never a request body — the GET has none).
    const doc = await emulatorDb()
      .collection('webauthn_challenges')
      .doc(`${DEFAULT_TEST_USER.uid}_${body.challengeId}`)
      .get();
    expect(doc.exists, 'el challenge debe persistirse server-side').toBe(true);
    const data = doc.data() as Record<string, unknown>;
    expect(data.uid).toBe(DEFAULT_TEST_USER.uid);
    expect(data.consumed).toBe(false);
    expect(data.challengeB64).toBe(body.challenge);
  });

  test('el challenge es single-use: consume atómico en el primer verify y replay rechazado', async ({ request }) => {
    const authHeader = { Authorization: buildE2EAuthHeader(E2E_SECRET, DEFAULT_TEST_USER.uid) };

    // Issue a challenge.
    const issued = await request.get(CHALLENGE_URL, { headers: authHeader });
    expect(issued.status()).toBe(200);
    const { challengeId, challenge } = (await issued.json()) as { challengeId: string; challenge: string };

    // Embed the SAME 32 bytes as base64url inside a minimal clientDataJSON —
    // exactly how a browser would — so consumeWebAuthnChallenge's byte-compare
    // passes and the request proceeds to the credential lookup.
    const bytes = Buffer.from(challenge, 'base64');
    const b64u = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: b64u, origin: API_BASE }),
    ).toString('base64');
    const assertionBody = {
      challengeId,
      id: 'e2e-nonexistent-credential',
      rawId: 'ZTJlLW5vbmV4aXN0ZW50',
      clientDataJSON,
      authenticatorData: 'AA==',
      signature: 'AA==',
      type: 'public-key',
      clientExtensionResults: {},
    };

    // First verify: the consume MUST succeed (single-use spent) and the
    // request then fails ONLY because no credential is enrolled. Asserting
    // 'unknown_credential' (not 'mismatch'/'unknown'/'consumed') pins that
    // ordering. (Rate limiter is 5/min/uid — this test sends exactly 2.)
    const first = await request.post(VERIFY_URL, { headers: authHeader, data: assertionBody });
    expect(first.status()).toBe(401);
    expect(((await first.json()) as { reason?: string }).reason).toBe('unknown_credential');

    // ── UN-GAMEABLE: the doc transitioned consumed:false → true, a write only
    // the server's atomic consume performs.
    const doc = await emulatorDb()
      .collection('webauthn_challenges')
      .doc(`${DEFAULT_TEST_USER.uid}_${challengeId}`)
      .get();
    const data = doc.data() as Record<string, unknown>;
    expect(data.consumed).toBe(true);
    expect(typeof data.consumedAt).toBe('number');

    // Replay the exact same assertion → rejected as already consumed.
    const replay = await request.post(VERIFY_URL, { headers: authHeader, data: assertionBody });
    expect(replay.status()).toBe(401);
    expect(((await replay.json()) as { reason?: string }).reason).toBe('consumed');
  });

  test('UI real: Ajustes → Seguridad lista las llaves del uid autenticado (vacío para el user E2E)', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/settings');
    await signInBrowserViaCustomToken(page);

    // Arm the response BEFORE opening the section — the credentials fetch
    // fires when WebAuthnKeysSection mounts.
    const credsResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/auth/webauthn/credentials') && res.request().method() === 'GET',
      { timeout: 20_000 },
    );
    const securitySection = page.getByRole('button', { name: /Seguridad y Privacidad/i });
    await expect(securitySection).toBeVisible({ timeout: 15_000 });
    await securitySection.click();

    const credsResponse = await credsResponsePromise;
    expect(credsResponse.status(), 'credentials list must be accepted for the authed uid').toBe(200);

    // The section rendered from the real (empty) server answer — the server
    // filters by the VERIFIED uid, so the E2E user truthfully has zero keys.
    await expect(page.getByTestId('webauthn-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('webauthn-empty')).toBeVisible({ timeout: 10_000 });
  });
});
