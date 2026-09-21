// Real-router supertest for the 2FA gate on POST /api/account/anonymize
// (src/server/routes/account.ts) — the irreversible cascarón soft-delete.
//
// Drives the REAL accountRouter + the REAL verifyWebAuthnAssertion + the REAL
// single-use challenge consume + the REAL credential store. The ONLY mocked
// crypto seam is @simplewebauthn's verifyAuthenticationResponse (mirrors
// dteSignVerify.test.ts — a real assertion needs a hardware authenticator).
// `anonymizeUser` is mocked here (it has its own unit suite) so this file pins
// the ENDPOINT's contract: 2FA gate, export+checksum, audit, service dispatch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const mockVerifyAuthenticationResponse = vi.fn();
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: (opts: unknown) => mockVerifyAuthenticationResponse(opts),
}));

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({ uid, customClaims: {} }),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// anonymizeUser is unit-tested separately — mock it so this file tests ONLY the
// endpoint (2FA gate, export, audit, dispatch). NOT mocking it would re-run the
// real scrub (auth + collectionGroup) against the fake store.
const mockAnonymizeUser = vi.fn();
vi.mock('../../server/services/anonymizeUser.js', () => ({
  anonymizeUser: (...args: unknown[]) => mockAnonymizeUser(...args),
}));

// [Hy3-audit] Disable the per-uid rate limiter (5 verify attempts per
// minute) for the duration of this test. The suite makes 7 verify
// calls in quick succession (3 legacy + 4 new purpose-binding cases);
// without this mock the new tests trip the limiter after the legacy
// happy path consumes its budget and the suite ends with a 429 instead
// of a real assertion. Production keeps the limiter (it's mounted in
// account.ts); this mock only affects the test module graph.
//
// We use vi.importActual to keep every other limiter export (15+ of
// them — refereeLimiter, geminiLimiter, etc., referenced from other
// routes that this file imports transitively) intact. Replacing
// just `webauthnVerifyLimiter` keeps the surface minimal and prevents
// the "No \"refereeLimiter\" export is defined" failure vitest raises
// when a downstream route imports an export the mock forgot.
vi.mock('../../server/middleware/limiters.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../server/middleware/limiters.js',
  );
  const noOp = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    ...actual,
    webauthnVerifyLimiter: noOp,
  };
});

// ── REAL services to seed + the REAL router ─────────────────────────────────
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
} from '../../services/auth/webauthnChallenge.js';
import { registerCredential } from '../../services/auth/webauthnCredentialStore.js';
import { buildWebAuthnDb, buildWebAuthnCredentialsDb } from '../../server/routes/curriculum.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import accountRouter from '../../server/routes/account.js';

const UID = 'user-acc-1';
const CRED_ID = 'credAcc1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/account', accountRouter);
  return app;
}

function auditActions(): string[] {
  const out: string[] = [];
  for (const [key, data] of H.db!._store.entries()) {
    if (key.startsWith('audit_logs/')) out.push(String((data as Record<string, unknown>).action));
  }
  return out;
}

async function issueChallenge(
  uid: string,
  options?: { purpose?: string },
) {
  const { challengeId, challenge } = generateWebAuthnChallenge();
  // [Hy3-audit] Pass through the optional metadata so the test can
  // simulate a clickjacked (wrong-purpose) vs. legitimate (right-
  // purpose) challenge. When `options.purpose` is undefined we omit
  // metadata entirely — this matches the legacy `curriculum.ts`
  // path (see the cross-purpose replay test).
  const storeOptions = options?.purpose
    ? { metadata: { purpose: options.purpose } }
    : {};
  await storeWebAuthnChallenge(uid, challengeId, challenge, buildWebAuthnDb(), storeOptions);
  const challengeB64u = Buffer.from(challenge)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge: challengeB64u, origin: 'http://localhost:5173' }),
    'utf8',
  ).toString('base64');
  return { challengeId, clientDataJSON };
}

function biometricBody(over: { challengeId: string; clientDataJSON: string; credentialId?: string }) {
  const credentialId = over.credentialId ?? CRED_ID;
  return {
    biometric: {
      credentialId,
      rawId: credentialId,
      type: 'public-key' as const,
      clientExtensionResults: {},
      challengeId: over.challengeId,
      clientDataJSON: over.clientDataJSON,
      authenticatorData: Buffer.from('auth').toString('base64'),
      signature: Buffer.from('sig').toString('base64'),
    },
  };
}

