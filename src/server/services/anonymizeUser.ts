// Praeventio Guard — cascarón soft-delete (Ley 21.719 / GDPR / Apple), block 2.
//
// `anonymizeUser()` is the IRREVERSIBLE de-identification core: it scrubs a
// user's PII to an empty shell while KEEPING the uid + immutable history, then
// records an immutable proof in `anonymization_events/{uid}`. It is the
// destructive counterpart of `deactivateUser()` (which only revokes sessions):
//
//   1. Firebase Auth — scrub displayName/photoURL, tombstone the email, and
//      DISABLE the account (never `deleteUser`: the uid must survive so
//      audit_logs / nodes / anonymization_events keep referential integrity).
//   2. Revoke refresh tokens (kill live sessions immediately).
//   3. Custom claims → `role: 'anonymized'` (supersedes any prior role).
//   4. `users/{uid}` — redact the PII fields, tombstone email, stamp
//      `anonymizedAt`. Server-side via the Admin SDK (bypasses rules).
//   5. Purge the PII subcollections (medical / wellness / schedule / vault).
//   5b. Redact author identity (name/photo + own comments) on the user's
//      community posts, cross-project, via the `safety_posts` collection group.
//   6. Write the immutable `anonymization_events/{uid}` proof (export checksum
//      + what was redacted). Last, so it only records a completed scrub.
//
// DI-first (same shape as `deactivateUser`): callers inject `authAdmin` + `db`
// so this is unit-testable with fakes (no emulator). The CALLER (the
// /api/account/anonymize endpoint, block 3) is responsible for the 2FA gate,
// the data-export that produces `dataExportChecksum`, and the audit_logs rows
// (`account.anonymization_initiated` BEFORE + `account.anonymization_completed`
// AFTER) — exactly like `deactivateUser` leaves bookkeeping to its caller.
//
// Identity ALWAYS comes from the verified token at the endpoint; this service
// scrubs ONLY the uid it is handed, never a client-supplied one.
//
// PARTIAL FAILURE: steps run sequentially and THROW on the first error (no
// try/catch) — the proof (step 6) is written LAST so it never records a scrub
// that didn't complete. Re-running is safe/idempotent (auth scrub + redactions
// + deletes converge). The endpoint MUST audit `account.anonymization_initiated`
// BEFORE calling this so intent survives a mid-scrub failure.

