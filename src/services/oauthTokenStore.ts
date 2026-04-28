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
 * Production hardening TODO:
 *   - Wrap stored tokens with a server-side AES-256-GCM key (e.g. from KMS or
 *     SESSION_SECRET) so a Firestore export does not expose plaintext refresh
 *     tokens. The current code relies on Firestore default encryption-at-rest.
 */

import admin from 'firebase-admin';

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

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  scope?: string;
  token_type?: string;
  updatedAt: admin.firestore.FieldValue;
}

function docId({ uid, provider }: TokenIdentity): string {
  return `${uid}_${provider}`;
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
    data.refresh_token = tokens.refresh_token;
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

  if (!data.refresh_token) return null;

  let refreshed: RawTokenResponse;
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.refresh_token,
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
