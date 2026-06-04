// SPDX-License-Identifier: MIT
//
// B7 — clinical_alerts rules.
//
// `projects/{pid}/clinical_alerts/{id}` is written by VitalityMonitor (worker's
// device) but had NO write rule → default-denied. Post ADR-0012 reconversion the
// docs hold NON-diagnostic safety recommendations (signal + recommendation), not
// CIE-10 codes. This suite pins: a project member records their own alert
// (anti-spoof on createdBy, immutable owner); deleting a safety alert is
// admin/supervisor only. Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-ca-1';
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
      name: 'CA Project', members: [MEMBER, OTHER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function caRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'clinical_alerts', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
const alert = (createdBy: string) => ({
  createdBy, severity: 'high', signal: 'Frecuencia cardíaca alta sostenida',
  recommendation: 'Haz una pausa e hidrátate.', temperature: 32,
});
async function seed(id: string, createdBy = MEMBER) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'clinical_alerts', id), alert(createdBy));
  });
}

describe('clinical_alerts (non-diagnostic safety alerts) — firestore.rules (B7)', () => {
  it('member records their own alert (createdBy == caller)', async () => {
    await assertSucceeds(setDoc(caRef(authed(MEMBER), 'a1'), alert(MEMBER)));
  });
  it('non-member cannot record an alert', async () => {
    await assertFails(setDoc(caRef(authed(OUTSIDER), 'a2'), alert(OUTSIDER)));
  });
  it('member cannot spoof createdBy (server-field-spoof-deny)', async () => {
    await assertFails(setDoc(caRef(authed(MEMBER), 'a3'), alert(OTHER)));
  });
  it('member can update their own alert keeping createdBy', async () => {
    await seed('a4', MEMBER);
    await assertSucceeds(setDoc(caRef(authed(MEMBER), 'a4'), { severity: 'medium' }, { merge: true }));
  });
  it('cannot change createdBy on update', async () => {
    await seed('a5', MEMBER);
    await assertFails(setDoc(caRef(authed(MEMBER), 'a5'), { createdBy: OTHER }, { merge: true }));
  });
  it('member cannot delete; admin can', async () => {
    await seed('a6', MEMBER);
    await assertFails(deleteDoc(caRef(authed(MEMBER), 'a6')));
    await assertSucceeds(deleteDoc(caRef(authed(ADMIN, 'admin'), 'a6')));
  });
});
