/**
 * Server-only Google OAuth token store.
 *
 * Tokens (especially refresh_token) live in Firestore at oauth_tokens/{uid_provider}
 * and are READ/WRITTEN exclusively via firebase-admin. Firestore rules deny all
 * client access (default-deny + an explicit rule for clarity).
 *
 * IMPORTANT — do not import this module from client-side code. It uses
 * firebase-admin which only works in Node.
 *
 * Production hardening — KMS envelope encryption (Round 1 scaffolding):
 *   When the env flag `OAUTH_ENVELOPE_ENABLED=true` is set, refresh_token is
 *   wrapped via `envelopeEncrypt` before being written to Firestore, and
 *   transparently unwrapped on read. The wrapping uses a per-token random
 *   AES-256-GCM Data Encryption Key (DEK), and that DEK is itself wrapped by
 *   a KMS-managed Key Encryption Key (KEK) selected via `KMS_ADAPTER`.
 *
 *   In Round 1, only the `in-memory-dev` adapter is functional. The
 *   `cloud-kms` adapter is a stub awaiting a `@google-cloud/kms` install
 *   (see KMS_ROTATION.md, "Round 2 TODO"). Until then production should
 *   leave the flag OFF and rely on Firestore at-rest encryption.
 *
 *   Backwards compatibility: when the flag is OFF (default), behavior is
 *   identical to pre-envelope code. When ON, the read path is permissive —
 *   it accepts BOTH legacy plaintext refresh_tokens AND new envelope
 *   objects. This means we can flip the flag on without a migration; old
 *   docs continue to work and a separate migration job (also documented in
 *   KMS_ROTATION.md) re-wraps them in the background.
 */

import admin from 'firebase-admin';
import {
  envelopeEncrypt,
  envelopeDecrypt,
  isEnvelopeCiphertext,
  type EnvelopeCiphertext,
} from './security/kmsEnvelope.ts';
import { getKmsAdapter } from './security/kmsAdapter.ts';

const COLLECTION = 'oauth_tokens';

export type OAuthProvider = 'google' | 'google-drive';

export interface TokenIdentity {
  uid: string;
  provider: OAuthProvider;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/**
 * Shape we write to Firestore. `refresh_token` is `string | EnvelopeCiphertext`
 * depending on whether OAUTH_ENVELOPE_ENABLED was true at write time.
 *
 * NOTE: Firestore stores nested objects fine, so we don't need to JSON-encode
 * the envelope — it goes in as a sub-object and reads back the same way.
 */
interface StoredTokens {
  access_token: string;
  refresh_token?: string | EnvelopeCiphertext;
  expiry_date: number;
  scope?: string;
  token_type?: string;
  updatedAt: admin.firestore.FieldValue;
}

function docId({ uid, provider }: TokenIdentity): string {
  return `${uid}_${provider}`;
}

/**
 * Read the feature flag fresh on every call. We deliberately do NOT cache it
 * at module load — tests stub `process.env.OAUTH_ENVELOPE_ENABLED`, and
 * operators may flip it at runtime (e.g. via a Cloud Run revision) without
 * redeploy.
 */
function envelopeEnabled(): boolean {
  return (process.env.OAUTH_ENVELOPE_ENABLED ?? '').toLowerCase() === 'true';
}

/**
 * Wrap a refresh_token for storage. Returns the envelope object (not a JSON
 * string — Firestore handles nested objects natively) when the flag is on,
 * else returns the plaintext string for backwards-compatible storage.
 */
async function maybeWrapRefreshToken(
  refreshToken: string,
): Promise<string | EnvelopeCiphertext> {
  if (!envelopeEnabled()) return refreshToken;
  const adapter = getKmsAdapter();
  return envelopeEncrypt(refreshToken, adapter);
}

/**
 * Unwrap whatever we read from Firestore. Accepts:
 *   - `undefined` → returns undefined (no refresh_token stored).
 *   - plain `string` → returns it as-is (legacy pre-envelope doc).
 *   - `EnvelopeCiphertext` object → KMS-unwraps and decrypts.
 *
 * Throws if an envelope-shaped value cannot be decrypted (e.g. KMS access
 * lost). The caller decides how to surface that to the user — typically by
 * forcing re-auth.
 */
async function maybeUnwrapRefreshToken(
  stored: string | EnvelopeCiphertext | undefined,
): Promise<string | undefined> {
  if (stored === undefined) return undefined;
  if (typeof stored === 'string') {
    // Legacy plaintext entry. Works regardless of feature flag state.
    // MIGRATION: legacy plaintext entries are rewrapped by
    // scripts/migrate-oauth-tokens-to-envelope.cjs (one-shot, idempotent).
    // Run with --dry-run first; see KMS_ROTATION.md §4.
    return stored;
  }
  if (isEnvelopeCiphertext(stored)) {
    const adapter = getKmsAdapter();
    return envelopeDecrypt(stored, adapter);
  }
  // Defensive: unrecognized shape. Don't blow up; treat as missing so the
  // caller falls into the re-auth path instead of crashing the request.
  return undefined;
}

export async function saveTokens(id: TokenIdentity, tokens: RawTokenResponse): Promise<void> {
  if (!tokens.access_token) {
    throw new Error('Cannot save OAuth tokens without access_token');
  }
  const expiry_date = Date.now() + ((tokens.expires_in ?? 3600) * 1000);
  const data: StoredTokens = {
    access_token: tokens.access_token,
    expiry_date,
    scope: tokens.scope,
    token_type: tokens.token_type,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (tokens.refresh_token) {
    data.refresh_token = await maybeWrapRefreshToken(tokens.refresh_token);
  }
  await admin.firestore().collection(COLLECTION).doc(docId(id)).set(data, { merge: true });
}

export async function hasTokens(id: TokenIdentity): Promise<boolean> {
  const snap = await admin.firestore().collection(COLLECTION).doc(docId(id)).get();
  return snap.exists;
}

export async function revokeTokens(id: TokenIdentity): Promise<void> {
  await admin.firestore().collection(COLLECTION).doc(docId(id)).delete();
}

/**
 * Returns a valid access_token for the given identity, refreshing it via
 * Google's token endpoint if it is expired (or about to expire within 60s).
 *
 * Returns null when:
 *   - no tokens are stored for this identity, or
 *   - the stored access_token is expired and there is no refresh_token, or
 *   - the refresh attempt failed.
 */
export async function getValidAccessToken(
  id: TokenIdentity,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const docRef = admin.firestore().collection(COLLECTION).doc(docId(id));
  const snap = await docRef.get();
  if (!snap.exists) return null;

  const data = snap.data() as StoredTokens;

  // Still valid (with 60s buffer) — return as-is.
  if (data.expiry_date > Date.now() + 60_000) {
    return data.access_token;
  }

  // Need to refresh. Unwrap refresh_token (envelope or legacy plaintext).
  let refreshToken: string | undefined;
  try {
    refreshToken = await maybeUnwrapRefreshToken(data.refresh_token);
  } catch {
    // KMS unwrap failed — treat as if no refresh_token (caller will force
    // re-auth). Don't leak details.
    return null;
  }
  if (!refreshToken) return null;

  let refreshed: RawTokenResponse;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) return null;
    refreshed = await response.json();
  } catch {
    return null;
  }

  if (!refreshed.access_token) return null;

  await docRef.update({
    access_token: refreshed.access_token,
    expiry_date: Date.now() + ((refreshed.expires_in ?? 3600) * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return refreshed.access_token;
}
