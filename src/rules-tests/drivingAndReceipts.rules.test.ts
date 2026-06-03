// SPDX-License-Identifier: MIT
//
// B11 + B6 — driving_incidents and read_receipts rules.
//
// Both are `projects/{pid}/...` client-SDK collections that had NO write rule
// (default-denied in production):
//   • driving_incidents (SafeDriving.tsx) — incident report; the schema has no
//     creator-uid field, so it is member-gated (no anti-spoof), admin/supervisor
//     delete.
//   • read_receipts (readReceiptStore, DS44/RIOHS) — legal acuse that a worker
//     read a document; the worker writes ONLY their own receipt (workerUid ==
//     caller, immutable), never deletable.
// Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-dr-1';
const MEMBER = 'member-uid-1';
const OTHER = 'member-uid-2';
const OUTSIDER = 'outsider-uid-9';
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

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'DR Test Project', members: [MEMBER, OTHER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, coll: string, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, coll, id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seed(coll: string, id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, coll, id), data);
  });
}

const incident = { type: 'speeding', description: 'x', location: 'ruta 5', status: 'Reportado', timestamp: '2026-06-03T00:00:00Z', projectId: PID };
const receipt = (workerUid: string) => ({ documentId: 'doc1', workerUid, status: 'pending', updatedAt: 1 });

describe('driving_incidents — firestore.rules (B11)', () => {
  it('member reports an incident', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'driving_incidents', 'i1'), incident));
  });
  it('non-member cannot report', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'driving_incidents', 'i2'), incident));
  });
  it('member can update an incident', async () => {
    await seed('driving_incidents', 'i3', incident);
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'driving_incidents', 'i3'), { status: 'Cerrado' }, { merge: true }));
  });
  it('member cannot delete; admin can', async () => {
    await seed('driving_incidents', 'i4', incident);
    await assertFails(deleteDoc(ref(authed(MEMBER), 'driving_incidents', 'i4')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'driving_incidents', 'i4')));
  });
});

describe('read_receipts — DS44/RIOHS acuse (B6)', () => {
  it('worker creates their own receipt (workerUid == caller)', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'read_receipts', `doc1__${MEMBER}`), receipt(MEMBER)));
  });
  it('worker cannot forge a receipt as someone else', async () => {
    await assertFails(setDoc(ref(authed(MEMBER), 'read_receipts', `doc1__${OTHER}`), receipt(OTHER)));
  });
  it('non-member cannot write a receipt', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'read_receipts', `doc1__${OUTSIDER}`), receipt(OUTSIDER)));
  });
  it('worker can acknowledge (update) their own receipt', async () => {
    await seed('read_receipts', `doc1__${MEMBER}`, receipt(MEMBER));
    await assertSucceeds(
      setDoc(ref(authed(MEMBER), 'read_receipts', `doc1__${MEMBER}`), { status: 'acknowledged', acknowledgedAt: '2026-06-03T00:00:00Z', updatedAt: 2 }, { merge: true }),
    );
  });
  it('cannot change workerUid on update (no receipt hijack)', async () => {
    await seed('read_receipts', `doc1__${MEMBER}`, receipt(MEMBER));
    await assertFails(
      setDoc(ref(authed(MEMBER), 'read_receipts', `doc1__${MEMBER}`), { workerUid: OTHER }, { merge: true }),
    );
  });
  it('a receipt is never deletable (legal acuse)', async () => {
    await seed('read_receipts', `doc1__${MEMBER}`, receipt(MEMBER));
    await assertFails(deleteDoc(ref(authed(MEMBER), 'read_receipts', `doc1__${MEMBER}`)));
  });
});
