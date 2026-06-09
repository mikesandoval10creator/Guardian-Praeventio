// SPDX-License-Identifier: MIT
//
// structural_loads (Bernoulli wind-load inputs) — firestore.rules.
//
// `structuralLoads.ts` (server) and the client probe pipeline persist
// `projects/{pid}/structural_loads/{loadId}` — area/Cp/NCh-432 force limit that
// drive the predictive wind-load alert. This suite pins: a project member
// records inputs (anti-spoof on createdBy, immutable owner), and deleting a
// safety input is restricted to admin/supervisor. Uses the F1 fail-closed
// harness; authenticatedContext only (NEVER the Admin SDK for assertions).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-sl-1';
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
      name: 'SL Project', members: [MEMBER, OTHER], status: 'active',
      createdAt: '2026-06-08T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-08T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function slRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'structural_loads', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
const record = (createdBy: string) => ({
  label: 'Fachada barlovento', areaM2: 20, pressureCoefficient: 0.8,
  maxForceN: 5000, reference: 'NCh 432 Of.71', createdAt: '2026-06-08T00:00:00Z', createdBy,
});
async function seedSl(id: string, createdBy = MEMBER) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'structural_loads', id), record(createdBy));
  });
}

describe('structural_loads — firestore.rules', () => {
  it('member creates a record with createdBy == caller', async () => {
    await assertSucceeds(setDoc(slRef(authed(MEMBER), 'wall-1'), record(MEMBER)));
  });
  it('non-member cannot create a record', async () => {
    await assertFails(setDoc(slRef(authed(OUTSIDER), 'wall-2'), record(OUTSIDER)));
  });
  it('member cannot spoof createdBy (server-field-spoof-deny)', async () => {
    await assertFails(setDoc(slRef(authed(MEMBER), 'wall-3'), record(OTHER)));
  });
  it('member can update keeping createdBy', async () => {
    await seedSl('wall-4', MEMBER);
    await assertSucceeds(setDoc(slRef(authed(MEMBER), 'wall-4'), { areaM2: 25 }, { merge: true }));
  });
  it('cannot change createdBy on update (owner immutable)', async () => {
    await seedSl('wall-5', MEMBER);
    await assertFails(setDoc(slRef(authed(MEMBER), 'wall-5'), { createdBy: OTHER }, { merge: true }));
  });
  it('member cannot delete; admin can', async () => {
    await seedSl('wall-6', MEMBER);
    await assertFails(deleteDoc(slRef(authed(MEMBER), 'wall-6')));
    await assertSucceeds(deleteDoc(slRef(authed(ADMIN, 'admin'), 'wall-6')));
  });
});