import { deleteCredentialsByUid } from '../../services/auth/webauthnCredentialStore.js';
import { deleteChallengesByUid } from '../../services/auth/webauthnChallenge.js';

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * `users/{uid}` PII fields removed on anonymization (the doc keeps its
 * functional fields — role, tenantConfig, subscription, onboarded — so the
 * shell stays valid against firestore.rules `isValidUser`).
 *
 * Both snake_case and camelCase aliases are listed so the merge set
 * deletes every variant. (Historical note: FirebaseContext.tsx:125-136
 * writes the camelCase aliases (`displayName`, `photoURL`); the
 * snake_case names were the original contract. Resolved by the
 * camelCase-aliase fix in PR #1724.)
 *
 * FieldValue.delete() is used per-field so the merge keeps unrelated
 * functional fields (role, projectMemberships, etc.) intact.
 */
export const ANONYMIZATION_USERS_DOC_REDACT = [
  'display_name',
  'photo_url',
  'displayName',
  'photoURL',
  'notificationPreferences',
  // [Hy3-audit] Resolves [Audit-2026-08-31] Account anonymization —
  // exporta y conserva credenciales en users/{uid}. The legacy
  // redact list left bearer credentials (FCM push tokens, IAP
  // purchase tokens, legacy array of push tokens, API keys) on
  // the post-scrub Firestore doc, where a backup-export or any
  // tenant-side read could lift them and replay against Google FCM
  // or Google Play / Apple IAP verifiers. Add the credential-shaped
  // fields to the redact list so the merge-set deletes them
  // unconditionally.
  'fcmToken',
  'fcmTokens',
  'apiKey',
  'subscription.purchaseToken',
  // Stripe / PayPal customer IDs are also bearer-shaped: a leaked
  // customer_id can drive refunds, plan changes, and live-mode
  // subscription reads on the merchant side. Same fix.
  'subscription.customerId',
  'subscription.stripeCustomerId',
] as const;

/**
 * Per-user subcollections fully purged on anonymization. Medical + wellness +
 * schedule + health-vault data carry the highest-sensitivity PII (ADR 0012).
 */
export const ANONYMIZATION_PII_SUBCOLLECTIONS = [
  'medical_exams',
  'morning_checkins',
  'focus_blocks',
  'health_vault',
  'health_vault_shares',
  // Immutable offboarding snapshots and their bearer-secret grant metadata
  // belong to the worker. Account erasure must purge both; keeping either
  // would leave identity or a reusable access hash after anonymization.
  'personal_passports',
  'personal_passport_shares',
] as const;

export interface AnonymizeUserDeps {
  authAdmin: typeof getAuth;
  db: Firestore;
}

export interface AnonymizeUserInput {
  uid: string;
  /** SHA-256 checksum of the data export handed to the user (Ley 21.719 proof). */
  dataExportChecksum?: string | null;
  /** Injectable clock (epoch ms) for deterministic tests; defaults to now. */
  now?: number;
}

export interface AnonymizeUserResult {
  uid: string;
  anonymizedAt: number;
  /** Human-readable list of PII fields that were redacted (for the audit row). */
  fieldsRedacted: string[];
  /** Per-subcollection count of documents purged. */
  subcollectionsScrubbed: Record<string, number>;
  /** Count of community posts whose author identity was redacted (cross-project). */
  safetyPostsRedacted: number;
  /**
   * WebAuthn orphan sweep (top-level collections). Each value is the count
   * of rows hard-deleted by the anonymization step. 0 means the uid had
   * no outstanding rows in that collection (the common case for an account
   * that never registered a biometric or whose challenges had already
   * expired by the time the anonymization ran).
   *
   * [Hy3-audit] Resolves [Audit-2026-08-31] WebAuthn lifecycle —
   * anonymization deja credentials y challenges huérfanos.
   */
  webauthnCredentialsDeleted: number;
  webauthnChallengesDeleted: number;
  applied: true;
}

/**
 * A unique, syntactically-valid, non-routable tombstone email per uid.
 * `.invalid` is an IANA-reserved TLD that can never resolve. Assumes Firebase
 * UIDs have no `+`/`@` (true for Firebase-generated 28-char ids); a federated
 * provider with an exotic uid format would need escaping here.
 */
function tombstoneEmail(uid: string): string {
  return `deleted+${uid}@anonymized.invalid`;
}

/** Firestore batches cap at 500 ops — purge in chunks so large vaults succeed. */
const BATCH_LIMIT = 500;

/** Delete every doc in `users/{uid}/{sub}`, chunked at 500; returns the count. */
async function purgeSubcollection(
  db: Firestore,
  uid: string,
  sub: string,
): Promise<number> {
  const refs = await db.collection('users').doc(uid).collection(sub).listDocuments();
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

/** Label shown in place of an anonymized user's name on community posts. */
const ANON_AUTHOR_LABEL = 'Usuario anonimizado';

/**
 * Redact the de-normalized identity (userName/userPhoto) on every community
 * post the user AUTHORED, anywhere — via a `safety_posts` collection-group
 * query (enabled by the fieldOverride in firestore.indexes.json). Also scrubs
 * the user's name from any comment they wrote embedded in those posts. The post
 * itself survives (community history stays), attributed to an anonymous shell.
 * Chunked at the 500-op batch limit. Returns the number of posts touched.
 */
async function scrubAuthoredSafetyPosts(
  db: Firestore,
  uid: string,
): Promise<number> {
  const snap = await db.collectionGroup('safety_posts').where('userId', '==', uid).get();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const chunk = docs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const postDoc of chunk) {
      const data = postDoc.data() as {
        comments?: Array<{ userId?: string; userName?: string } & Record<string, unknown>>;
      };
      const patch: Record<string, unknown> = {
        userName: ANON_AUTHOR_LABEL,
        userPhoto: FieldValue.delete(),
      };
      // Comments are an embedded array — rewrite it, scrubbing only the
      // anonymized user's OWN comments (others' names are not ours to touch).
      if (Array.isArray(data.comments)) {
        patch.comments = data.comments.map((c) =>
          c && c.userId === uid ? { ...c, userName: ANON_AUTHOR_LABEL } : c,
        );
      }
      batch.update(
        postDoc.ref,
        patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
      );
    }
    await batch.commit();
  }
  return docs.length;
}

