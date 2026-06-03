// SPDX-License-Identifier: MIT
//
// B2 — Critical-control validation rules (DS44 — controles críticos).
//
// `controlValidationsStore.saveControlValidation` writes
// `projects/{pid}/control_validations/{controlId__taskId}` via the CLIENT SDK,
// but the collection had NO write rule → every "I verified this critical safety
// control" record was default-denied. This suite pins: a project member records
// a validation (anti-spoof on validatedByUid, immutable owner), and deleting a
// safety validation is restricted to admin/supervisor. Uses the F1 harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-cc-1';
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
      name: 'CC Test Project', members: [MEMBER, OTHER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function cvRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'control_validations', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
const validation = (validatedByUid: string) => ({
  controlId: 'ctrl-1', present: true, validatedByUid,
  validatedAt: '2026-06-03T00:00:00Z', projectId: PID, taskId: 'task-1', updatedAt: 1,
});
async function seedCv(id: string, validatedByUid = MEMBER) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'control_validations', id), validation(validatedByUid));
  });
}

describe('control_validations (critical controls, DS44) — firestore.rules (B2)', () => {
  it('member records a validation with validatedByUid == caller', async () => {
    await assertSucceeds(setDoc(cvRef(authed(MEMBER), 'ctrl-1__task-1'), validation(MEMBER)));
  });
  it('non-member cannot record a validation', async () => {
    await assertFails(setDoc(cvRef(authed(OUTSIDER), 'ctrl-1__task-2'), validation(OUTSIDER)));
  });
  it('member cannot spoof validatedByUid (server-field-spoof-deny)', async () => {
    await assertFails(setDoc(cvRef(authed(MEMBER), 'ctrl-1__task-3'), validation(OTHER)));
  });
  it('member can update their validation keeping validatedByUid', async () => {
    await seedCv('ctrl-1__task-4', MEMBER);
    await assertSucceeds(
      setDoc(cvRef(authed(MEMBER), 'ctrl-1__task-4'), { present: false, updatedAt: 2 }, { merge: true }),
    );
  });
  it('cannot change validatedByUid on update', async () => {
    await seedCv('ctrl-1__task-5', MEMBER);
    await assertFails(
      setDoc(cvRef(authed(MEMBER), 'ctrl-1__task-5'), { validatedByUid: OTHER }, { merge: true }),
    );
  });
  it('member cannot delete a validation; admin can', async () => {
    await seedCv('ctrl-1__task-6', MEMBER);
    await assertFails(deleteDoc(cvRef(authed(MEMBER), 'ctrl-1__task-6')));
    await assertSucceeds(deleteDoc(cvRef(authed(ADMIN, 'admin'), 'ctrl-1__task-6')));
  });
});
