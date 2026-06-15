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

async function issueChallenge(uid: string) {
  const { challengeId, challenge } = generateWebAuthnChallenge();
  await storeWebAuthnChallenge(uid, challengeId, challenge, buildWebAuthnDb());
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
    const { challengeId, clientDataJSON } = await issueChallenge(UID);
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
});
