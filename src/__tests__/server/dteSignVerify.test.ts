// F4 — Real-router supertest for the WebAuthn verification gate on
// POST /api/dte/generate (src/server/routes/dte.ts).
//
// ROOT CAUSE (before this fix): the route embedded the client-supplied
// WebAuthn signature into the DTE XML via dteSigner.verifyAndSignDte WITHOUT
// ever cryptographically verifying the assertion. dteSigner only does a
// non-empty-string check (its own header says "the route MUST call
// verifyAuthenticationResponse FIRST"). So any admin could mint a
// "biometrically signed" DTE with signature = base64('anything').
//
// This suite drives the REAL pipeline end-to-end:
//   • the REAL dteRouter handler,
//   • the REAL verifyWebAuthnAssertion (src/server/auth/webauthnAssertion.ts),
//   • the REAL single-use challenge consume (services/auth/webauthnChallenge),
//   • the REAL credential store (services/auth/webauthnCredentialStore),
//   • the REAL dteSigner (its hash-binding + embed path runs on the verified
//     branch — it is NOT mocked).
//
// The ONLY mocked seam is @simplewebauthn/server's verifyAuthenticationResponse
// — the exact crypto boundary the repo already mocks in webauthnVerify.test.ts
// (a real assertion needs a hardware authenticator). dteGenerator and
// dtePdfRenderer are mocked because they are heavy XML/PDF and not under test.
//
// RED proof: against the pre-fix dte.ts the "invalid assertion → 401" case
// returns 200, because verifyAndSignDte accepted any non-empty signature.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── ONLY mocked seam: the @simplewebauthn crypto primitive ──────────────────
const mockVerifyAuthenticationResponse = vi.fn();
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: (opts: unknown) => mockVerifyAuthenticationResponse(opts),
}));

// ── firebase-admin → in-memory fake (same helper as dte.test.ts) ────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({
      uid,
      customClaims: uid === 'admin-1' ? { role: 'admin' } : {},
    }),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

// ── verifyAuth shim — reads x-test-uid (same as dte.test.ts) ────────────────
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
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_q: Request, _s: Response, n: NextFunction) => n(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../services/observability/tracing.js', () => ({
  tracedAsync: async (_n: string, _a: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../../services/sii/bsaleAdapter.js', () => ({
  BsaleAdapter: { fromEnv: () => null },
}));

// Generator + PDF are heavy and not under test → mock. Signer is REAL.
// FAKE_DTE.hash MUST be the actual sha256 of FAKE_DTE.xml — the REAL
// dteSigner.verifyAndSignDte recomputes + binds it and throws
// 'dte_hash_mismatch' on a static fake hash. The xml MUST contain </DTE> so
// embedSignatureBlock can splice the <Signature> block.
const FAKE_XML = '<DTE><Encabezado/>...</DTE>';
const FAKE_DTE = {
  xml: FAKE_XML,
  hash: crypto.createHash('sha256').update(FAKE_XML, 'utf8').digest('hex'),
  dteId: '33-1001-76123456-7',
  summary: {
    type: 33,
    folio: 1001,
    emisorRut: '76.000.000-1',
    receptorRut: '76.123.456-7',
    fecha: '2026-05-31',
    netAmount: 100000,
    iva: 19000,
    total: 119000,
    itemCount: 1,
  },
};
vi.mock('../../services/sii/dteGenerator.js', () => ({
  generateDte: vi.fn(async () => FAKE_DTE),
}));
vi.mock('../../services/sii/dtePdfRenderer.js', () => ({
  renderDtePdf: vi.fn(async () => Buffer.from('pdf')),
}));
// NOTE: dteSigner is NOT mocked — its embed path runs for real on the
// verified branch, re-checking hash + ownership against the real fake store.
// curriculum + auditLog + webauthnAssertion are NOT mocked — fully real.

// ── REAL services used to SEED the fake store + the REAL router ─────────────
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
} from '../../services/auth/webauthnChallenge.js';
import { registerCredential } from '../../services/auth/webauthnCredentialStore.js';
import { buildWebAuthnDb, buildWebAuthnCredentialsDb } from '../../server/routes/curriculum.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import dteRouter from '../../server/routes/dte.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dte', dteRouter);
  return app;
}

// credentialId must be unpadded base64url (registerCredential enforces this).
const CRED_ID = 'credDTE1';
const ADMIN = 'admin-1';
const BASE_BODY = {
  type: 33 as const,
  receptorRut: '76.123.456-7',
  receptorRazonSocial: 'Empresa SpA',
  fecha: '2026-05-31',
  folio: 1001,
  items: [{ description: 'Asesoria', quantity: 1, unitPrice: 50000 }],
};

// Read the audit_logs the REAL auditServerEvent wrote into the fake store.
function auditActions(): string[] {
  const out: string[] = [];
  for (const [key, data] of H.db!._store.entries()) {
    if (key.startsWith('audit_logs/')) out.push(String((data as Record<string, unknown>).action));
  }
  return out;
}
function auditRow(action: string): Record<string, unknown> | undefined {
  for (const [key, data] of H.db!._store.entries()) {
    if (key.startsWith('audit_logs/') && (data as Record<string, unknown>).action === action) {
      return data as Record<string, unknown>;
    }
  }
  return undefined;
}

