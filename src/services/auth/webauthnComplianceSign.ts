// SPDX-License-Identifier: MIT
// Praeventio Guard — WebAuthn compliance signing client (DS 67 / DS 76 / SUSESO).
//
// Full client ceremony for the HARDENED server sign flow:
//   1. GET <signChallengeUrl> → { challengeId, challenge } — a server-issued,
//      single-use challenge stored in `webauthn_challenges`.
//   2. navigator.credentials.get({ challenge }) → biometric assertion.
//   3. Return only the complete `webauthnAssertion`
//      (credentialId, rawId, clientDataJSON, authenticatorData, signature,
//      clientExtensionResults) so the server runs `verifyWebAuthnAssertion`
//      end-to-end (consume challenge + crypto verify + counter monotonicity)
//      before persisting.
//
// Supersedes the prior version that signed `payloadHashHex` directly and
// returned ONLY `signatureB64`. That version is rejected by the hardened
// endpoints, which now require the full assertion for
// algorithm=webauthn-ecdsa-p256 (the suseso/ds67/ds76 sign routes). Until this
// the server accepted any base64 string as a "signature" — see §2.9.

import {
  bufferToBase64url,
  isWebAuthnSupported,
  WebAuthnCancelledError,
  WebAuthnNotSupportedError,
} from './webauthnClient';

export type ComplianceSignAlgorithm = 'webauthn-ecdsa-p256' | 'kms-sign-rsa';

/** @deprecated Persisted signature evidence is constructed by the server. */
export interface ComplianceSignature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: ComplianceSignAlgorithm;
  signatureB64: string;
  payloadHashHex: string;
}

/** The full WebAuthn assertion the server verifies (`verifyWebAuthnAssertion`). */
export interface ComplianceWebAuthnAssertion {
  challengeId: string;
  credentialId: string;
  rawId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  type: 'public-key';
  clientExtensionResults: Record<string, unknown>;
}

export interface ComplianceSignResult {
  /** Goes into the POST body's `webauthnAssertion` field. */
  webauthnAssertion: ComplianceWebAuthnAssertion;
}

interface SignChallengeResponse {
  challengeId: string;
  /** base64 (standard) of the 32 server-issued challenge bytes. */
  challenge: string;
  rpId?: string;
}

/** Decode base64 / base64url to bytes (browser-safe, no Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Run the WebAuthn signing ceremony against a SERVER-issued challenge and
 * return the full `webauthnAssertion` for server-side verification. Signer
 * identity, time, payload hash and persisted evidence are server-owned.
 *
 * @throws WebAuthnNotSupportedError — no platform authenticator / security key.
 * @throws WebAuthnCancelledError — the user dismissed the native prompt.
 * @throws Error — the sign-challenge endpoint failed or returned a bad body.
 */
export async function requestComplianceSignature(
  opts: { signChallengeUrl: string; authHeader: string | null },
): Promise<ComplianceSignResult> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnNotSupportedError();
  }

  // 1. Fetch a single-use, server-stored challenge bound to this signing
  //    session (consumed atomically by verifyWebAuthnAssertion afterwards).
  const chRes = await fetch(opts.signChallengeUrl, {
    method: 'GET',
    headers: opts.authHeader ? { Authorization: opts.authHeader } : undefined,
  });
  if (!chRes.ok) {
    throw new Error(`sign-challenge failed (HTTP ${chRes.status})`);
  }
  const { challengeId, challenge } = (await chRes.json()) as SignChallengeResponse;
  if (!challengeId || !challenge) {
    throw new Error('sign-challenge returned an incomplete response');
  }
  const challengeBytes = base64ToBytes(challenge);

  // 2. Biometric ceremony bound to the server challenge.
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes as unknown as BufferSource,
        // Empty allowCredentials → the browser offers every authenticator
        // registered for this origin (mirrors sitebookSign's behaviour).
        allowCredentials: [],
        userVerification: 'preferred',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new WebAuthnCancelledError();
    }
    throw err;
  }
  if (!credential) {
    throw new WebAuthnCancelledError();
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  const signatureB64 = bufferToBase64url(response.signature);

  return {
    webauthnAssertion: {
      challengeId,
      credentialId: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: signatureB64,
      type: 'public-key',
      clientExtensionResults:
        credential.getClientExtensionResults() as Record<string, unknown>,
    },
  };
}
