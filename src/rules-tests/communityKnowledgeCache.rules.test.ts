// SPDX-License-Identifier: MIT
//
// `community_knowledge_cache` rules — Phase 5 disconnection hunt #2/#3 (privacy).
// queryCommunityKnowledge previously cached AI answers (and the worker's raw
// free-text risk `prompt`) in the PUBLIC, anonymously-readable
// `community_glossary` (read:if true), so any tenant/anonymous client in the
// same industry could read another tenant's operational free-text. The cache
// now lives here and is SERVER-ONLY (Admin SDK via ragService); no client or
// anonymous actor may read or write it. This suite pins the full default-deny.
// Fail-closed F1 harness (real emulator; cannot be skipped).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const MEMBER = 'member-uid-1';
const ADMIN = 'admin-uid-1';
const DOC_ID = 'cache-1';

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

const cachedDoc = {
  response: 'Límite de ruido 85 dB(A) (DS 594).',
  industry: 'mineria',
  createdAt: '2026-06-16T00:00:00.000Z',
  // No `prompt` — the worker free-text is never stored.
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'community_knowledge_cache', DOC_ID), cachedDoc);
  });
});

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'community_knowledge_cache', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('community_knowledge_cache — server-only (firestore.rules)', () => {
  it('an anonymous client CANNOT read a cached answer', async () => {
    await assertFails(getDoc(ref(anonDb(), DOC_ID)));
  });

  it('an authenticated worker CANNOT read a cached answer (no cross-tenant enumeration)', async () => {
    await assertFails(getDoc(ref(authed(MEMBER), DOC_ID)));
  });

  it('an admin CANNOT read a cached answer (server-only; Admin SDK bypasses rules)', async () => {
    await assertFails(getDoc(ref(authed(ADMIN, 'admin'), DOC_ID)));
  });

  it('a worker CANNOT create a cached answer (no client write path)', async () => {
    await assertFails(setDoc(ref(authed(MEMBER), 'forged-1'), cachedDoc));
  });

  it('an anonymous client CANNOT create a cached answer', async () => {
    await assertFails(setDoc(ref(anonDb(), 'forged-anon'), cachedDoc));
  });

  it('a worker CANNOT update a cached answer (cannot poison the cache)', async () => {
    await assertFails(updateDoc(ref(authed(MEMBER), DOC_ID), { response: 'forged' }));
  });

  it('a worker CANNOT delete a cached answer', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER), DOC_ID)));
  });
});