export async function anonymizeUser(
  deps: AnonymizeUserDeps,
  input: AnonymizeUserInput,
): Promise<AnonymizeUserResult> {
  const { authAdmin, db } = deps;
  const uid = input.uid;
  if (!uid || typeof uid !== 'string') {
    throw new TypeError('anonymizeUser: uid is required and must be a string');
  }
  const anonymizedAt = input.now ?? Date.now();
  const email = tombstoneEmail(uid);

  // 1. Firebase Auth: scrub identifiers + DISABLE (keep uid, never delete).
  await authAdmin().updateUser(uid, {
    displayName: null,
    photoURL: null,
    phoneNumber: null,
    email,
    disabled: true,
  });
  // 2. Revoke live sessions (same gate as deactivateUser).
  await authAdmin().revokeRefreshTokens(uid);
  // 3. Mark the account anonymized for downstream guards.
  await authAdmin().setCustomUserClaims(uid, { role: 'anonymized', anonymizedAt });

  // 4. Scrub users/{uid} PII (merge: keep functional fields intact).
  const redact: Record<string, unknown> = { email, anonymizedAt };
  for (const field of ANONYMIZATION_USERS_DOC_REDACT) {
    redact[field] = FieldValue.delete();
  }
  await db.collection('users').doc(uid).set(redact, { merge: true });

  // 4b. Scrub the denormalized identity baked into user_stats/{uid}
  // (leaderboard/CV surfaces copy userName/userPhoto at write time).
  await db.collection('user_stats').doc(uid).set(
    {
      userName: FieldValue.delete(),
      userPhoto: FieldValue.delete(),
    },
    { merge: true },
  );

  // 5. Purge PII subcollections.
  const subcollectionsScrubbed: Record<string, number> = {};
  for (const sub of ANONYMIZATION_PII_SUBCOLLECTIONS) {
    subcollectionsScrubbed[sub] = await purgeSubcollection(db, uid, sub);
  }

  // 5b. Redact the user's de-normalized identity on community posts (cross-
  // project `safety_posts` collection group), including their own embedded
  // comments. The posts survive, attributed to an anonymous shell — community
  // history stays intact while the person is de-identified.
  const safetyPostsRedacted = await scrubAuthoredSafetyPosts(db, uid);

  // 5c. Sweep WebAuthn orphans so the disabled / anonymized account leaves
  // no public-key credentials or pending challenges behind. Both live in
  // top-level collections (not subcollections of users/{uid}) so they
  // cannot be reached by the subcollection purge above.
  //
  // We adapt the Admin Firestore handle to the `MinimalCredentialsDb` /
  // `MinimalChallengesDb` interfaces the helpers expect. The adapter is
  // intentionally inline (5 lines per surface) rather than imported so
  // this PR doesn't churn `webauthnFirestoreDb.ts` and keeps the surface
  // narrow. The adapters there remain the canonical path for other
  // call-sites (admin recovery, etc.).
  //
  // Resolves [Audit-2026-08-31] WebAuthn lifecycle — anonymization deja
  // credentials y challenges huérfanos.
  const credentialsDb = wrapFirestoreAsCredentialsDb(db);
  const challengesDb = wrapFirestoreAsChallengesDb(db);
  const webauthnCredentialsDeleted = await deleteCredentialsByUid(
    uid,
    credentialsDb,
  );
  const webauthnChallengesDeleted = await deleteChallengesByUid(
    uid,
    challengesDb,
  );

  const fieldsRedacted = [
    'email',
    'displayName',
    'photoURL',
    'phoneNumber',
    ...ANONYMIZATION_USERS_DOC_REDACT,
    'user_stats.userName',
    'user_stats.userPhoto',
    'safety_posts.userName',
    'safety_posts.userPhoto',
    'safety_posts.comments[].userName',
  ];

  // 6. Immutable proof-of-anonymization (server-only collection from block 1).
  await db.collection('anonymization_events').doc(uid).set({
    dataExportChecksum: input.dataExportChecksum ?? null,
    fieldsRedacted,
    subcollectionsScrubbed,
    safetyPostsRedacted,
    // [Hy3-audit] Resolves [Audit-2026-08-31] WebAuthn lifecycle —
    // anonymization deja credentials y challenges huérfanos. The
    // orphan-sweep counters go on the proof so a regulator can see
    // exactly how many rows the anonymization removed.
    webauthnCredentialsDeleted,
    webauthnChallengesDeleted,
    authDisabled: true,
    createdAt: anonymizedAt,
  });

  return {
    uid,
    anonymizedAt,
    fieldsRedacted,
    subcollectionsScrubbed,
    safetyPostsRedacted,
    webauthnCredentialsDeleted,
    webauthnChallengesDeleted,
    applied: true,
  };
}

/**
 * Inline Adapter: Admin Firestore handle → MinimalCredentialsDb.
 *
 * The `db` injected into `anonymizeUser` is the full Admin SDK handle;
 * the WebAuthn helpers (`deleteCredentialsByUid`) take a
 * `MinimalCredentialsDb` injection so they can be unit-tested with a
 * plain Map. Rather than reach for a second `getFirestore()` handle
 * via `createWebAuthnCredentialsFirestoreDb()`, we adapt the same handle
 * the rest of the workflow uses — keeps the surface narrow and avoids
 * any divergence between the two handles.
 */
