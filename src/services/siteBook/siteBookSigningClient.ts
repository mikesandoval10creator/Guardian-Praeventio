// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — client orchestrator for
// SiteBook entry signing via WebAuthn ECDSA-P256.
//
// Coordina el flow trifásico:
//
//   1) POST /api/sitebook/sign/options  { entryId, projectId, payloadHashHex }
//      ↳ Server genera + persiste un challenge SHA-256(domain || payloadHash)
//        atado al uid + entryId, retorna { challengeB64u, challengeId,
//        allowCredentials }.
//
//   2) navigator.credentials.get({ publicKey: { challenge, allowCredentials } })
//      ↳ El authenticator (TPM / Secure Enclave / security key) firma
//        clientDataJSON || authenticatorData con la clave privada ECDSA-P256.
//        El clientDataJSON incluye `challenge` re-codificado base64url —
//        cualquier verifier puede chequear que el challenge fue el correcto.
//
//   3) POST /api/sitebook/sign/verify   { entryId, payloadHashHex,
//                                          challengeId, assertion }
//      ↳ Server re-deriva el expected challenge, verifica la signature con
//        @simplewebauthn/server, atomicamente consume el challenge, persiste
//        signature en el doc Firestore, retorna la entry firmada.
//
// El client NO genera ni controla el challenge — eso garantiza replay-
// protection y vincula la firma al uid + payloadHash exactos (ver
// `siteBookSigning.ts` para la derivación criptográfica).
//
// Errores public-facing:
//   - `WebAuthnNotSupportedError` — browser viejo / desktop sin platform
//     authenticator + sin security key.
//   - `SignCancelledError` — el usuario dismisseó el prompt nativo.
//   - `Error('sign_options_failed:<status>')` — server rechazó la
//     emisión del challenge (entry inexistente, no autorizado, etc.).
//   - `Error('sign_verify_failed:<status>')` — server rechazó la
//     assertion (signature inválida, challenge expirado, counter clone, etc.).

import { computeEntryPayloadHashHex } from './siteBookSigning';
import type { SiteBookEntry } from './siteBookService';
import { base64urlToBuffer, bufferToBase64url } from '../auth/webauthnClient';

export class WebAuthnNotSupportedError extends Error {
  constructor() {
    super('WebAuthn no soportado en este navegador.');
    this.name = 'WebAuthnNotSupportedError';
  }
}

export class SignCancelledError extends Error {
  constructor() {
    super('Firma cancelada por el usuario.');
    this.name = 'SignCancelledError';
  }
}

export class AlreadySignedError extends Error {
  constructor() {
    super('Esta entrada ya está firmada — no se puede re-firmar.');
    this.name = 'AlreadySignedError';
  }
}

export interface SignSiteBookEntryOptions {
  /** Authorization header completo (Bearer ... o E2E ...). */
  authHeader: string;
  /** Override de fetch para tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Shape que /api/sitebook/sign/options retorna. El server canónico:
 *   - genera un challenge bound al payloadHashHex via deriveSigningChallenge
 *   - persiste el challenge atado al uid (replay-protection, single-use)
 *   - retorna la lista de credentials registradas para que el browser
 *     muestre el prompt correcto (algunos passkey UIs filtran por allow).
 */
interface SignOptionsResponse {
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

interface SignVerifyResponse {
  entry: SiteBookEntry;
}

function isWebAuthnSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator).credentials !== 'undefined' &&
    typeof (navigator.credentials as CredentialsContainer).get === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

/**
 * Orquesta la ceremonia completa de firma WebAuthn para una entry del
 * Site Book. La entry debe estar en status='open' — re-firmar una entry
 * ya firmada es un error de UX (correcciones se hacen vía
 * `createCorrection`, no re-firma).
 *
 * @param entry  La SiteBookEntry a firmar.
 * @param opts   authHeader + optional fetch override (para tests).
 * @returns      La entry actualizada con `status='signed'` + `signature`
 *               populated. El backend re-computa el hash y rechaza si no
 *               coincide con el firmado por el browser → la caller puede
 *               confiar en que el retorno es válido.
 */
export async function signSiteBookEntryWithWebAuthn(
  entry: SiteBookEntry,
  opts: SignSiteBookEntryOptions,
): Promise<SiteBookEntry> {
  if (entry.status === 'signed') {
    throw new AlreadySignedError();
  }
  if (!isWebAuthnSupported()) {
    throw new WebAuthnNotSupportedError();
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const payloadHashHex = computeEntryPayloadHashHex(entry);

  // ─── Phase 1: ask server for challenge ────────────────────────────────
  const optionsRes = await fetchImpl('/api/sitebook/sign/options', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: opts.authHeader,
    },
    body: JSON.stringify({
      entryId: entry.id,
      projectId: entry.projectId,
      payloadHashHex,
    }),
  });
  if (!optionsRes.ok) {
    throw new Error(`sign_options_failed:${optionsRes.status}`);
  }
  const optionsData = (await optionsRes.json()) as SignOptionsResponse;

  // ─── Phase 2: invoke the browser WebAuthn prompt ──────────────────────
  const credentialRequestOptions: CredentialRequestOptions = {
    publicKey: {
      challenge: base64urlToBuffer(optionsData.challengeB64u),
      allowCredentials: optionsData.allowCredentials.map((c) => ({
        id: base64urlToBuffer(c.id),
        type: 'public-key',
        transports: c.transports,
      })),
      rpId: optionsData.rpId,
      timeout: optionsData.timeoutMs ?? 60_000,
      userVerification: 'required',
    },
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get(
      credentialRequestOptions,
    )) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new SignCancelledError();
    }
    // Mock-friendly: some test envs throw a plain object with name=NotAllowedError.
    if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'NotAllowedError') {
      throw new SignCancelledError();
    }
    throw err;
  }
  if (!credential) {
    throw new SignCancelledError();
  }

  // Encode the assertion to JSON-safe base64url shape.
  const response = credential.response as AuthenticatorAssertionResponse;
  const assertion = {
    credentialId: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    clientDataJSONB64u: bufferToBase64url(response.clientDataJSON),
    authenticatorDataB64u: bufferToBase64url(response.authenticatorData),
    signatureB64u: bufferToBase64url(response.signature),
  };

  // ─── Phase 3: server-side verification + persistence ──────────────────
  const verifyRes = await fetchImpl('/api/sitebook/sign/verify', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: opts.authHeader,
    },
    body: JSON.stringify({
      entryId: entry.id,
      projectId: entry.projectId,
      payloadHashHex,
      challengeId: optionsData.challengeId,
      assertion,
    }),
  });
  if (!verifyRes.ok) {
    throw new Error(`sign_verify_failed:${verifyRes.status}`);
  }
  const verifyData = (await verifyRes.json()) as SignVerifyResponse;
  return verifyData.entry;
}
