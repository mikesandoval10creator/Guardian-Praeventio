// Praeventio Guard — WebAuthn assertion verification helper (reusable).
//
// Regla #3 (2026-05-15): extraído del flujo de curriculum.ts para que
// otros endpoints (SUSESO sign, CPHS actas, futuros) puedan ejecutar la
// ceremonia WebAuthn completa end-to-end sin duplicar 100 LOC de
// boilerplate.
//
// Flujo verificado:
//   1. Caller decodifica `clientDataJSON` y extrae el challenge
//   2. Consumimos el challenge atomicamente desde el cache de challenges
//      (replay-protection — un challenge solo sirve una vez)
//   3. Buscamos la credential registrada por `credentialId`
//   4. Verificamos que el credential pertenezca al uid del request
//   5. Llamamos a `verifyAuthenticationResponse` de @simplewebauthn/server
//      con la public key, counter, transports y expected origin/RP
//   6. Verificamos que el nuevo counter sea > anterior (anti-clone)
//   7. Actualizamos el counter para la próxima vez

import {
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  findByCredentialId,
  updateCounter,
  decodePublicKey,
  type MinimalCredentialsDb,
} from '../../services/auth/webauthnCredentialStore.js';
import {
  consumeWebAuthnChallenge,
  type MinimalChallengesDb as MinimalWebAuthnChallengesDb,
} from '../../services/auth/webauthnChallenge.js';

export interface WebAuthnAssertionInput {
  /** UID del usuario que está firmando (de verifyAuth). */
  uid: string;
  /** `id` del credential que el browser usó. */
  credentialId: string;
  /** `rawId` (base64url) — usualmente igual a credentialId. */
  rawId: string;
  /** `clientDataJSON` (base64) del WebAuthn response. */
  clientDataJSON: string;
  /** `authenticatorData` (base64). */
  authenticatorData: string;
  /** `signature` (base64) producida por el authenticator. */
  signature: string;
  /** Extensions opcionales (puede ser objeto vacío). */
  clientExtensionResults: Record<string, unknown>;
  /** `type` — siempre `"public-key"`. */
  type: string;
  /** ID del challenge issued por el server. */
  challengeId: string;
  /** Origin esperado (https://app.praeventio.net en prod). */
  expectedOrigin: string;
  /** RP ID esperado (app.praeventio.net en prod). */
  expectedRpId: string;
  /** Inyección para tests. En prod usar `buildWebAuthnDb()`. */
  challengesDb: MinimalWebAuthnChallengesDb;
  /** Inyección para tests. En prod usar `buildWebAuthnCredentialsDb()`. */
  credentialsDb: MinimalCredentialsDb;
  /** Optional fail-closed validator for a challenge bound to server context. */
  challengeMetadataValidator?: (metadata: unknown) => boolean;
}

export type WebAuthnAssertionFailureReason =
  | 'missing_field'
  | 'malformed_client_data'
  | 'challenge_invalid'
  | 'challenge_expired'
  | 'challenge_not_found'
  | 'challenge_mismatch'
  | 'challenge_context_mismatch'
  | 'unknown_credential'
  | 'credential_owned_by_other_uid'
  | 'signature_invalid'
  | 'counter_not_monotonic';

export interface WebAuthnAssertionResult {
  verified: boolean;
  /** Solo si `verified === false`. */
  reason?: WebAuthnAssertionFailureReason;
  /** Solo si `verified === true` — nuevo counter para auditar. */
  newCounter?: number;
  /** Solo si `verified === true` — credentialId verificado. */
  verifiedCredentialId?: string;
  /** Validated immutable challenge context, when the issuer stored one. */
  challengeMetadata?: unknown;
}

/**
 * Verifica una WebAuthn assertion end-to-end. Devuelve `{verified: true}`
 * solo si TODAS las capas pasan (challenge consumido, credential
 * encontrado, signature válida, counter monotónico).
 *
 * Esta función centraliza toda la criptografía — los routes que la usan
 * (SUSESO sign, CPHS actas, etc.) solo deben pasar los inputs del body
 * y la función devuelve un veredict tipado y testeable.
 */
