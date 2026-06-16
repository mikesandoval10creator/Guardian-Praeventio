// Real-router supertest for src/server/routes/sitebookSignRoutes.ts
// (Plan 2026-05-24 §D.X — SiteBook WebAuthn signing, DS 76 firma electrónica
// avanzada). Mounts the ACTUAL `sitebookSignRouter` (named export) at
// `/api/sitebook` (the prefix used in server.ts:1242).
//
// Two endpoints, both verifyAuth-gated:
//   POST /api/sitebook/sign/options  — issues a challenge bound to the entry
//   POST /api/sitebook/sign/verify   — verifies the assertion + persists sig
//
// HOW THE SIGNING/CHALLENGE DEPS ARE HANDLED
//   - firebase-admin is faked (adminMock → createFakeFirestore). The route's
//     `buildWebAuthnDb()` / `buildWebAuthnCredentialsDb()` (imported from
//     curriculum.ts) wrap `admin.firestore()`, so they transparently operate
//     on the same in-memory store. The REAL `storeWebAuthnChallenge` runs and
//     writes a `webauthn_challenges/{uid}_{challengeId}` doc — we assert it.
//   - `loadSiteBookEntry` / `saveSignedSiteBookEntry` read/write
//     `projects/{projectId}/site_book_entries/{entryId}` on the fake store —
//     we seed entries with a server-recomputed `payloadHashHex` so the
//     hash-match gate passes.
//   - The cryptographic core, `verifyWebAuthnAssertion` (named import from
//     `../auth/webauthnAssertion.js`), wraps real `@simplewebauthn/server` —
//     impossible to drive to `verified:true` without a real authenticator.
//     We `vi.mock` that single module and inject a controllable fake, exactly
//     mirroring how the sibling unit test (sitebookSign.test.ts) injects the
//     `verifyAssertion` dep. Default = verified:true; per-test overrides let
//     us exercise the STATUS_FOR_REASON mapping (401/403) and the 200 path.
//   - `computeEntryPayloadHashHex` / `deriveSigningChallenge` /
//     `buildSignatureRecord` / `signEntry` / `auditServerEvent` all run for
//     real against the fake store.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  verifyAssertion: null as
    | ((input: unknown) => Promise<{ verified: boolean; reason?: string; newCounter?: number; verifiedCredentialId?: string }>)
    | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The crypto core is injected the way the sibling unit test injects its
// `verifyAssertion` dep. Default succeeds; tests override H.verifyAssertion.
vi.mock('../../server/auth/webauthnAssertion.js', () => ({
  verifyWebAuthnAssertion: (input: unknown) => H.verifyAssertion!(input),
}));

import { sitebookSignRouter } from '../../server/routes/sitebookSignRoutes.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  computeEntryPayloadHashHex,
  deriveSigningChallenge,
} from '../../services/siteBook/siteBookSigning';
import type { SiteBookEntry } from '../../services/siteBook/siteBookService';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sitebook', sitebookSignRouter);
  return app;
}

// ── Shared fixtures ────────────────────────────────────────────────────────

const SIGNER_UID = 'uid-juan';
const PROJECT_ID = 'proj-A';
const ENTRY_ID = 'entry-1';
const CRED_ID = 'cred-1';

function makeEntry(overrides: Partial<SiteBookEntry> = {}): SiteBookEntry {
  return {
    id: ENTRY_ID,
    projectId: PROJECT_ID,
    folio: 'SB-2026-000001',
    year: 2026,
    sequenceNumber: 1,
    kind: 'inspection',
    occurredAt: '2026-05-24T10:00:00.000Z',
    recordedAt: '2026-05-24T11:00:00.000Z',
    recordedByUid: SIGNER_UID,
    recordedByRole: 'supervisor',
    description: 'Inspección de prueba para tests del flow de firma WebAuthn',
    status: 'open',
    ...overrides,
  };
}

const entryPath = (entryId = ENTRY_ID, projectId = PROJECT_ID) =>
  `projects/${projectId}/site_book_entries/${entryId}`;

function seedEntry(entry: SiteBookEntry = makeEntry()) {
  H.db!._seed(entryPath(entry.id, entry.projectId), entry as unknown as Record<string, unknown>);
  return entry;
}

/** Register a WebAuthn credential for a uid so listCredentialIdsForUid finds it. */
function seedCredential(uid = SIGNER_UID, credId = CRED_ID) {
  H.db!._seed(`webauthn_credentials/${credId}`, {
    uid,
    credentialId: credId,
    publicKey: 'fake',
    counter: 0,
    transports: [],
  });
}

