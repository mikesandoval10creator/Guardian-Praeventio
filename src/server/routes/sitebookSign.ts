// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — server-side SiteBook signing
// handlers (dependency-injected, framework-agnostic).
//
// Estos handlers son la lógica DENTRO de las routes Express:
//   POST /api/sitebook/sign/options  → handleSignOptionsRequest
//   POST /api/sitebook/sign/verify   → handleSignVerifyRequest
//
// La capa Express (server.ts) wireará verifyAuth + body parsing y luego
// llamará a estos handlers con los deps reales (Firestore Admin SDK +
// el assertion verifier + el clock). Esa separación permite tests
// unitarios sin Express, sin Firestore y sin @simplewebauthn real.
//
// ── Garantías criptográficas ───────────────────────────────────────────
// 1. El payloadHashHex que el browser envía SE RE-COMPUTA en el server
//    desde la entry persistida (loadEntry). Si difieren → 'hash_mismatch'.
//    Esto previene que un cliente comprometido pretenda firmar un texto
//    distinto del que está realmente en Firestore.
//
// 2. El challenge se DERIVA del payloadHashHex (no es random). Cualquier
//    verifier puede recomputar `expected = deriveSigningChallenge(hash)`
//    y comparar con el `clientDataJSON.challenge`. La verificación de
//    @simplewebauthn/server hace exactamente eso al recibir el expected
//    challenge.
//
// 3. El challenge persiste con consumed:false + TTL 5min. La capa de
//    `consumeWebAuthnChallenge` lo marca consumed atomicamente — no se
//    puede re-usar.
//
// 4. La signature record SOLO se persiste si TODAS las layers pasaron:
//    entry existe + status='open' + hash matches + challenge consumido +
//    signature verificada + counter monotónico.

import {
  computeEntryPayloadHashHex,
  deriveSigningChallenge,
  buildSignatureRecord,
  type AssertionFromBrowser,
} from '../../services/siteBook/siteBookSigning';
import { signEntry, type SiteBookEntry } from '../../services/siteBook/siteBookService';
import {
  storeWebAuthnChallenge,
  type MinimalChallengesDb,
} from '../../services/auth/webauthnChallenge.js';
import type { MinimalCredentialsDb } from '../../services/auth/webauthnCredentialStore.js';
import type {
  WebAuthnAssertionInput,
  WebAuthnAssertionResult,
} from '../auth/webauthnAssertion';
import crypto from 'node:crypto';

// ─── Common types ─────────────────────────────────────────────────────────

export type SignErrorReason =
  | 'invalid_hash_format'
  | 'not_found'
  | 'hash_mismatch'
  | 'already_signed'
  | 'no_credentials'
  | 'signature_invalid'
  | 'challenge_invalid'
  | 'challenge_expired'
  | 'challenge_not_found'
  | 'challenge_mismatch'
  | 'unknown_credential'
  | 'credential_owned_by_other_uid'
  | 'counter_not_monotonic'
  | 'missing_field'
  | 'malformed_client_data';

export type HandlerResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'error'; reason: SignErrorReason };

const HASH_REGEX = /^[0-9a-f]{64}$/i;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// ─── /options handler ─────────────────────────────────────────────────────

export interface SignOptionsRequest {
  uid: string;
  entryId: string;
  projectId: string;
  payloadHashHex: string;
}

export interface SignOptionsResponseShape {
  challengeB64u: string;
  challengeId: string;
  allowCredentials: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  rpId?: string;
  timeoutMs?: number;
}

export interface SignOptionsDeps {
  challengesDb: MinimalChallengesDb;
  /**
   * Mínima superficie del credentials store para listar credentials por uid.
   * En prod: `webauthnCredentialStore.listByUid(uid)`. En tests: fake.
   */
  credentialsDb: MinimalCredentialsDb;
  loadEntry: (projectId: string, entryId: string) => Promise<SiteBookEntry | null>;
  rpId?: string;
}

/**
 * Lista los credentialIds registrados para un uid. Implementación canónica
 * para la fake credentials DB usada en tests (where('uid','==', value)).
 * En prod, server.ts puede inyectar una variante que llame al
 * `webauthnCredentialStore` real.
 */
