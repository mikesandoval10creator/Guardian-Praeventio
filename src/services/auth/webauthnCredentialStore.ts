// Praeventio Guard — Round 19 (R19 A5 agent): WebAuthn credential store.
//
// Closes the M1 gap left by Round 18: the /api/auth/webauthn/verify
// endpoint shipped in R18 R6 only consumed the server-issued challenge
// without verifying the assertion's signature against the user's
// registered public key. R19 wires the @simplewebauthn/server signature-
// verification path; this service is the credential lookup surface that
// pipeline needs.
//
// MAPPING TO ISO 27001 §A.9.4.3 (Password / authentication info)
//   • Public-key-only storage. NO secret material lives in this collection
//     (the private key never leaves the authenticator).
//   • Per-credential `counter` field. The verify pipeline checks the
//     authenticator's reported counter monotonically increases — a
//     non-increasing value indicates the assertion was cloned/replayed.
//   • `lastUsedAt` written on every successful verification for forensic
//     trails.
//
// SHAPE
//   webauthn_credentials/{credentialId}
//     credentialId:  string (base64url, doc-id)
//     uid:           string (Firebase Auth uid)
//     publicKey:     string (base64-encoded COSE public key bytes)
//     counter:       number (monotonic, last-known authenticator counter)
//     transports:    string[] (optional, e.g. ['internal','hybrid'])
//     registeredAt:  number (ms since epoch — when the credential enrolled)
//     lastUsedAt:    number | null (null until first successful verify)
//
// We use a `MinimalCredentialsDb` injection rather than firebase-admin
// directly so the unit suite can swap in an in-memory fake — same pattern
// the webauthnChallenge service already uses. Production wires
// admin.firestore() through a thin adapter.
//
// REGISTRATION (TODO Round 20+):
//   This store assumes credentials are already registered. The matching
//   `/api/auth/webauthn/register` endpoint that calls
//   `registerCredential()` after a successful WebAuthn create() ceremony
//   is deferred to R20. For MVP we manually seed credentials via the
//   Firebase Admin SDK; once the registration endpoint ships, the
//   `registerCredential()` function below is the pure entrypoint it
//   should call.

const COLLECTION = 'webauthn_credentials';

export interface RegisteredCredential {
  credentialId: string;
  uid: string;
  /** base64-encoded COSE public key bytes. */
  publicKey: string;
  counter: number;
  transports?: string[];
  registeredAt: number;
  lastUsedAt: number | null;
}

export interface MinimalCredentialsDb {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{
        exists: boolean;
        id: string;
        data: () => Record<string, unknown> | undefined;
      }>;
      set(data: Record<string, unknown>): Promise<void>;
      update(patch: Record<string, unknown>): Promise<void>;
    };
    where(field: string, op: '==', value: unknown): {
      get(): Promise<{
        empty: boolean;
        docs: Array<{
          id: string;
          data: () => Record<string, unknown>;
        }>;
      }>;
    };
  };
  /** Injected clock — defaults to Date.now in production. */
  now: () => number;
}

export interface RegisterCredentialInput {
  credentialId: string;
  /** Raw COSE public key bytes (caller is responsible for the WebAuthn-side decode). */
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

/**
 * Persist a freshly-registered authenticator. Idempotent: if a credential
 * with the same id already exists, we overwrite it (registration ceremony
 * is the source of truth — a re-registration replaces the prior key).
 */
export async function registerCredential(
  uid: string,
  credential: RegisterCredentialInput,
  db: MinimalCredentialsDb,
): Promise<void> {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new Error('uid is required');
  }
  if (typeof credential.credentialId !== 'string' || credential.credentialId.length === 0) {
    throw new Error('credentialId is required');
  }
  if (!(credential.publicKey instanceof Uint8Array) || credential.publicKey.byteLength === 0) {
    throw new Error('publicKey must be a non-empty Uint8Array');
  }
  if (!Number.isFinite(credential.counter) || credential.counter < 0) {
    throw new Error('counter must be a non-negative number');
  }
  await db.collection(COLLECTION).doc(credential.credentialId).set({
    credentialId: credential.credentialId,
    uid,
    publicKey: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    transports: credential.transports ?? null,
    registeredAt: db.now(),
    lastUsedAt: null,
  });
}

/**
 * List every credential registered for a given uid. Used by the
 * authentication ceremony (`generateAuthenticationOptions` needs the
 * `allowCredentials` list).
 */
export async function getCredentialsByUid(
  uid: string,
  db: MinimalCredentialsDb,
): Promise<RegisteredCredential[]> {
  const snap = await db.collection(COLLECTION).where('uid', '==', uid).get();
  if (snap.empty) return [];
  return snap.docs.map((d) => rowToRegistered(d.data()));
}

/**
 * Find a credential by its WebAuthn id. Returns null if the id is not
 * registered. The /verify pipeline calls this with the assertion's
 * `id` field to look up the matching public key.
 */
export async function findByCredentialId(
  credentialId: string,
  db: MinimalCredentialsDb,
): Promise<{ uid: string; credential: RegisteredCredential } | null> {
  if (typeof credentialId !== 'string' || credentialId.length === 0) {
    return null;
  }
  const ref = db.collection(COLLECTION).doc(credentialId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const cred = rowToRegistered(data);
  return { uid: cred.uid, credential: cred };
}

/**
 * Update the per-credential authenticator counter + lastUsedAt. Caller
 * MUST have already validated `newCounter > storedCounter` (replay
 * prevention). This function does NOT enforce monotonicity on its own —
 * the verify pipeline owns that decision so it can return a structured
 * 401 reason rather than throwing.
 */
export async function updateCounter(
  credentialId: string,
  newCounter: number,
  db: MinimalCredentialsDb,
): Promise<void> {
  if (typeof credentialId !== 'string' || credentialId.length === 0) {
    throw new Error('credentialId is required');
  }
  if (!Number.isFinite(newCounter) || newCounter < 0) {
    throw new Error('newCounter must be a non-negative number');
  }
  await db.collection(COLLECTION).doc(credentialId).update({
    counter: newCounter,
    lastUsedAt: db.now(),
  });
}

function rowToRegistered(data: Record<string, unknown>): RegisteredCredential {
  return {
    credentialId: String(data.credentialId ?? ''),
    uid: String(data.uid ?? ''),
    publicKey: String(data.publicKey ?? ''),
    counter: Number(data.counter ?? 0),
    transports: Array.isArray(data.transports)
      ? (data.transports as string[])
      : undefined,
    registeredAt: Number(data.registeredAt ?? 0),
    lastUsedAt:
      data.lastUsedAt === null || data.lastUsedAt === undefined
        ? null
        : Number(data.lastUsedAt),
  };
}

/**
 * Decode a base64-encoded public key back into the raw bytes the
 * @simplewebauthn/server `verifyAuthenticationResponse` helper expects.
 * Exported because the verify route needs it on the hot path.
 */
export function decodePublicKey(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