/**
 * Seed the project doc so the REAL `assertProjectMember` gate (P0 IDOR fix)
 * passes for the given members. Default = SIGNER_UID is a member. The
 * cross-tenant attack tests use a caller uid that is NOT in this list.
 */
function seedProject(members: string[] = [SIGNER_UID], projectId = PROJECT_ID) {
  H.db!._seed(`projects/${projectId}`, { id: projectId, members });
}

/** A well-formed browser assertion (shape only — crypto is mocked). */
const validAssertion = {
  credentialId: CRED_ID,
  rawId: CRED_ID,
  clientDataJSONB64u: 'AAA',
  authenticatorDataB64u: 'BBB',
  signatureB64u: 'CCC',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Make SIGNER_UID a member of PROJECT_ID so the assertProjectMember gate
  // (P0 IDOR fix) passes for the happy/error paths below; the dedicated
  // cross-tenant tests override the caller uid to a non-member.
  seedProject();
  // Default verifier: success. Per-test overrides reassign before the request.
  H.verifyAssertion = vi.fn(async () => ({
    verified: true,
    newCounter: 5,
    verifiedCredentialId: CRED_ID,
  }));
});

// ── POST /api/sitebook/sign/options ─────────────────────────────────────────

describe('POST /api/sitebook/sign/options', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex: 'a'.repeat(64) });
    expect(res.status).toBe(401);
  });

  it('400 when required body fields are missing/non-string', async () => {
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({ entryId: ENTRY_ID }); // projectId + payloadHashHex missing
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      'entryId, projectId, payloadHashHex required',
    );
  });

  it('403 forbidden when the caller is NOT a member of the project (cross-tenant IDOR)', async () => {
    // Project members = [SIGNER_UID] (from beforeEach). An attacker from
    // another tenant holds a valid credential but is not a project member.
    seedEntry();
    seedCredential('uid-intruder');
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', 'uid-intruder')
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex: 'a'.repeat(64) });
    // The gate must run BEFORE the hash/entry checks: a non-member never
    // learns whether the entry exists or what its hash is.
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('forbidden');
  });

  it('400 invalid_hash_format when payloadHashHex is not 64 hex chars', async () => {
    seedEntry();
    seedCredential();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex: 'not-hex' });
    // 'not-hex' is a string (passes the typeof gate) but fails HASH_REGEX.
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_hash_format');
  });

  it('404 not_found when the entry does not exist', async () => {
    seedCredential();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({ entryId: 'ghost', projectId: PROJECT_ID, payloadHashHex: 'a'.repeat(64) });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('not_found');
  });

  it('409 already_signed when the entry is already signed', async () => {
    const signed = makeEntry({ status: 'signed' });
    seedEntry(signed);
    seedCredential();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        payloadHashHex: computeEntryPayloadHashHex(signed),
      });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('already_signed');
  });

  it('409 hash_mismatch when payloadHashHex disagrees with the stored entry', async () => {
    seedEntry();
    seedCredential();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      // Valid hex shape, but NOT the real entry hash → tamper guard fires.
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex: 'a'.repeat(64) });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('hash_mismatch');
  });

  it('412 no_credentials when the signer has no registered credentials', async () => {
    const entry = seedEntry();
    // No credential seeded for SIGNER_UID.
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({
        entryId: ENTRY_ID,
        projectId: PROJECT_ID,
        payloadHashHex: computeEntryPayloadHashHex(entry),
      });
    expect(res.status).toBe(412);
    expect((res.body as { error: string }).error).toBe('no_credentials');
  });

  it('200 issues a challenge + allowCredentials and persists the challenge doc', async () => {
    const entry = seedEntry();
    seedCredential(SIGNER_UID, 'cred-1');
    seedCredential(SIGNER_UID, 'cred-2');
    seedCredential('uid-other', 'cred-other'); // must NOT appear
    const payloadHashHex = computeEntryPayloadHashHex(entry);

    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex });

    expect(res.status).toBe(200);
    const body = res.body as {
      challengeB64u: string;
      challengeId: string;
      allowCredentials: Array<{ id: string; type: string }>;
      timeoutMs: number;
    };
    expect(typeof body.challengeB64u).toBe('string');
    expect(body.challengeId).toMatch(/^[0-9a-f]{64}$/);
    expect(body.timeoutMs).toBe(60_000);
    const ids = body.allowCredentials.map((c) => c.id).sort();
    expect(ids).toEqual(['cred-1', 'cred-2']);
    expect(body.allowCredentials.every((c) => c.type === 'public-key')).toBe(true);

    // The REAL storeWebAuthnChallenge persisted a challenge doc bound to uid,
    // un-consumed, holding exactly deriveSigningChallenge(payloadHashHex).
    const dump = H.db!._dump();
    const challengeKey = Object.keys(dump).find((k) =>
      k.startsWith(`webauthn_challenges/${SIGNER_UID}_`),
    );
    expect(challengeKey).toBeDefined();
    const persisted = dump[challengeKey!];
    expect(persisted.uid).toBe(SIGNER_UID);
    expect(persisted.consumed).toBe(false);
    const expectedChallenge = deriveSigningChallenge(payloadHashHex);
    const persistedBytes = new Uint8Array(
      Buffer.from(String(persisted.challengeB64), 'base64'),
    );
    expect(persistedBytes).toEqual(expectedChallenge);
  });

  it('500 internal when the entry read throws (fail-closed)', async () => {
    seedEntry();
    seedCredential();
    H.db!._failReads(entryPath()); // force loadSiteBookEntry's get() to reject
    const res = await request(buildApp())
      .post('/api/sitebook/sign/options')
      .set('x-test-uid', SIGNER_UID)
      .send({ entryId: ENTRY_ID, projectId: PROJECT_ID, payloadHashHex: 'a'.repeat(64) });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('internal');
  });
});

