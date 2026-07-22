// SPDX-License-Identifier: MIT
//
// Bucket VV — health_vault + health_vault_shares rules.
//
// `users/{uid}/health_vault/{recordId}` (HealthRecord, medical records) and
// `users/{uid}/health_vault_shares/{tokenId}` (VaultShareToken, QR share tokens)
// had NO write rule -> default-denied, silently breaking the worker's own
// active-shares list read (src/pages/HealthVaultShare.tsx:60). Records are
// server-only (read+write false). Share tokens: owner read only; professional
// access is mediated by the server and never by a global client role.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const WORKER = 'worker-uid-1';
const OTHER = 'worker-uid-2';
const DOCTOR = 'doctor-uid-1';
const ADMIN = 'admin-uid-1';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  testEnv = await createRulesTestEnv();
});
afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});
function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

// Shape mirrors VaultShareToken (src/services/health/vaultShare.ts:18-47)
// as written by the server Admin SDK (healthVault.ts:158-164).
const shareDoc = (workerUid: string) => ({
  id: 'vs_abcd1234_xyz',
  workerUid,
  scope: 'full',
  tokenHash: 'a'.repeat(64),
  tokenPrefix: 'abcd1234',
  createdAt: 1717000000000,
  expiresAt: 1717086400000,
  maxConsumes: 5,
  consumeCount: 0,
  consumes: [],
  revokedAt: null,
});
// Shape mirrors HealthRecord (src/services/health/vaultRecord.ts:34-51).
const recordDoc = (workerUid: string) => ({
  id: 'rec_1',
  workerUid,
  type: 'lab_result',
  uploadedAt: 1717000000000,
  uploadedBy: 'self',
  fileEncryptionKeyId: 'kek/v1',
  meta: { title: 'Hemograma' },
  tags: [],
  shareScope: 'private',
});

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Seed role docs so isAdmin()/isDoctor() resolve via the users doc fallback.
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
    await setDoc(doc(db, 'users', DOCTOR), { uid: DOCTOR, role: 'medico_ocupacional', email: `${DOCTOR}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
    // Server-written share + record on WORKER's vault.
    await setDoc(doc(db, 'users', WORKER, 'health_vault_shares', 'vs_abcd1234_xyz'), shareDoc(WORKER));
    await setDoc(doc(db, 'users', WORKER, 'health_vault', 'rec_1'), recordDoc(WORKER));
    await setDoc(doc(db, 'users', WORKER, 'medical_exams', 'exam-1'), { result: 'private' });
    await setDoc(doc(db, 'users', WORKER, 'morning_checkins', '2026-07-21'), { wellness: 4 });
    await setDoc(doc(db, 'health_professional_identities', DOCTOR), { uid: DOCTOR, status: 'provisional' });
    await setDoc(doc(db, 'health_professional_identity_indexes', 'opaque-hmac'), { uid: DOCTOR });
    await setDoc(doc(db, 'health_vault_access_sessions', 'session-1'), { professionalUid: DOCTOR });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function authed(uid: string, role = 'worker') {
  // For the worker the token role is irrelevant (isOwner gates on uid); for
  // doctor/admin we pass the role claim so isDoctor()/isAdmin() short-circuit.
  return requireEnv().authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`)).firestore();
}
function shareRef(db: CtxDb, owner = WORKER) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'users', owner, 'health_vault_shares', 'vs_abcd1234_xyz');
}
function recordRef(db: CtxDb, owner = WORKER) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'users', owner, 'health_vault', 'rec_1');
}

describe('health_vault_shares — firestore.rules (Bucket VV)', () => {
  it('owner reads their own share (active-shares list, HealthVaultShare.tsx:60)', async () => {
    await assertSucceeds(getDoc(shareRef(authed(WORKER))));
  });
  it('occupational doctor CANNOT read a worker share directly', async () => {
    await assertFails(getDoc(shareRef(authed(DOCTOR, 'medico_ocupacional'))));
  });
  it('admin CANNOT read a worker share directly', async () => {
    await assertFails(getDoc(shareRef(authed(ADMIN, 'admin'))));
  });
  it('another worker CANNOT read someone else\'s share (non-owner-deny)', async () => {
    await assertFails(getDoc(shareRef(authed(OTHER))));
  });
  it('owner CANNOT create a share from the client (server-only write)', async () => {
    const env = requireEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'users', WORKER, 'health_vault_shares', 'vs_abcd1234_xyz'));
    });
    await assertFails(setDoc(shareRef(authed(WORKER)), shareDoc(WORKER)));
  });
  it('owner CANNOT forge revoke/consume state on a share (client write-deny)', async () => {
    // Anti-tamper: only the server mutates revokedAt/consumeCount.
    await assertFails(updateDoc(shareRef(authed(WORKER)), { revokedAt: null, consumeCount: 0 }));
  });
  it('owner CANNOT delete a share from the client (immutable)', async () => {
    await assertFails(deleteDoc(shareRef(authed(WORKER))));
  });
});

describe('health_vault records — firestore.rules (Bucket VV)', () => {
  it('owner CANNOT read their own medical records from the client (server-only)', async () => {
    // The only read path is the server /view endpoint gated on a share secret.
    await assertFails(getDoc(recordRef(authed(WORKER))));
  });
  it('owner CANNOT write a medical record from the client', async () => {
    await assertFails(updateDoc(recordRef(authed(WORKER)), { 'meta.title': 'tampered' }));
  });
  it('another worker CANNOT read a victim\'s medical records', async () => {
    await assertFails(getDoc(recordRef(authed(OTHER), 'worker')));
  });
  it('a global occupational doctor CANNOT read a victim medical record', async () => {
    await assertFails(getDoc(recordRef(authed(DOCTOR, 'medico_ocupacional'))));
  });
});

describe('personal clinical collections — server-mediated professional access', () => {
  it('owner keeps read access to their medical exam', async () => {
    const db = authed(WORKER);
    await assertSucceeds(getDoc(doc(db as any, 'users', WORKER, 'medical_exams', 'exam-1')));
  });
  it('doctor cannot read or write another user medical exam through Client SDK', async () => {
    const db = authed(DOCTOR, 'medico_ocupacional');
    const ref = doc(db as any, 'users', WORKER, 'medical_exams', 'exam-1');
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { result: 'changed' }));
  });
  it('owner keeps morning check-in access while a doctor cannot read it directly', async () => {
    const ownerRef = doc(authed(WORKER) as any, 'users', WORKER, 'morning_checkins', '2026-07-21');
    const doctorRef = doc(authed(DOCTOR, 'medico_ocupacional') as any, 'users', WORKER, 'morning_checkins', '2026-07-21');
    await assertSucceeds(getDoc(ownerRef));
    await assertFails(getDoc(doctorRef));
  });
});

describe('professional identity and access session collections are server-only', () => {
  it.each([
    ['health_professional_identities', DOCTOR],
    ['health_professional_identity_indexes', 'opaque-hmac'],
    ['health_vault_access_sessions', 'session-1'],
  ])('denies client reads and writes for %s', async (collectionName, id) => {
    const db = authed(DOCTOR, 'medico_ocupacional');
    const ref = doc(db as any, collectionName, id);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { tampered: true }));
  });
});