async function listCredentialIdsForUid(
  uid: string,
  credentialsDb: MinimalCredentialsDb,
): Promise<string[]> {
  // MinimalCredentialsDb.collection().where(...).get() devuelve un snapshot
  // con `.docs[]`. Esta es la shape que tanto el fake test como el adapter
  // admin emiten.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coll = (credentialsDb as any).collection?.('webauthn_credentials');
  if (!coll || typeof coll.where !== 'function') return [];
  const snap = await coll.where('uid', '==', uid).get();
  if (!snap || !Array.isArray(snap.docs)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snap.docs.map((d: any) => String(d.id));
}

export async function handleSignOptionsRequest(
  req: SignOptionsRequest,
  deps: SignOptionsDeps,
): Promise<HandlerResult<SignOptionsResponseShape>> {
  if (!HASH_REGEX.test(req.payloadHashHex)) {
    return { kind: 'error', reason: 'invalid_hash_format' };
  }

  const entry = await deps.loadEntry(req.projectId, req.entryId);
  if (!entry) return { kind: 'error', reason: 'not_found' };
  if (entry.status === 'signed') return { kind: 'error', reason: 'already_signed' };

  // Re-compute server-side. Si el cliente mintió, lo cortamos acá.
  const expectedHashHex = computeEntryPayloadHashHex(entry);
  if (expectedHashHex.toLowerCase() !== req.payloadHashHex.toLowerCase()) {
    return { kind: 'error', reason: 'hash_mismatch' };
  }

  // Lista credentials del uid — sin credentials, no se puede firmar.
  const credentialIds = await listCredentialIdsForUid(req.uid, deps.credentialsDb);
  if (credentialIds.length === 0) {
    return { kind: 'error', reason: 'no_credentials' };
  }

  // Deriva el challenge bound al documento.
  const challenge = deriveSigningChallenge(req.payloadHashHex);

  // ChallengeId distinto del challenge — sirve como handle único para
  // consumir atomicamente en /verify.
  const challengeId = crypto.randomBytes(32).toString('hex');

  await storeWebAuthnChallenge(req.uid, challengeId, challenge, deps.challengesDb, {
    ttlMs: CHALLENGE_TTL_MS,
  });

  const challengeB64u = bufferToBase64url(challenge);

  return {
    kind: 'ok',
    value: {
      challengeB64u,
      challengeId,
      allowCredentials: credentialIds.map((id) => ({
        id,
        type: 'public-key' as const,
      })),
      rpId: deps.rpId,
      timeoutMs: 60_000,
    },
  };
}

// ─── /verify handler ──────────────────────────────────────────────────────

export interface SignVerifyRequest {
  uid: string;
  entryId: string;
  projectId: string;
  payloadHashHex: string;
  challengeId: string;
  assertion: AssertionFromBrowser;
}

export interface SignVerifyResponseShape {
  entry: SiteBookEntry;
}

export interface SignVerifyDeps {
  challengesDb: MinimalChallengesDb;
  credentialsDb: MinimalCredentialsDb;
  loadEntry: (projectId: string, entryId: string) => Promise<SiteBookEntry | null>;
  saveSignedEntry: (projectId: string, entry: SiteBookEntry) => Promise<void>;
  /**
   * Inyectado para tests — en prod es `verifyWebAuthnAssertion` de
   * `../auth/webauthnAssertion`.
   */
  verifyAssertion: (input: WebAuthnAssertionInput) => Promise<WebAuthnAssertionResult>;
  expectedOrigin: string;
  expectedRpId: string;
  now: () => Date;
}

export async function handleSignVerifyRequest(
  req: SignVerifyRequest,
  deps: SignVerifyDeps,
): Promise<HandlerResult<SignVerifyResponseShape>> {
  if (!HASH_REGEX.test(req.payloadHashHex)) {
    return { kind: 'error', reason: 'invalid_hash_format' };
  }
  if (!req.assertion || !req.assertion.credentialId || !req.assertion.signatureB64u) {
    return { kind: 'error', reason: 'missing_field' };
  }

  const entry = await deps.loadEntry(req.projectId, req.entryId);
  if (!entry) return { kind: 'error', reason: 'not_found' };
  if (entry.status === 'signed') return { kind: 'error', reason: 'already_signed' };

  // Re-compute hash → guard against tampered payloadHashHex.
  const expectedHashHex = computeEntryPayloadHashHex(entry);
  if (expectedHashHex.toLowerCase() !== req.payloadHashHex.toLowerCase()) {
    return { kind: 'error', reason: 'hash_mismatch' };
  }

  // Cryptographic verification — single source of truth via the existing
  // helper. Pass the assertion bytes verbatim from the browser.
  const verification = await deps.verifyAssertion({
    uid: req.uid,
    credentialId: req.assertion.credentialId,
    rawId: req.assertion.rawId,
    clientDataJSON: req.assertion.clientDataJSONB64u,
    authenticatorData: req.assertion.authenticatorDataB64u,
    signature: req.assertion.signatureB64u,
    clientExtensionResults: {},
    type: 'public-key',
    challengeId: req.challengeId,
    expectedOrigin: deps.expectedOrigin,
    expectedRpId: deps.expectedRpId,
    challengesDb: deps.challengesDb,
    credentialsDb: deps.credentialsDb,
  });

  if (!verification.verified) {
    const r: SignErrorReason = (verification.reason as SignErrorReason | undefined) ?? 'signature_invalid';
    return { kind: 'error', reason: r };
  }

  // Build + persist signature record.
  const signature = buildSignatureRecord({
    signerUid: req.uid,
    signedAtIso: deps.now().toISOString(),
    payloadHashHex: req.payloadHashHex,
    assertion: req.assertion,
  });

  const signed = signEntry(entry, signature);
  await deps.saveSignedEntry(req.projectId, signed);

  return { kind: 'ok', value: { entry: signed } };
}

// ─── Helpers (no DOM, Node-side) ──────────────────────────────────────────

function bufferToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