// ── POST /api/sitebook/sign/verify ──────────────────────────────────────────

describe('POST /api/sitebook/sign/verify', () => {
  function verifyBody(overrides: Record<string, unknown> = {}) {
    return {
      entryId: ENTRY_ID,
      projectId: PROJECT_ID,
      payloadHashHex: computeEntryPayloadHashHex(makeEntry()),
      challengeId: 'chal-1',
      assertion: { ...validAssertion },
      ...overrides,
    };
  }

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .send(verifyBody());
    expect(res.status).toBe(401);
  });

  it('403 forbidden when the caller is NOT a member of the project (cross-tenant IDOR)', async () => {
    seedEntry();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', 'uid-intruder') // not in PROJECT_ID members
      .send(verifyBody());
    // Gate runs before verify; the attacker cannot apply their signature to
    // another tenant's site-book entry.
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('forbidden');
    // The entry remains unsigned.
    const dump = H.db!._dump();
    const stored = dump[entryPath()] as Record<string, unknown>;
    expect(stored.status).toBe('open');
    // The blocked cross-tenant probe is audited for a forensic trace.
    const idorAudit = Object.entries(dump).find(
      ([k, v]) => k.startsWith('audit_logs/') && (v as Record<string, unknown>).action === 'sitebookSign.idor_blocked',
    )?.[1] as Record<string, unknown> | undefined;
    expect(idorAudit).toBeDefined();
    expect(idorAudit!.userId).toBe('uid-intruder');
    expect((idorAudit!.details as Record<string, unknown>).projectId).toBe(PROJECT_ID);
  });

  it('400 malformed_body when challengeId is missing', async () => {
    const { challengeId: _omit, ...noChallenge } = verifyBody();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(noChallenge);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('malformed_body');
  });

  it('400 malformed_body when assertion is not an object', async () => {
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ assertion: 'nope' }));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('malformed_body');
  });

  it('400 invalid_hash_format when payloadHashHex is not 64 hex chars', async () => {
    seedEntry();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ payloadHashHex: 'deadbeef' }));
    // Passes the body typeof gate (string) but fails HASH_REGEX in the handler.
    expect(res.status).toBe(400);
    expect((res.body as { verified: boolean; reason: string }).reason).toBe(
      'invalid_hash_format',
    );
  });

  it('400 missing_field when the assertion lacks credentialId', async () => {
    seedEntry();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(
        verifyBody({
          assertion: { rawId: CRED_ID, clientDataJSONB64u: 'AAA', authenticatorDataB64u: 'BBB', signatureB64u: 'CCC' },
        }),
      );
    // Handler returns missing_field → STATUS_FOR_REASON = 400.
    expect(res.status).toBe(400);
    expect((res.body as { verified: boolean; reason: string }).reason).toBe('missing_field');
  });

  it('404 not_found when the entry does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ entryId: 'ghost' }));
    expect(res.status).toBe(404);
    expect((res.body as { verified: boolean; reason: string }).reason).toBe('not_found');
  });

  it('409 already_signed when the entry is already signed', async () => {
    const signed = makeEntry({ status: 'signed' });
    seedEntry(signed);
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ payloadHashHex: computeEntryPayloadHashHex(signed) }));
    expect(res.status).toBe(409);
    expect((res.body as { verified: boolean; reason: string }).reason).toBe('already_signed');
  });

  it('409 hash_mismatch when payloadHashHex disagrees with the stored entry', async () => {
    seedEntry();
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ payloadHashHex: 'a'.repeat(64) }));
    expect(res.status).toBe(409);
    expect((res.body as { verified: boolean; reason: string }).reason).toBe('hash_mismatch');
    // Nothing was signed.
    const stored = H.db!._dump()[entryPath()] as Record<string, unknown>;
    expect(stored.status).toBe('open');
  });

  it('401 signature_invalid when the assertion verifier rejects the signature', async () => {
    seedEntry();
    H.verifyAssertion = vi.fn(async () => ({ verified: false, reason: 'signature_invalid' }));
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody());
    expect(res.status).toBe(401);
    expect((res.body as { verified: boolean; reason: string }).verified).toBe(false);
    expect((res.body as { reason: string }).reason).toBe('signature_invalid');
  });

  it('403 credential_owned_by_other_uid maps the verifier reason to forbidden', async () => {
    seedEntry();
    H.verifyAssertion = vi.fn(async () => ({
      verified: false,
      reason: 'credential_owned_by_other_uid',
    }));
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody());
    expect(res.status).toBe(403);
    expect((res.body as { reason: string }).reason).toBe('credential_owned_by_other_uid');
  });

  it('401 challenge_expired maps the verifier reason to unauthorized', async () => {
    seedEntry();
    H.verifyAssertion = vi.fn(async () => ({ verified: false, reason: 'challenge_expired' }));
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody());
    expect(res.status).toBe(401);
    expect((res.body as { reason: string }).reason).toBe('challenge_expired');
  });

  it('200 verifies, persists the signed entry, and writes an audit_logs row', async () => {
    const entry = seedEntry();
    const payloadHashHex = computeEntryPayloadHashHex(entry);

    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody({ payloadHashHex }));

    expect(res.status).toBe(200);
    const body = res.body as { entry: SiteBookEntry };
    expect(body.entry.status).toBe('signed');
    expect(body.entry.signature?.signerUid).toBe(SIGNER_UID);
    expect(body.entry.signature?.algorithm).toBe('webauthn-ecdsa-p256');
    expect(body.entry.signature?.payloadHashHex).toBe(payloadHashHex);
    expect(body.entry.signature?.credentialId).toBe(CRED_ID);

    // verifier was called once with the signer uid + browser credentialId.
    expect(H.verifyAssertion).toHaveBeenCalledTimes(1);
    const arg = (H.verifyAssertion as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { uid: string; credentialId: string; challengeId: string };
    expect(arg.uid).toBe(SIGNER_UID);
    expect(arg.credentialId).toBe(CRED_ID);
    expect(arg.challengeId).toBe('chal-1');

    // The signed entry was persisted (merge) to the canonical path.
    const stored = H.db!._dump()[entryPath()] as Record<string, unknown>;
    expect(stored.status).toBe('signed');
    expect((stored.signature as Record<string, unknown>).signerUid).toBe(SIGNER_UID);

    // Audit-log invariant: a sitebookSign.verify row was appended.
    const dump = H.db!._dump();
    const auditRows = Object.entries(dump).filter(([k]) => k.startsWith('audit_logs/'));
    expect(auditRows.length).toBe(1);
    const auditRow = auditRows[0][1] as Record<string, unknown>;
    expect(auditRow.action).toBe('sitebookSign.verify');
    expect(auditRow.module).toBe('sitebookSign');
    expect(auditRow.userId).toBe(SIGNER_UID);
    expect((auditRow.details as Record<string, unknown>).entryId).toBe(ENTRY_ID);
    expect(auditRow.projectId).toBe(PROJECT_ID);
  });

  it('500 internal when the entry read throws (fail-closed)', async () => {
    seedEntry();
    H.db!._failReads(entryPath());
    const res = await request(buildApp())
      .post('/api/sitebook/sign/verify')
      .set('x-test-uid', SIGNER_UID)
      .send(verifyBody());
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('internal');
  });
});
