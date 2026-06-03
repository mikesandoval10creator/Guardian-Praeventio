// SPDX-License-Identifier: MIT
//
// B3 + B-DigitalTwin — findings and placed_objects rules.
//
// Two project-scoped client-SDK collections that had NO write rule
// (default-denied in production):
//   • projects/{pid}/findings (BioAnalysis / Hallazgos) — safety finding; the
//     schema carries `reportedBy` (display name, not a uid) → member-gated.
//   • projects/{pid}/placed_objects (digital-twin hazards/equipment) — member
//     places objects in the 3D twin; safety objects must persist.
// Both: member-gated create/update; admin/supervisor delete. Reads via the
// project sub-collection master-gate. Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-fp-1';
const MEMBER = 'member-uid-1';
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
      name: 'FP Project', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
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

const finding = { title: 'Hallazgo', description: 'x', type: 'Condición Subestándar', status: 'Abierto', priority: 'Alta', projectId: PID, reportedBy: 'Juan' };
const placed = { id: 'obj-1', type: 'hazard', position: { x: 1, y: 2, z: 0 } };

describe.each([
  { coll: 'findings', label: 'findings (BioAnalysis, B3)', data: finding },
  { coll: 'placed_objects', label: 'placed_objects (digital twin, B-DigitalTwin)', data: placed },
])('$label — firestore.rules', ({ coll, data }) => {
  it('member can create', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), coll, 'a1'), data));
  });
  it('non-member cannot create', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), coll, 'a2'), data));
  });
  it('member can update', async () => {
    await seed(coll, 'a3', data);
    await assertSucceeds(setDoc(ref(authed(MEMBER), coll, 'a3'), { status: 'Cerrado' }, { merge: true }));
  });
  it('non-member cannot update', async () => {
    await seed(coll, 'a4', data);
    await assertFails(setDoc(ref(authed(OUTSIDER), coll, 'a4'), { status: 'Cerrado' }, { merge: true }));
  });
  it('member cannot delete; admin can', async () => {
    await seed(coll, 'a5', data);
    await assertFails(deleteDoc(ref(authed(MEMBER), coll, 'a5')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), coll, 'a5')));
  });
});
