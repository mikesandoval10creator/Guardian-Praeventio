// SPDX-License-Identifier: MIT
//
// OLA 2 — cascarón soft-delete (Ley 21.719): anonymization_events rules.
//
// Path: anonymization_events/{uid} — ONE immutable record per user proving
// their data was exported (checksum) before irreversible PII anonymization.
// Written ONLY by the Admin SDK (the account-anonymize endpoint); clients
// NEVER write. The OWNER may read their own record (proof of export); every
// client write is denied so the record can't be forged or erased.
// (CLAUDE.md #4 — ≥5 rules-tests; Dirty Dozen #118-120 in security_spec.md.)
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds the server-written doc.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const UID = 'user-anon-1';
const OTHER_UID = 'user-anon-2';

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

function authed(uid: string) {
  return requireEnv()
    .authenticatedContext(uid, verifiedToken('worker', `${uid}@example.com`))
    .firestore();
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, uid: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'anonymization_events', uid);
}

async function seed(uid = UID) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'anonymization_events', uid), {
      dataExportChecksum: 'abc123',
      fieldsRedacted: ['email', 'displayName'],
      authDisabled: true,
      createdAt: '2026-06-15T00:00:00.000Z',
    });
  });
}

describe('anonymization_events — firestore.rules (cascarón soft-delete)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  it('owner-read — a user CAN read their own anonymization record', async () => {
    await seed();
    await assertSucceeds(getDoc(ref(authed(UID), UID)));
  });

  it('cross-user deny — another user CANNOT read someone else\'s record', async () => {
    await seed();
    await assertFails(getDoc(ref(authed(OTHER_UID), UID)));
  });

  it('unauthenticated deny — an anonymous client CANNOT read', async () => {
    await seed();
    const anon = requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
    await assertFails(getDoc(ref(anon, UID)));
  });

  it('server-only — the owner CANNOT create their own record (Admin SDK only)', async () => {
    await assertFails(setDoc(ref(authed(UID), UID), { dataExportChecksum: 'forged' }));
  });

  it('server-only — the owner CANNOT update the record (no tampering with the export proof)', async () => {
    await seed();
    await assertFails(updateDoc(ref(authed(UID), UID), { dataExportChecksum: 'tampered' }));
  });

  it('immutable — the owner CANNOT delete the record (the audit trail must survive)', async () => {
    await seed();
    await assertFails(deleteDoc(ref(authed(UID), UID)));
  });
});
