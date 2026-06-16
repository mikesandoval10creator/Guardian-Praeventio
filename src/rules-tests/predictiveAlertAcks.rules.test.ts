// SPDX-License-Identifier: MIT
//
// OLA 2 — close the default-deny gap on predictive_alert_acks.
//
// Path: predictive_alert_acks/{ackId} — a server-only audit trail of a crew
// acknowledging a predictive alert. Written ONLY by the Admin SDK from
// /api/organic (organic.ts), with `ackedBy` stamped from the verified token and
// `xpAwarded` recorded. NO client access: a client write could forge `ackedBy`
// or inflate `xpAwarded` (XP-integrity), and nothing reads it client-side
// today. This suite pins the total client denial (read + every write op).
// (CLAUDE.md #4 — ≥5 rules-tests; Dirty Dozen in security_spec.md.)
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

const UID = 'acker-1';
const OTHER_UID = 'acker-2';
const ACK_ID = 'ack-doc-1';

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
function ref(ctxDb: CtxDb, ackId = ACK_ID) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'predictive_alert_acks', ackId);
}

const ackDoc = {
  projectId: 'proj-1',
  crewId: 'crew-1',
  generatorId: 'gen-1',
  ackedBy: UID,
  ackedAt: '2026-06-15T00:00:00.000Z',
  xpAwarded: 10,
};

async function seed(ackId = ACK_ID) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'predictive_alert_acks', ackId), ackDoc);
  });
}

describe('predictive_alert_acks — firestore.rules (server-only audit trail)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
  });

  it('server-only read — even the acker CANNOT read their own ack (no client reader yet)', async () => {
    await seed();
    await assertFails(getDoc(ref(authed(UID))));
  });

  it('cross-user read deny — another authenticated user CANNOT read the ack', async () => {
    await seed();
    await assertFails(getDoc(ref(authed(OTHER_UID))));
  });

  it('unauthenticated read deny — an anonymous client CANNOT read', async () => {
    await seed();
    const anon = requireEnv().unauthenticatedContext().firestore() as unknown as CtxDb;
    await assertFails(getDoc(ref(anon)));
  });

  it('server-only create — a client CANNOT forge an ack (xpAwarded / ackedBy spoof vector)', async () => {
    await assertFails(
      setDoc(ref(authed(UID)), { ...ackDoc, ackedBy: UID, xpAwarded: 9999 }),
    );
  });

  it('server-only update — a client CANNOT tamper with an existing ack', async () => {
    await seed();
    await assertFails(updateDoc(ref(authed(UID)), { xpAwarded: 9999 }));
  });

  it('immutable — a client CANNOT delete an ack (the audit trail must survive)', async () => {
    await seed();
    await assertFails(deleteDoc(ref(authed(UID))));
  });
});
