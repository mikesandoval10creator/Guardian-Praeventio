// SPDX-License-Identifier: MIT
//
// B5 — Project documents rules.
//
// `projects/{pid}/documents/{id}` is written by many client-SDK components
// (ReportGenerator, EmergencyPlanGenerator, AddDocumentModal, SusesoReports,
// AssignEPPModal, …) but had NO write rule, so the whole Documents feature
// (reports / emergency plans / EPP & SUSESO docs) was default-denied in
// production. Schemas vary, so the rule is member-gated (no field check);
// F7 (2026-07-02): a project document is legal evidence — NO client deletes
// for anyone (physical removal is server-side + audited). F1 harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-docs-1';
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
      name: 'Docs Project', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), { uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z' });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function docRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'documents', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seed(id: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'documents', id), { title: 'Informe', type: 'report', projectId: PID });
  });
}

const document = { title: 'Informe SUSESO', type: 'report', projectId: PID, createdAt: '2026-06-03T00:00:00Z' };

describe('projects/{pid}/documents — firestore.rules (B5)', () => {
  it('member can create a document', async () => {
    await assertSucceeds(setDoc(docRef(authed(MEMBER), 'd1'), document));
  });
  it('non-member cannot create a document', async () => {
    await assertFails(setDoc(docRef(authed(OUTSIDER), 'd2'), document));
  });
  it('member can update a document', async () => {
    await seed('d3');
    await assertSucceeds(setDoc(docRef(authed(MEMBER), 'd3'), { title: 'Editado' }, { merge: true }));
  });
  it('non-member cannot update a document', async () => {
    await seed('d4');
    await assertFails(setDoc(docRef(authed(OUTSIDER), 'd4'), { title: 'Hack' }, { merge: true }));
  });
  it('F7: NOBODY deletes client-side — member AND admin denied (evidence lock)', async () => {
    await seed('d5');
    await assertFails(deleteDoc(docRef(authed(MEMBER), 'd5')));
    await assertFails(deleteDoc(docRef(authed(ADMIN, 'admin'), 'd5')));
  });
});
