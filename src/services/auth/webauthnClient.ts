// SPDX-License-Identifier: MIT
//
// webauthnClient — Sprint 30 Bucket KK.
//
// Browser-side WebAuthn ceremony helper. Wraps the existing R18+R19
// backend (`/api/auth/webauthn/register/options`,
// `/api/auth/webauthn/register/verify`) so the Settings UI can register
// a new authenticator without bringing the @simplewebauthn/browser
// dependency into the client bundle.
//
// We use the platform `navigator.credentials.create()` API directly with
// the same wire format @simplewebauthn/browser uses (base64url for
// challenge / userId / etc.). This keeps the bundle ~30 KB lighter and
// avoids version skew with @simplewebauthn/server which is already in
// deps.
//
// SECURITY
//   • All buffers crossing JSON are base64url. We canonicalize on both
//     sides — `bufferToBase64url` for outbound, `base64urlToBuffer` for
//     inbound.
//   • The challenge is server-issued; we never mint our own.
//   • The `verify` endpoint validates the challenge + signature; if it
//     returns 200, the credential is registered server-side.

export interface RegistrationOptions {
  // Same shape @simplewebauthn/server emits from generateRegistrationOptions
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  extensions?: Record<string, unknown>;
}

export interface RegistrationCredential {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: AuthenticatorTransport[];
  };
  authenticatorAttachment?: AuthenticatorAttachment | null;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
}

export class WebAuthnNotSupportedError extends Error {
  constructor() {
    super('WebAuthn no soportado en este navegador.');
    this.name = 'WebAuthnNotSupportedError';
  }
}

export class WebAuthnCancelledError extends Error {
  constructor() {
    super('Registro cancelado por el usuario.');
    this.name = 'WebAuthnCancelledError';
  }
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof (navigator.credentials as CredentialsContainer).create === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

export function base64urlToBuffer(b64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert server-issued options (with base64url string fields) into the
 * shape `navigator.credentials.create()` expects (ArrayBuffer fields).
 */
export function decodeRegistrationOptions(
  opts: RegistrationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    ...opts,
    challenge: base64urlToBuffer(opts.challenge),
    user: {
      ...opts.user,
      id: base64urlToBuffer(opts.user.id),
    },
    excludeCredentials: opts.excludeCredentials?.map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  } as PublicKeyCredentialCreationOptions;
}

/**
 * Encode the browser's `PublicKeyCredential` registration response into
 * the JSON shape the verify endpoint understands.
 */
export function encodeRegistrationCredential(
  cred: PublicKeyCredential,
): RegistrationCredential {
  const att = cred.response as AuthenticatorAttestationResponse;
  // getTransports() may not exist on older Safari builds.
  const transports =
    typeof att.getTransports === 'function' ? att.getTransports() : undefined;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: 'public-key',
    response: {
      attestationObject: bufferToBase64url(att.attestationObject),
      clientDataJSON: bufferToBase64url(att.clientDataJSON),
      transports: transports as AuthenticatorTransport[] | undefined,
    },
    authenticatorAttachment: (cred.authenticatorAttachment as AuthenticatorAttachment | null | undefined) ?? null,
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export interface RegisterOptions {
  /**
   * Full `Authorization` header value — `Bearer <idToken>` in production,
   * `E2E <secret>:<uid>` in E2E mode. Use `apiAuthHeader()` from
   * `src/lib/apiAuth` to construct this; do NOT pass the raw idToken.
   * Plan v2 B3 — migrated from `authToken` (raw token) so MODE=test E2E
   * works without callers having to special-case.
   */
  authHeader: string;
  /** Optional human nickname. Threaded into the verify call as metadata. */
  nickname?: string;
  /** Override fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Run the full registration ceremony: ask the server for options, call
 * navigator.credentials.create, send the result back for verification.
 *
 * Throws:
 *   - WebAuthnNotSupportedError when the browser lacks the API.
 *   - WebAuthnCancelledError when the user dismisses the prompt.
 *   - Error('register_options_failed' | 'register_verify_failed' | ...)
 *     for transport / server errors.
 */
export async function registerNewAuthenticator(
  opts: RegisterOptions,
): Promise<{ credentialId: string; nickname?: string }> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnNotSupportedError();
  }
  const fetchImpl = opts.fetchImpl ?? fetch;

  const optsRes = await fetchImpl('/api/auth/webauthn/register/options', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: opts.authHeader,
    },
    body: JSON.stringify({ nickname: opts.nickname }),
  });
  if (!optsRes.ok) {
    throw new Error(`register_options_failed:${optsRes.status}`);
  }
  const serverOpts = (await optsRes.json()) as RegistrationOptions;
  const publicKey = decodeRegistrationOptions(serverOpts);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;
  } catch (err) {
    // NotAllowedError covers both user cancel and timeout.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new WebAuthnCancelledError();
    }
    throw err;
  }
  if (!credential) {
    throw new WebAuthnCancelledError();
  }

  const encoded = encodeRegistrationCredential(credential);

  const verifyRes = await fetchImpl('/api/auth/webauthn/register/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: opts.authHeader,
    },
    body: JSON.stringify({ credential: encoded, nickname: opts.nickname }),
  });
  if (!verifyRes.ok) {
    throw new Error(`register_verify_failed:${verifyRes.status}`);
  }
  const data = (await verifyRes.json()) as { credentialId: string };
  return { credentialId: data.credentialId, nickname: opts.nickname };
}