function wrapFirestoreAsCredentialsDb(
  db: Firestore,
): import('../../services/auth/webauthnCredentialStore.js').MinimalCredentialsDb {
  const firestore = db;
  return {
    now: () => Date.now(),
    collection(name: string) {
      // Capture `name` and `collection` in the closure scope so the
      // runTransaction body below can rebuild Transaction refs without
      // rescoping (the inner async (transaction) => ... closure
      // doesn't inherit the outer `collection` binding).
      const collRef = firestore.collection(name);
      const collName = name;
      return {
        doc(id: string) {
          const ref = collRef.doc(id);
          const docId = id;
          return {
            async get() {
              const snap = await ref.get();
              return {
                exists: snap.exists,
                id: snap.id,
                data: () =>
                  snap.exists
                    ? (snap.data() as Record<string, unknown>)
                    : undefined,
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data as FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>);
            },
            async update(patch: Record<string, unknown>) {
              await ref.update(patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
            },
            async delete() {
              await ref.delete();
            },
          };
        },
        where(field: string, op: '==', value: unknown) {
          const query = collRef.where(field, op, value);
          return {
            async get() {
              const snap = await query.get();
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({
                  id: d.id,
                  data: () => d.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
    // MinimalCredentialsDb requires runTransaction (used by
    // compareAndSwapCounter for atomic counter bumps). deleteCredentialsByUid
    // doesn't take the transactional path, but the interface demands the
    // hook be present. Delegate to firestore.runTransaction — the same
    // logic the canonical adapter in webauthnFirestoreDb.ts uses.
    async runTransaction<T>(
      updateFn: (
        tx: import('../../services/auth/webauthnCredentialStore.js').TransactionHandle,
      ) => Promise<T>,
    ): Promise<T> {
      return firestore.runTransaction(async (transaction) => {
        return updateFn({
          get: async (docRef: import('../../services/auth/webauthnCredentialStore.js').DocRef) => {
            // The ref's `__docId` and `__collection` (set above by
            // the production adapter — see webauthnFirestoreDb.ts)
            // let us rebuild the underlying Transaction.get ref
            // without bypassing the transaction.
            const collName = (docRef as Record<string, unknown>).__collection as
              | string
              | undefined;
            const id = (docRef.__docId as string) ?? '';
            const ref = firestore
              .collection(collName ?? 'webauthn_credentials')
              .doc(id);
            const snap = await transaction.get(ref);
            return {
              exists: snap.exists,
              id: snap.id,
              data: () =>
                snap.exists
                  ? (snap.data() as Record<string, unknown>)
                  : undefined,
            };
          },
          update: async (
            docRef: import('../../services/auth/webauthnCredentialStore.js').DocRef,
            patch: Record<string, unknown>,
          ) => {
            const collName = (docRef as Record<string, unknown>).__collection as
              | string
              | undefined;
            const id = (docRef.__docId as string) ?? '';
            const ref = firestore
              .collection(collName ?? 'webauthn_credentials')
              .doc(id);
            transaction.update(
              ref,
              patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
            );
          },
          // TransactionHandle intentionally has no `delete` (only get
          // + update). The orphan sweep uses the non-transactional
          // doc().delete() path, so this branch is unreachable.
        });
      });
    },
  };
}

/**
 * Inline Adapter: Admin Firestore handle → MinimalChallengesDb.
 * Mirrors `wrapFirestoreAsCredentialsDb` but for the challenges
 * collection (which has `where`, `delete`, and `updateIf` instead of
 * `update`).
 */
function wrapFirestoreAsChallengesDb(
  db: Firestore,
): import('../../services/auth/webauthnChallenge.js').MinimalChallengesDb {
  // Capture `db` in a local `const` so the `updateIf` closure below
  // sees it (TS would otherwise infer it as the returned adapter
  // object, which doesn't have `runTransaction` and would fail the
  // property check on `MinimalChallengesDb`).
  const firestore = db;
  return {
    now: () => Date.now(),
    collection(name: string) {
      const collection = firestore.collection(name);
      return {
        doc(id: string) {
          const ref = collection.doc(id);
          return {
            async get() {
              const snap = await ref.get();
              return {
                exists: snap.exists,
                id: snap.id,
                data: () =>
                  snap.exists
                    ? (snap.data() as Record<string, unknown>)
                    : undefined,
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data as FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>);
            },
            async updateIf(
              precondition: (current: Record<string, unknown> | undefined) => boolean,
              patch: Record<string, unknown>,
            ): Promise<boolean> {
              return firestore.runTransaction(async (transaction) => {
                const snap = await transaction.get(ref);
                const current = snap.exists
                  ? (snap.data() as Record<string, unknown>)
                  : undefined;
                if (!precondition(current)) return false;
                transaction.update(
                  ref,
                  patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
                );
                return true;
              });
            },
            async delete() {
              await ref.delete();
            },
          };
        },
        where(field: string, op: '==', value: unknown) {
          const query = collection.where(field, op, value);
          return {
            async get() {
              const snap = await query.get();
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({
                  id: d.id,
                  data: () => d.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
  };
}
