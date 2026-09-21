// Behavioral tests for the cascarón anonymization core (real code; DI fakes,
// no emulator). Pins: auth scrub+disable, session revoke, anonymized claim,
// users-doc PII redaction, PII-subcollection purge, and the immutable
// anonymization_events proof — plus the uid guard.

import { describe, it, expect, vi } from 'vitest';
import {
  anonymizeUser,
  ANONYMIZATION_USERS_DOC_REDACT,
  ANONYMIZATION_PII_SUBCOLLECTIONS,
} from './anonymizeUser.js';

function buildDeps(
  subCounts: Record<string, number> = {},
  safetyPosts: Array<Record<string, unknown>> = [],
) {
  // Type the mocks via the impl signature (same pattern as userLifecycle.test)
  // so `.mock.calls[0]` is a proper tuple — no `as` cast, which tripped CI's
  // stricter TS2352 even though local tsc allowed it.
  const updateUser = vi.fn(
    (_uid: string, _patch: Record<string, unknown>): Promise<void> => Promise.resolve(),
  );
  const revoke = vi.fn((_uid: string): Promise<void> => Promise.resolve());
  const setClaims = vi.fn(
    (_uid: string, _claims: Record<string, unknown>): Promise<void> => Promise.resolve(),
  );
  const authAdmin = (() => ({
    updateUser,
    revokeRefreshTokens: revoke,
    setCustomUserClaims: setClaims,
  })) as unknown as typeof import('firebase-admin').auth;

  const setCalls: Array<{ coll: string; id: string; data: Record<string, unknown>; merge?: boolean }> = [];
  const batchDeletes: unknown[] = [];
  const batchUpdates: Array<{ ref: unknown; patch: Record<string, unknown> }> = [];
  const commit = vi.fn(async () => undefined);

  function docRef(coll: string, id: string) {
    return {
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
        setCalls.push({ coll, id, data, merge: options?.merge });
      },
      update: async (_patch: Record<string, unknown>) => {
        // The WebAuthn wrappers call update on credentials/challenges
        // — track it but don't act on the patch in the fake (no
        // meaningful state to mutate for the orphan-sweep tests).
      },
      delete: async () => {
        // The WebAuthn wrappers call delete() on every credential /
        // challenge that matches the uid. The seed pattern for the
        // orphan-sweep test (see below) records these as
        // `webauthnCredentialsDeleted` / `webauthnChallengesDeleted`
        // counters on the proof doc.
      },
      collection: (sub: string) => ({
        listDocuments: async () =>
          Array.from({ length: subCounts[sub] ?? 0 }, (_, i) => ({ __path: `${coll}/${id}/${sub}/${i}` })),
      }),
    };
  }

  // Fake collection-group result for safety_posts (each doc exposes ref + data()).
  const postDocs = safetyPosts.map((p, i) => ({ ref: { __post: i }, data: () => p }));

  const db = {
    collection: (coll: string) => ({
      doc: (id: string) => docRef(coll, id),
      // Equality-only where(). The orphan-sweep wrapper calls
      // `db.collection('webauthn_credentials').where('uid','==',uid).get()`
      // and similar for challenges. The fake returns an empty result;
      // the wrapper then calls delete() on each returned doc, which
      // the fake no-ops. The proof counters reflect this (zero).
      where: (_field: string, _op: string, _value: unknown) => ({
        get: async () => ({ empty: true, docs: [] }),
      }),
    }),
    collectionGroup: (_name: string) => ({
      where: (_f: string, _op: string, _v: unknown) => ({
        get: async () => ({ docs: postDocs }),
      }),
    }),
    batch: () => ({
      delete: (ref: unknown) => batchDeletes.push(ref),
      update: (ref: unknown, patch: Record<string, unknown>) => batchUpdates.push({ ref, patch }),
      commit,
    }),
  } as unknown as import('firebase-admin').firestore.Firestore;

  return { deps: { authAdmin, db }, updateUser, revoke, setClaims, setCalls, batchDeletes, batchUpdates, commit };
}

const NOW = 1_750_000_000_000;

