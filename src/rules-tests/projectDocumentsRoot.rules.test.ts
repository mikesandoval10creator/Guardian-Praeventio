// SPDX-License-Identifier: MIT
//
// TOP-LEVEL `project_documents/{docId}` — F7 evidence lock (founder decision
// 2026-07-02). Distinct from projectDocuments.rules.test.ts, which covers the
// SUBCOLLECTION projects/{pid}/documents.
//
// `src/components/projects/ProjectDocuments.tsx` lists (useFirestoreCollection)
// and creates (addDoc) rows here for files uploaded to Storage projects/{pid}/.
// The old rule allowed admin/supervisor/project-creator DELETE — but a project
// document (PTS, EPP acta, emergency plan) is legal evidence under DS 44 /
// Ley 16.744, and a client delete is an evidence-destruction primitive. F7:
// delete is DENIED for every client; the UI "removes" via `archived: true`,
// admitted by an update rule that accepts ONLY that flag (tamper-proof
// otherwise). Physical removal is server-side (Admin SDK) + audited.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-pdocs-root-1';
const MEMBER = 'member-uid-1';
const CREATOR = 'creator-uid-1';
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
      name: 'PDocs Root Project', members: [MEMBER, CREATOR], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: CREATOR,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
function pdocRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'project_documents', id);
}

const PDOC = {
  name: 'PTS Excavación.pdf', url: 'https://storage/x', type: 'PDF',
  size: 1024, projectId: PID, uploadedBy: MEMBER, createdAt: '2026-06-03T00:00:00Z',
};

async function seedPdoc(id: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'project_documents', id), PDOC);
  });
}

describe('project_documents (top-level) — F7 evidence lock', () => {
  it('a project member can create a document row (unchanged)', async () => {
    await assertSucceeds(setDoc(pdocRef(authed(MEMBER), 'p1'), PDOC));
  });
  it('a project member can read a document row (unchanged)', async () => {
    await seedPdoc('p2');
    await assertSucceeds(getDoc(pdocRef(authed(MEMBER), 'p2')));
  });
  it('a non-member cannot read a document row (unchanged)', async () => {
    await seedPdoc('p3');
    await assertFails(getDoc(pdocRef(authed(OUTSIDER), 'p3')));
  });
  it('F7: an ADMIN cannot delete (was allowed before)', async () => {
    await seedPdoc('p4');
    await assertFails(deleteDoc(pdocRef(authed(ADMIN, 'admin'), 'p4')));
  });
  it('F7: the project CREATOR cannot delete (was allowed before)', async () => {
    await seedPdoc('p5');
    await assertFails(deleteDoc(pdocRef(authed(CREATOR), 'p5')));
  });
  it('F7: the project creator CAN archive (hide-only removal)', async () => {
    await seedPdoc('p6');
    await assertSucceeds(updateDoc(pdocRef(authed(CREATOR), 'p6'), { archived: true }));
  });
  it('F7: an admin CAN archive', async () => {
    await seedPdoc('p7');
    await assertSucceeds(updateDoc(pdocRef(authed(ADMIN, 'admin'), 'p7'), { archived: true }));
  });
  it('F7: a plain member (non-creator, non-admin) cannot archive', async () => {
    await seedPdoc('p8');
    await assertFails(updateDoc(pdocRef(authed(MEMBER), 'p8'), { archived: true }));
  });
  it('F7: an update touching any OTHER field is denied even for admin (tamper-proof)', async () => {
    await seedPdoc('p9');
    await assertFails(
      updateDoc(pdocRef(authed(ADMIN, 'admin'), 'p9'), { archived: true, name: 'renamed.pdf' }),
    );
  });
  it('F7: archived must be a boolean', async () => {
    await seedPdoc('p10');
    await assertFails(updateDoc(pdocRef(authed(ADMIN, 'admin'), 'p10'), { archived: 'yes' }));
  });
});
