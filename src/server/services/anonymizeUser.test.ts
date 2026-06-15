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

function buildDeps(subCounts: Record<string, number> = {}) {
  const updateUser = vi.fn(async () => undefined);
  const revoke = vi.fn(async () => undefined);
  const setClaims = vi.fn(async () => undefined);
  const authAdmin = (() => ({
    updateUser,
    revokeRefreshTokens: revoke,
    setCustomUserClaims: setClaims,
  })) as unknown as typeof import('firebase-admin').auth;

  const setCalls: Array<{ coll: string; id: string; data: Record<string, unknown>; merge?: boolean }> = [];
  const batchDeletes: unknown[] = [];
  const commit = vi.fn(async () => undefined);

  function docRef(coll: string, id: string) {
    return {
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
        setCalls.push({ coll, id, data, merge: options?.merge });
      },
      collection: (sub: string) => ({
        listDocuments: async () =>
          Array.from({ length: subCounts[sub] ?? 0 }, (_, i) => ({ __path: `${coll}/${id}/${sub}/${i}` })),
      }),
    };
  }

  const db = {
    collection: (coll: string) => ({ doc: (id: string) => docRef(coll, id) }),
    batch: () => ({ delete: (ref: unknown) => batchDeletes.push(ref), commit }),
  } as unknown as import('firebase-admin').firestore.Firestore;

  return { deps: { authAdmin, db }, updateUser, revoke, setClaims, setCalls, batchDeletes, commit };
}

const NOW = 1_750_000_000_000;

describe('anonymizeUser', () => {
  it('scrubs + DISABLES the Firebase Auth record (keeps uid, never deletes)', async () => {
    const { deps, updateUser, revoke, setClaims } = buildDeps();
    await anonymizeUser(deps, { uid: 'uid-1', now: NOW });

    expect(updateUser).toHaveBeenCalledOnce();
    const [authUid, patch] = updateUser.mock.calls[0] as [string, Record<string, unknown>];
    expect(authUid).toBe('uid-1');
    expect(patch).toMatchObject({ displayName: null, photoURL: null, disabled: true });
    expect(patch.email).toBe('deleted+uid-1@anonymized.invalid');

    expect(revoke).toHaveBeenCalledExactlyOnceWith('uid-1');
    const [, claims] = setClaims.mock.calls[0] as [string, Record<string, unknown>];
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

  it('purges every PII subcollection and reports the counts', async () => {
    const subCounts = { medical_exams: 2, health_vault: 3 };
    const { deps, batchDeletes, commit } = buildDeps(subCounts);
    const result = await anonymizeUser(deps, { uid: 'uid-3', now: NOW });

    // 2 + 3 = 5 docs deleted across the configured subcollections.
    expect(batchDeletes.length).toBe(5);
    expect(commit).toHaveBeenCalled();
    for (const sub of ANONYMIZATION_PII_SUBCOLLECTIONS) {
      expect(result.subcollectionsScrubbed[sub]).toBe(subCounts[sub as keyof typeof subCounts] ?? 0);
    }
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
});
