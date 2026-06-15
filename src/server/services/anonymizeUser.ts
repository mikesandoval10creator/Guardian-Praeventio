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

import admin from 'firebase-admin';

/**
 * `users/{uid}` PII fields removed on anonymization (the doc keeps its
 * functional fields — role, tenantConfig, subscription, onboarded — so the
 * shell stays valid against firestore.rules `isValidUser`).
 */
export const ANONYMIZATION_USERS_DOC_REDACT = [
  'display_name',
  'photo_url',
  'notificationPreferences',
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
] as const;

export interface AnonymizeUserDeps {
  authAdmin: typeof admin.auth;
  db: admin.firestore.Firestore;
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
  db: admin.firestore.Firestore,
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
  db: admin.firestore.Firestore,
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
        userPhoto: admin.firestore.FieldValue.delete(),
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
    redact[field] = admin.firestore.FieldValue.delete();
  }
  await db.collection('users').doc(uid).set(redact, { merge: true });

  // 4b. Scrub the denormalized identity baked into user_stats/{uid}
  // (leaderboard/CV surfaces copy userName/userPhoto at write time).
  await db.collection('user_stats').doc(uid).set(
    {
      userName: admin.firestore.FieldValue.delete(),
      userPhoto: admin.firestore.FieldValue.delete(),
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
    authDisabled: true,
    createdAt: anonymizedAt,
  });

  return {
    uid,
    anonymizedAt,
    fieldsRedacted,
    subcollectionsScrubbed,
    safetyPostsRedacted,
    applied: true,
  };
}