export async function verifyWebAuthnAssertion(
  input: WebAuthnAssertionInput,
): Promise<WebAuthnAssertionResult> {
  // ─── Layer 0: shape validation ────────────────────────────────────────
  const fields = [
    ['credentialId', input.credentialId],
    ['rawId', input.rawId],
    ['clientDataJSON', input.clientDataJSON],
    ['authenticatorData', input.authenticatorData],
    ['signature', input.signature],
    ['challengeId', input.challengeId],
  ] as const;
  for (const [_, value] of fields) {
    if (typeof value !== 'string' || value.length === 0) {
      return { verified: false, reason: 'missing_field' };
    }
  }
  if (input.type !== 'public-key') {
    return { verified: false, reason: 'missing_field' };
  }
  if (
    input.clientExtensionResults === null ||
    typeof input.clientExtensionResults !== 'object' ||
    Array.isArray(input.clientExtensionResults)
  ) {
    return { verified: false, reason: 'missing_field' };
  }

  // ─── Layer 1: extract challenge bytes from clientDataJSON ─────────────
  let providedChallenge: Uint8Array;
  let challengeB64u: string;
  try {
    const cdjStr = Buffer.from(input.clientDataJSON, 'base64').toString('utf8');
    const cdj = JSON.parse(cdjStr);
    challengeB64u = String(cdj.challenge ?? '');
    const b64 = challengeB64u.replace(/-/g, '+').replace(/_/g, '/');
    providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    return { verified: false, reason: 'malformed_client_data' };
  }

  // ─── Layer 2: consume challenge atomically (single-use) ───────────────
  const challengeResult = await consumeWebAuthnChallenge(
    input.uid,
    input.challengeId,
    providedChallenge,
    input.challengesDb,
    { validateMetadata: input.challengeMetadataValidator },
  );
  if (challengeResult.valid === false) {
    // ConsumeReason = 'unknown' | 'expired' | 'consumed' | 'mismatch'
    const raw = challengeResult.reason;
    const reason: WebAuthnAssertionFailureReason =
      raw === 'unknown'
        ? 'challenge_not_found'
        : raw === 'expired'
          ? 'challenge_expired'
          : raw === 'metadata_mismatch'
            ? 'challenge_context_mismatch'
          : raw === 'mismatch'
            ? 'challenge_mismatch'
            : 'challenge_invalid';
    return { verified: false, reason };
  }

  // ─── Layer 3: lookup credential by id ─────────────────────────────────
  const stored = await findByCredentialId(input.credentialId, input.credentialsDb);
  if (!stored) {
    return { verified: false, reason: 'unknown_credential' };
  }
  if (stored.uid !== input.uid) {
    // No leak — same reason as not-found.
    return { verified: false, reason: 'unknown_credential' };
  }

  // ─── Layer 4: cryptographic verification ──────────────────────────────
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: {
        id: input.credentialId,
        rawId: input.rawId,
        response: {
          clientDataJSON: input.clientDataJSON,
          authenticatorData: input.authenticatorData,
          signature: input.signature,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clientExtensionResults: input.clientExtensionResults as any,
        type: 'public-key',
      },
      expectedChallenge: challengeB64u,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      credential: {
        id: stored.credential.credentialId,
        publicKey: decodePublicKey(stored.credential.publicKey),
        counter: stored.credential.counter,
        transports: stored.credential.transports as
          | ('ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb')[]
          | undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return { verified: false, reason: 'signature_invalid' };
  }

  if (!verification.verified) {
    return { verified: false, reason: 'signature_invalid' };
  }

  // ─── Layer 5: counter monotonicity (clone-detection) ──────────────────
  // Enforce monotonicity ONLY when the stored counter is > 0. Authenticators
  // that don't implement a counter keep it at 0 forever (some cloud-synced
  // passkeys), so a stored 0 + new 0 is legitimate. But once the stored
  // counter has advanced (> 0), ANY new counter <= stored is a clone/replay
  // — including a reported 0. The previous guard (`newCounter !== 0`) carved
  // out 0 unconditionally, so an attacker replaying counter 0 against a
  // credential whose stored counter was already 5 BYPASSED the check. This
  // mirrors the canonical gate in curriculum.ts (/api/auth/webauthn/verify).
  const newCounter = verification.authenticationInfo.newCounter;
  if (stored.credential.counter > 0 && newCounter <= stored.credential.counter) {
    return { verified: false, reason: 'counter_not_monotonic' };
  }
  await updateCounter(input.credentialId, newCounter, input.credentialsDb);

  const result: WebAuthnAssertionResult = {
    verified: true,
    newCounter,
    verifiedCredentialId: input.credentialId,
  };
  if (challengeResult.metadata !== undefined) {
    result.challengeMetadata = challengeResult.metadata;
  }
  return result;
}
