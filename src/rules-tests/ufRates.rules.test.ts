// SPDX-License-Identifier: MIT
//
// UF rate cache — server-only collection.
//
// Path: ufRates/{docId} (e.g. ufRates/current) — the cached Unidad de Fomento
// value, written ONLY by the daily runUfRateRefresh cron (Admin SDK) from
// public Banco Central data. The pricing layer reads it SERVER-SIDE to compute
// the Diamante tier's CLP amount; no client touches it. A client write could
// forge the rate and mis-price the tier, so every client op is denied.
// (CLAUDE.md #4 — >=5 rules-tests; Dirty Dozen in security_spec.md.)
//
// F1 fail-closed harness + authenticatedContext (NEVER the Admin SDK in an
// assertion). withSecurityRulesDisabled only seeds the server-written doc.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const UID = 'uf-reader-1';
const DOC_ID = 'current';

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
function ref(ctxDb: CtxDb, docId = DOC_ID) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'ufRates', docId);
}

const rateDoc = { valueClp: 38500, date: '2026-06-16', source: 'mindicador.cl' };

async function seed(docId = DOC_ID) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'ufRates', docId), rateDoc);
  });
}

describe('ufRates — firestore.rules (server-only UF rate cache)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  it('server-only read — an authenticated client CANNOT read the cached rate', async () => {
    await seed();
    await assertFails(getDoc(ref(authed(UID))));
  });

  it('unauthenticated read deny — an anonymous client CANNOT read', async () => {
    await seed();
    const anon = requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
    await assertFails(getDoc(ref(anon)));
  });

  it('server-only create — a client CANNOT forge a UF rate (tier mis-pricing vector)', async () => {
    await assertFails(setDoc(ref(authed(UID)), { valueClp: 1, date: '2026-06-16' }));
  });

  it('server-only update — a client CANNOT tamper with the cached rate', async () => {
    await seed();
    await assertFails(updateDoc(ref(authed(UID)), { valueClp: 1 }));
  });

  it('server-only delete — a client CANNOT delete the cached rate', async () => {
    await seed();
    await assertFails(deleteDoc(ref(authed(UID))));
  });
});