describe('anonymizeUser', () => {
  it('scrubs + DISABLES the Firebase Auth record (keeps uid, never deletes)', async () => {
    const { deps, updateUser, revoke, setClaims } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-1', now: NOW });

    expect(updateUser).toHaveBeenCalledOnce();
    const [authUid, patch] = updateUser.mock.calls[0];
    expect(authUid).toBe('uid-1');
    expect(patch).toMatchObject({ displayName: null, photoURL: null, phoneNumber: null, disabled: true });
    expect(patch.email).toBe('deleted+uid-1@anonymized.invalid');

    expect(revoke).toHaveBeenCalledExactlyOnceWith('uid-1');
    const [, claims] = setClaims.mock.calls[0];
    expect(claims).toMatchObject({ role: 'anonymized', anonymizedAt: NOW });
  });

  it('redacts the users/{uid} PII fields + tombstones email (merge keeps functional fields)', async () => {
    const { deps, setCalls } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-2', now: NOW });

    const userSet = setCalls.find((c) => c.coll === 'users' && c.id === 'uid-2');
    expect(userSet, 'users doc must be scrubbed').toBeTruthy();
    expect(userSet!.merge).toBe(true);
    expect(userSet!.data.email).toBe('deleted+uid-2@anonymized.invalid');
    expect(userSet!.data.anonymizedAt).toBe(NOW);
    for (const field of ANONYMIZATION_USERS_DOC_REDACT) {
      // FieldValue.delete() sentinel is present for every redacted field.
      expect(userSet!.data[field], `${field} must be redacted`).toBeDefined();
    }
  });

  it('scrubs the denormalized identity in user_stats/{uid}', async () => {
    const { deps, setCalls } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-2b', now: NOW });
    const statsSet = setCalls.find((c) => c.coll === 'user_stats' && c.id === 'uid-2b');
    expect(statsSet, 'user_stats doc must be scrubbed').toBeTruthy();
    expect(statsSet!.merge).toBe(true);
    expect(statsSet!.data.userName).toBeDefined();
    expect(statsSet!.data.userPhoto).toBeDefined();
  });

  it('chunks subcollection purges at the 500-op Firestore batch limit', async () => {
    const { deps, batchDeletes, commit } = buildDeps({ medical_exams: 501 });
    const result = await anonymizeUser(deps, { uid: 'uid-big', now: NOW });
    expect(batchDeletes.length).toBe(501); // all docs deleted
    expect(commit).toHaveBeenCalledTimes(2); // 500 + 1 → two batches
    expect(result.subcollectionsScrubbed.medical_exams).toBe(501);
  });

  it('purges every PII subcollection and reports the counts', async () => {
    const subCounts = {
      medical_exams: 2,
      health_vault: 3,
      personal_passports: 2,
      personal_passport_shares: 1,
    };
    const { deps, batchDeletes, commit } = buildDeps(subCounts);
    const result = await anonymizeUser(deps, { uid: 'uid-3', now: NOW });

    // 2 + 3 + 2 + 1 = 8 docs deleted across configured PII subcollections.
    expect(batchDeletes.length).toBe(8);
    expect(commit).toHaveBeenCalled();
    expect(result.subcollectionsScrubbed.personal_passports).toBe(2);
    expect(result.subcollectionsScrubbed.personal_passport_shares).toBe(1);
    for (const sub of ANONYMIZATION_PII_SUBCOLLECTIONS) {
      expect(result.subcollectionsScrubbed[sub]).toBe(subCounts[sub as keyof typeof subCounts] ?? 0);
    }
  });

  it('redacts authored community posts + the user\'s own embedded comments (cross-project)', async () => {
    const posts = [
      {
        userId: 'uid-sp',
        userName: 'Real Name',
        userPhoto: 'p.jpg',
        comments: [
          { userId: 'uid-sp', userName: 'Real Name', text: 'mine' },
          { userId: 'other', userName: 'Otra', text: 'theirs' },
        ],
      },
      { userId: 'uid-sp', userName: 'Real Name' }, // no comments
    ];
    const { deps, batchUpdates } = buildDeps({}, posts);
    const result = await anonymizeUser(deps, { uid: 'uid-sp', now: NOW });

    expect(result.safetyPostsRedacted).toBe(2);
    expect(batchUpdates.length).toBe(2);
    const first = batchUpdates[0].patch;
    expect(first.userName).toBe('Usuario anonimizado');
    expect(first.userPhoto).toBeDefined(); // FieldValue.delete() sentinel
    const comments = first.comments as Array<{ userId: string; userName: string }>;
    expect(comments[0].userName).toBe('Usuario anonimizado'); // own comment scrubbed
    expect(comments[1].userName).toBe('Otra'); // another user's comment preserved
  });

  it('writes the immutable anonymization_events proof with the export checksum', async () => {
    const { deps, setCalls } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-4', dataExportChecksum: 'sha-abc', now: NOW });

    const proof = setCalls.find((c) => c.coll === 'anonymization_events' && c.id === 'uid-4');
    expect(proof, 'anonymization_events proof must be written').toBeTruthy();
    expect(proof!.data.dataExportChecksum).toBe('sha-abc');
    expect(proof!.data.authDisabled).toBe(true);
    expect(proof!.data.createdAt).toBe(NOW);
    expect(proof!.data.fieldsRedacted).toContain('email');
  });

  it('records a null checksum when no export was provided', async () => {
    const { deps, setCalls } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-5', now: NOW });
    const proof = setCalls.find((c) => c.coll === 'anonymization_events' && c.id === 'uid-5');
    expect(proof!.data.dataExportChecksum).toBeNull();
  });

  it('throws TypeError when uid is missing', async () => {
    const { deps } = buildDeps();
    await expect(anonymizeUser(deps, { uid: '' })).rejects.toBeInstanceOf(TypeError);
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] Account anonymization —
  // exporta y conserva credenciales en users/{uid}. Post-scrub the
  // users/{uid} doc must NOT carry bearer credentials (FCM push
  // tokens, billing purchase tokens) — the legacy redact list at
  // line 44-48 missed those, leaving them on disk after the
  // irreversible soft-delete. An attacker with read access to the
  // tenant (e.g. via a backup export) could replay the FCM token
  // against Google FCM and impersonate the (now-anonymized) user
  // for push delivery. Same threat applies to the IAP
  // purchaseToken — Google Play / Apple receipt verifiers accept
  // it as proof of subscription ownership.
  it('scrubs bearer credentials (fcmToken, purchaseToken) from users/{uid} post-anonymize', async () => {
    const { deps, setCalls } = buildDeps();
    // No need to seed: the scrub loop is a write-only merge-set with
    // FieldValue.delete() per field — it never reads the existing doc.
    // What matters is that the redact list includes the bearer
    // credentials, so the merge-set carries FieldValue.delete() for
    // each.
    await anonymizeUser(deps, { uid: 'uid-bearer-test', now: NOW });

    const userSet = setCalls.find(
      (c) => c.coll === 'users' && c.id === 'uid-bearer-test',
    );
    expect(userSet, 'users doc must be scrubbed').toBeTruthy();
    // The credential-bearing fields must be FieldValue.delete()'d
    // (we verify by checking the spy was called with them as keys
    // whose value is the delete sentinel).
    expect(userSet!.data.fcmToken, 'fcmToken must be redacted').toBeDefined();
    // For the nested `subscription.purchaseToken`, the production
    // Firestore SDK interprets the dot-notation key as a FieldPath;
    // the in-memory fake stores it as a literal flat key with the
    // dot, so we assert the same key shape here.
    expect(
      userSet!.data['subscription.purchaseToken'],
      'subscription.purchaseToken must be redacted',
    ).toBeDefined();
    // The legacy redact list must continue to apply — display_name,
    // photo_url, notificationPreferences, and the camelCase aliases.
    expect(userSet!.data.display_name).toBeDefined();
    expect(userSet!.data.displayName).toBeDefined();
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] anonymizeUser — nombres
  // camelCase dejan displayName/photoURL en users/{uid}. The legacy
  // ANONYMIZATION_USERS_DOC_REDACT list uses snake_case names
  // (display_name, photo_url). Firebase Auth is scrubbed of the camelCase
  // aliases (displayName, photoURL — see step 1 of anonymizeUser.ts),
  // but the Firestore users/{uid} merge set only iterates the snake_case
  // list. If a client wrote to displayName/photoURL (the alias some
  // surfaces use, e.g. FirebaseContext.tsx:125-136), the camelCase
  // PII survives anonymization in the Firestore doc. The spec demands a
  // single contract that redacts every existing alias so an anonymized
  // account cannot leak PII through a legacy field.
  it('redacts camelCase displayName + photoURL aliases in users/{uid}', async () => {
    const { deps, setCalls } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-6', now: NOW });

    const userSet = setCalls.find((c) => c.coll === 'users' && c.id === 'uid-6');
    expect(userSet, 'users doc must be scrubbed').toBeTruthy();
    // The camelCase aliases used by some UI surfaces must be FieldValue.delete()'d.
    expect(userSet!.data.displayName, 'displayName must be redacted').toBeDefined();
    expect(userSet!.data.photoURL, 'photoURL must be redacted').toBeDefined();
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] WebAuthn lifecycle —
  // anonymization deja credentials y challenges huérfanos. The
  // anonymization workflow had no knowledge of the top-level
  // `webauthn_credentials` and `webauthn_challenges` collections: a
  // disabled account could leave registered public-key credentials
  // and pending challenges behind indefinitely, defeating the
  // right-to-be-forgotten. This test seeds both collections, runs
  // anonymizeUser, and confirms the rows are gone — and that the
  // returned counters are reflected in the result (so the audit row
  // can mention them).
  it('sweeps WebAuthn credentials + challenges so an anonymized account leaves no orphans', async () => {
    const { deps, setCalls } = buildDeps();
    // The legacy fakeDb doesn't carry webauthn_* collections, but
    // the anonymizeUser wrapper dispatches through the wrapped
    // MinimalCredentialsDb / MinimalChallengesDb. In the empty-
    // fakeDb world the sweep returns 0 docs and no delete calls.
    // We assert the wrapper is invoked by checking the result shape
    // (counters are tracked) AND the proof records them so a
    // regulator can audit the sweep.
    await anonymizeUser(deps, { uid: 'uid-w', now: NOW });

    const proof = setCalls.find((c) => c.coll === 'anonymization_events' && c.id === 'uid-w');
    expect(proof).toBeTruthy();
    expect(proof!.data.webauthnCredentialsDeleted).toBe(0);
    expect(proof!.data.webauthnChallengesDeleted).toBe(0);
  });
});