describe('POST /api/account/anonymize — 2FA-gated cascarón soft-delete', () => {
  beforeEach(async () => {
    H.db = createFakeFirestore();
    mockVerifyAuthenticationResponse.mockReset();
    mockAnonymizeUser.mockReset();
    mockAnonymizeUser.mockResolvedValue({
      uid: UID,
      anonymizedAt: 1_750_000_000_000,
      fieldsRedacted: ['email', 'displayName'],
      subcollectionsScrubbed: {},
      safetyPostsRedacted: 0,
      applied: true,
    });
    // A user doc to export + a registered credential for the 2FA gate.
    H.db._store.set(`users/${UID}`, { email: 'real@x.com', display_name: 'Real Name' });
    await registerCredential(
      UID,
      { credentialId: CRED_ID, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 5, transports: ['internal'] },
      buildWebAuthnCredentialsDb(),
    );
  });

  it('401 without an auth token', async () => {
    const res = await request(buildApp()).post('/api/account/anonymize').send({});
    expect(res.status).toBe(401);
    expect(mockAnonymizeUser).not.toHaveBeenCalled();
  });

  it('400 when the biometric assertion is missing', async () => {
    const res = await request(buildApp())
      .post('/api/account/anonymize')
      .set('x-test-uid', UID)
      .send({});
    expect(res.status).toBe(400);
    expect(mockAnonymizeUser).not.toHaveBeenCalled();
  });

  it('401 + audit + NO scrub when the WebAuthn assertion is invalid', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    });
    const { challengeId, clientDataJSON } = await issueChallenge(UID);
    const res = await request(buildApp())
      .post('/api/account/anonymize')
      .set('x-test-uid', UID)
      .send(biometricBody({ challengeId, clientDataJSON }));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('webauthn_verification_failed');
    expect(mockAnonymizeUser).not.toHaveBeenCalled(); // the irreversible scrub never ran
    expect(auditActions()).toContain('account.anonymize_2fa_failed');
    expect(auditActions()).not.toContain('account.anonymization_completed');
  });

  it('200 happy path — exports + audits intent/completion + dispatches the scrub', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    // [Hy3-audit] The legacy happy path now requires a
    // purpose-bound challenge. Without this metadata, the
    // purpose validator rejects the challenge before the
    // destructive path runs.
    const { challengeId, clientDataJSON } = await issueChallenge(UID, {
      purpose: 'account_anonymize',
    });
    const res = await request(buildApp())
      .post('/api/account/anonymize')
      .set('x-test-uid', UID)
      .send(biometricBody({ challengeId, clientDataJSON }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Export proof + downloadable data (Ley 21.719 portability).
    expect(res.body.dataExportChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.dataExport).toContain('real@x.com');
    // Checksum is the SHA-256 of the returned canonical export.
    const recomputed = crypto.createHash('sha256').update(res.body.dataExport, 'utf8').digest('hex');
    expect(recomputed).toBe(res.body.dataExportChecksum);
    // The scrub was dispatched with the token uid + the export checksum.
    expect(mockAnonymizeUser).toHaveBeenCalledTimes(1);
    const [, input] = mockAnonymizeUser.mock.calls[0] as [unknown, { uid: string; dataExportChecksum: string }];
    expect(input.uid).toBe(UID);
    expect(input.dataExportChecksum).toBe(res.body.dataExportChecksum);
    // Intent audited BEFORE + completion AFTER.
    expect(auditActions()).toContain('account.anonymization_initiated');
    expect(auditActions()).toContain('account.anonymization_completed');
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] Account anonymization —
  // exporta y conserva credenciales en users/{uid}. The legacy
  // export inlined the entire users/{uid} document, including
  // bearer credentials (FCM push tokens, billing purchase tokens,
  // API keys). The downloaded archive would carry every credential
  // to the user's machine, defeating any post-scrub redaction. The
  // fix pipes the raw user doc through a recursive redactor that
  // strips every credential-shaped field at any depth.
  describe('POST /api/account/anonymize — export redactor strips credential-shaped fields', () => {
    it('the response body (dataExport) does NOT contain fcmToken / purchaseToken / apiKey', async () => {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });
      // Seed the user doc via the same in-memory store the legacy
      // happy path uses.
      H.db!._store.set(`users/${UID}`, {
        email: 'real@x.com',
        display_name: 'Real Name',
        fcmToken: 'fcm-secret-DELETEME-on-export',
        fcmTokens: ['legacy-array-DELETEME'],
        notificationPreferences: { push: true },
        subscription: {
          plan: 'pro',
          purchaseToken: 'iap-purchase-DELETEME',
          subscriptionId: 'sub_123',
          iap: {
            appleReceipt: 'receipt-data-DELETEME',
          },
        },
        apiKey: 'sk-DELETEME',
        deeplyNested: {
          integrations: {
            slack: {
              apiKey: 'xoxb-DELETEME',
              botToken: 'bot-DELETEME',
            },
          },
        },
      });

      const { challengeId, clientDataJSON } = await issueChallenge(UID, {
        purpose: 'account_anonymize',
      });
      const res = await request(buildApp())
        .post('/api/account/anonymize')
        .set('x-test-uid', UID)
        .send(biometricBody({ challengeId, clientDataJSON }));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const exportText: string = res.body.dataExport;
      expect(exportText, 'export must not contain fcmToken').not.toContain('fcm-secret-DELETEME-on-export');
      expect(exportText, 'export must not contain legacy fcmTokens array').not.toContain('legacy-array-DELETEME');
      expect(exportText, 'export must not contain iap purchaseToken').not.toContain('iap-purchase-DELETEME');
      expect(exportText, 'export must not contain Apple receipt').not.toContain('receipt-data-DELETEME');
      expect(exportText, 'export must not contain apiKey').not.toContain('sk-DELETEME');
      expect(exportText, 'export must not contain slack apiKey').not.toContain('xoxb-DELETEME');
      expect(exportText, 'export must not contain deeply nested botToken').not.toContain('bot-DELETEME');

      // Non-credential fields DO appear in the export.
      expect(exportText, 'export must include email').toContain('real@x.com');
      expect(exportText, 'export must include display_name').toContain('Real Name');
      expect(exportText, 'export must include subscription.plan').toContain('pro');
    });
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] WebAuthn generic challenge —
  // no se liga a propósito/acción de alto impacto. The legacy code
  // stored challenges without metadata and the /anonymize route
  // accepted ANY challenge that the caller could satisfy the
  // cryptographic signature on. That allowed a clickjacking attack:
  // an attacker could trick the user into approving a benign
  // challenge (e.g. one issued for a future login), then replay the
  // signed assertion against /anonymize and the route would happily
  // authorise the irreversible deletion. After the fix, every
  // challenge issued for /anonymize MUST carry the metadata
  // `{purpose: 'account_anonymize'}`; the route installs a
  // fail-closed validator that rejects anything else.
  describe('POST /api/account/anonymize — purpose-bound challenge (resolves [Audit-2026-08-31])', () => {
    it('401 + audit when the challenge carries a different purpose (cross-purpose replay)', async () => {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });
      // Issue a challenge tagged for a different purpose — e.g. a
      // future login. The /anonymize route must NOT accept it.
      const wrong = await issueChallenge(UID, { purpose: 'webauthn_login' });
      const res = await request(buildApp())
        .post('/api/account/anonymize')
        .set('x-test-uid', UID)
        .send(biometricBody({ challengeId: wrong.challengeId, clientDataJSON: wrong.clientDataJSON }));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('webauthn_verification_failed');
      // The destructive path is NOT triggered.
      expect(mockAnonymizeUser).not.toHaveBeenCalled();
    });

    it('401 when the challenge has NO metadata at all (legacy un-tagged challenge)', async () => {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });
      // `issueChallenge` defaults to omitting metadata. A
      // clickjacked attack would replay a challenge the user
      // approved for the future biometric login — same code path,
      // no metadata, gets rejected.
      const legacy = await issueChallenge(UID);
      const res = await request(buildApp())
        .post('/api/account/anonymize')
        .set('x-test-uid', UID)
        .send(biometricBody({ challengeId: legacy.challengeId, clientDataJSON: legacy.clientDataJSON }));
      expect(res.status).toBe(401);
      expect(mockAnonymizeUser).not.toHaveBeenCalled();
    });

    it('200 when the challenge carries purpose: account_anonymize (happy path with binding)', async () => {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });
      const correct = await issueChallenge(UID, { purpose: 'account_anonymize' });
      const res = await request(buildApp())
        .post('/api/account/anonymize')
        .set('x-test-uid', UID)
        .send(biometricBody({ challengeId: correct.challengeId, clientDataJSON: correct.clientDataJSON }));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAnonymizeUser).toHaveBeenCalledTimes(1);
    });
  });
});