// Issue a REAL challenge + craft the clientDataJSON a browser would build.
async function issueChallenge(uid: string) {
  const { challengeId, challenge } = generateWebAuthnChallenge();
  await storeWebAuthnChallenge(uid, challengeId, challenge, buildWebAuthnDb());
  const challengeB64u = Buffer.from(challenge)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const clientDataJSON = await clientDataJSONFor(challengeB64u);
  return { challengeId, clientDataJSON };
}

// Build a clientDataJSON from a base64url challenge that the route already
// returned (no need to re-issue). Used by tests that go through the REAL
// /sign-challenge endpoint so the binding is recorded server-side.
async function clientDataJSONFor(challengeB64u: string) {
  return Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: challengeB64u,
      origin: 'http://localhost:5173',
    }),
    'utf8',
  ).toString('base64');
}

function assertionBody(over: {
  challengeId: string;
  clientDataJSON: string;
  credentialId?: string;
}) {
  const credentialId = over.credentialId ?? CRED_ID;
  return {
    ...BASE_BODY,
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

describe('POST /api/dte/generate — F4 WebAuthn verification gate', () => {
  beforeEach(async () => {
    H.db = createFakeFirestore();
    mockVerifyAuthenticationResponse.mockReset();
    // Seed a registered credential for the admin via the REAL store.
    await registerCredential(
      ADMIN,
      { credentialId: CRED_ID, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 5, transports: ['internal'] },
      buildWebAuthnCredentialsDb(),
    );
  });

  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/dte/generate').send(BASE_BODY);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not admin', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', 'worker-1')
      .send(BASE_BODY);
    expect(res.status).toBe(403);
  });

  it('200 unsigned path (no biometric) still works — verifier NOT invoked', async () => {
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(BASE_BODY);
    expect(res.status).toBe(200);
    expect(res.body.signedAt).toBeNull();
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('INVALID assertion → 401 dte_sign_failed + audit dte.sign_failed (NOT signed)', async () => {
    // Real verifier runs; the crypto seam reports verified:false → reject.
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    });
    const { challengeId, clientDataJSON } = await issueChallenge(ADMIN);
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(assertionBody({ challengeId, clientDataJSON }));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('dte_sign_failed');
    expect(auditActions()).toContain('dte.sign_failed');
    // Crucially: NO signed DTE was issued.
    expect(auditActions()).not.toContain('dte.signed');
  });

  it('UNKNOWN credential → 401 (verifier short-circuits before the crypto seam)', async () => {
    const { challengeId, clientDataJSON } = await issueChallenge(ADMIN);
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(assertionBody({ challengeId, clientDataJSON, credentialId: 'neverReg' }));
    expect(res.status).toBe(401);
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it('REPLAYED challenge → second submit 401 (single-use consume)', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    // Issue the challenge THROUGH THE REAL ROUTE so the binding is recorded.
    const dteHash = FAKE_DTE.hash;
    const challengeRes = await request(buildApp())
      .get(`/api/dte/sign-challenge?dteHash=${dteHash}`)
      .set('x-test-uid', ADMIN);
    expect(challengeRes.status).toBe(200);
    const challengeId = challengeRes.body.challengeId as string;
    const clientDataJSON = await clientDataJSONFor(challengeRes.body.challenge);
    const body = assertionBody({ challengeId, clientDataJSON });
    const r1 = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(body);
    expect(r1.status).toBe(200);
    const r2 = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(body);
    expect(r2.status).toBe(401); // challenge already consumed
  });

  it('VALID assertion → 200 signedAt + <Signature> embedded + audit dte.signed/generated', async () => {
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    // Issue the challenge THROUGH THE REAL ROUTE so the dteHash binding is
    // recorded. The fix routes every challenge through buildSignChallenge
    // with the supplied dteHash; here we pre-compute the hash and pass it.
    const dteHash = FAKE_DTE.hash;
    const challengeRes = await request(buildApp())
      .get(`/api/dte/sign-challenge?dteHash=${dteHash}`)
      .set('x-test-uid', ADMIN);
    expect(challengeRes.status).toBe(200);
    const challengeId = challengeRes.body.challengeId as string;
    const clientDataJSON = await clientDataJSONFor(challengeRes.body.challenge);
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(assertionBody({ challengeId, clientDataJSON }));

    expect(res.status).toBe(200);
    expect(res.body.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.xml).toContain('<Signature'); // real dteSigner embedded it
    expect(auditActions()).toContain('dte.signed');
    expect(auditActions()).toContain('dte.generated');

    // The crypto seam received the registered pubkey + a bound challenge.
    const call = mockVerifyAuthenticationResponse.mock.calls[0][0];
    expect(call.credential.id).toBe(CRED_ID);
    expect(typeof call.expectedChallenge).toBe('string');
    expect(call.expectedChallenge.length).toBeGreaterThan(0);

    // Audit details carry only the public credentialId, NEVER the assertion bytes.
    const signed = auditRow('dte.signed');
    const dump = JSON.stringify(signed);
    expect(dump).not.toContain('clientDataJSON');
    expect(dump).not.toContain('authenticatorData');
  });

  it('GET /api/dte/sign-challenge → 200 issues a stored challenge (admin); 403 non-admin', async () => {
    // The fix requires a dteHash; the route returns 200 only when the
    // dteHash is bound to the issued challenge.
    const ok = await request(buildApp())
      .get(`/api/dte/sign-challenge?dteHash=${'a'.repeat(64)}`)
      .set('x-test-uid', ADMIN);
    expect(ok.status).toBe(200);
    expect(typeof ok.body.challengeId).toBe('string');
    expect(typeof ok.body.challenge).toBe('string');
    expect(ok.body.dteHash).toBe('a'.repeat(64));

    const denied = await request(buildApp())
      .get('/api/dte/sign-challenge?dteHash=${"a".repeat(64)}')
      .set('x-test-uid', 'worker-1');
    // Non-admin → 403 from requireAdmin BEFORE the dteHash check.
    expect(denied.status).toBe(403);
  });

  // ── Adversarial probe: the WebAuthn challenge MUST bind to the DTE hash ──
  // The current /sign-challenge issues a generic challenge (no dteHash).
  // A malicious admin could call GET /sign-challenge for ANYTHING, then
  // POST /generate with that challengeId while presenting a different
  // DTE hash — the verifier accepts because the challenge is dteHash-blind.
  //
  // This probe pins the contract the fix MUST satisfy:
  //   • GET /sign-challenge must REJECT a request that does not carry a
  //     dteHash query param (the only place the dteHash is known).
  //   • The issued challenge bytes must be derived from that dteHash
  //     (same input → same first-16-byte prefix, since buildSignChallenge
  //     uses SHA-256(salt ‖ dteHash)).
  //   • POST /generate with a challenge issued for dteHash A but
  //     submitting generated.hash = B must 401 with reason
  //     'challenge_dtehash_mismatch' (the binding is server-side).
  it('GET /sign-challenge without dteHash → 400 (proves the dteHash binding exists)', async () => {
    const res = await request(buildApp())
      .get('/api/dte/sign-challenge')
      .set('x-test-uid', ADMIN);
    // Either 400 dteHash_required OR the implementation has been wired
    // through a different mechanism (header, body). Both prove the binding
    // exists at issuance time. The only failing mode is 200 with a generic
    // challenge — which is the current bug and what we are detecting.
    if (res.status === 200) {
      throw new Error(
        `GET /sign-challenge still issues a dteHash-blind challenge (status 200, ` +
          `body=${JSON.stringify(res.body)}). The fix must require a dteHash ` +
          `and derive the challenge bytes from it.`,
      );
    }
    expect(res.status).toBe(400);
  });

  it('POST /generate with mismatched challenge dteHash → 401 challenge_dtehash_mismatch', async () => {
    // Capture the dteHash the REAL generator returns so we can pick a
    // challenge issued for a DIFFERENT hash. The test is meaningless if
    // we hardcode a fake hash that doesn't match FAKE_DTE.hash.
    const FAKE_DTE_HASH = FAKE_DTE.hash;
    const MISMATCH_HASH = 'b'.repeat(64);

    // Issue a challenge against a known-mismatched dteHash.
    // We can't call GET /sign-challenge?dteHash=… yet because the fix
    // doesn't exist; instead we use the underlying primitive directly:
    // generateWebAuthnChallenge gives a generic id, so the route's
    // binding check (when implemented) MUST be the layer that detects
    // the mismatch between issued-hash and presented-hash.
    //
    // For the probe we issue a challenge through the same path the fix
    // will use: the future route will persist (challengeId → dteHash)
    // and the verifier will compare. We register the mapping here.
    const { challengeId, clientDataJSON } = await issueChallenge(ADMIN);
    // Note: this challenge was issued without a dteHash binding. The
    // server-side check (added by the fix) should detect that the
    // challenge has no recorded dteHash and reject the request.
    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    const res = await request(buildApp())
      .post('/api/dte/generate')
      .set('x-test-uid', ADMIN)
      .send(assertionBody({ challengeId, clientDataJSON }));
    // Current behavior: 200 (the bug). Fixed behavior: 401.
    if (res.status === 200) {
      throw new Error(
        `POST /generate accepted a dteHash-blind challenge (status 200, ` +
          `body=${JSON.stringify({ hasSigned: !!res.body.signedAt })}). The fix must ` +
          `reject this with 401 challenge_dtehash_mismatch.`,
      );
    }
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'dte_sign_failed',
      // The verifier returns challenge_context_mismatch when the stored
      // metadata dteHash doesn't match the one the route computed. This
      // is the canonical name from webauthnAssertion.ts:71.
      reason: 'challenge_context_mismatch',
    });
  });
});
