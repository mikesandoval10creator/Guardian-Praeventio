// SPDX-License-Identifier: MIT
//
// Worker documents rules.
//
// `src/components/workers/DocsModal.tsx` reads (live `onSnapshot`), creates
// (`addDoc` after a Storage upload) and deletes (`deleteDoc`) worker documents
// at TWO paths:
//   (a) projects/{pid}/workers/{wid}/documents/{id}  — when a project is selected
//   (b) workers/{wid}/documents/{id}                 — when projectId is undefined
//       (Workers.tsx passes projectId={selectedProject?.id})
// Neither had a rule: (a) the nested `match /workers/{workerId}` declared NO
// `documents` sub-match, so create/update/delete were default-denied (read was
// already granted by the project sub-collection Master Gate); (b) there was no
// top-level `match /workers` at all → fully default-denied. So the worker
// Documentación feature was broken in production.
//
// Path (a): member-gated create/update (schema carries `workerId`, the worker
// doc id — NOT a caller uid — so there is no anti-spoof field to bind, matching
// the sibling /documents and /findings rules).
// Path (b): admin/supervisor only (non-project-scoped personnel record, no
// project membership to check). Uses the F1 fail-closed harness.
//
// F7 (founder decision 2026-07-02): worker documents are legal evidence —
// client-side DELETE is denied for everybody on both paths (DocsModal now
// archives via `archived: true` instead). Physical removal is server-side
// (Admin SDK) + audited.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-wdocs-1';
const WID = 'worker-1';
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
      name: 'Worker Docs Project', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
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
// Nested project-scoped path: projects/{pid}/workers/{wid}/documents/{id}.
function nestedRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'workers', WID, 'documents', id);
}
// Top-level fallback path: workers/{wid}/documents/{id}.
function topRef(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'workers', WID, 'documents', id);
}
async function seedNested(id: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'projects', PID, 'workers', WID, 'documents', id),
      { name: 'Cert', type: 'PDF', url: 'https://x/y', workerId: WID, createdAt: '2026-06-03T00:00:00Z' },
    );
  });
}
async function seedTop(id: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'workers', WID, 'documents', id),
      { name: 'Cert', type: 'PDF', url: 'https://x/y', workerId: WID, createdAt: '2026-06-03T00:00:00Z' },
    );
  });
}

const workerDoc = {
  name: 'Certificado SUSESO', type: 'PDF', url: 'https://storage/x',
  workerId: WID, createdAt: '2026-06-03T00:00:00Z',
};

describe('projects/{pid}/workers/{wid}/documents — firestore.rules', () => {
  it('member can create a worker document', async () => {
    await assertSucceeds(setDoc(nestedRef(authed(MEMBER), 'd1'), workerDoc));
  });
  it('member can read (master-gate) a worker document', async () => {
    await seedNested('d2');
    await assertSucceeds(getDoc(nestedRef(authed(MEMBER), 'd2')));
  });
  it('non-member cannot create a worker document', async () => {
    await assertFails(setDoc(nestedRef(authed(OUTSIDER), 'd3'), workerDoc));
  });
  it('non-member cannot read a worker document', async () => {
    await seedNested('d4');
    await assertFails(getDoc(nestedRef(authed(OUTSIDER), 'd4')));
  });
  it('member can update a worker document', async () => {
    await seedNested('d6');
    await assertSucceeds(setDoc(nestedRef(authed(MEMBER), 'd6'), { name: 'Editado' }, { merge: true }));
  });
  it('F7: NOBODY deletes client-side — member AND admin denied (evidence lock)', async () => {
    await seedNested('d5');
    await assertFails(deleteDoc(nestedRef(authed(MEMBER), 'd5')));
    await assertFails(deleteDoc(nestedRef(authed(ADMIN, 'admin'), 'd5')));
  });
  it('F7: archive flip (archived: true) is allowed for a member (hide-only path)', async () => {
    await seedNested('d7');
    await assertSucceeds(setDoc(nestedRef(authed(MEMBER), 'd7'), { archived: true }, { merge: true }));
  });
});

describe('workers/{wid}/documents (top-level fallback) — firestore.rules', () => {
  it('supervisor can create a top-level worker document', async () => {
    await assertSucceeds(setDoc(topRef(authed('sup-1', 'supervisor'), 't1'), workerDoc));
  });
  it('a plain worker (non-supervisor) cannot read a top-level worker document', async () => {
    await seedTop('t2');
    await assertFails(getDoc(topRef(authed(MEMBER), 't2')));
  });
  it('a plain worker cannot create a top-level worker document', async () => {
    await assertFails(setDoc(topRef(authed(MEMBER), 't3'), workerDoc));
  });
  it('a plain worker cannot delete a top-level worker document', async () => {
    await seedTop('t4');
    await assertFails(deleteDoc(topRef(authed(MEMBER), 't4')));
  });
  it('F7: even an ADMIN cannot delete a top-level worker document', async () => {
    await seedTop('t5');
    await assertFails(deleteDoc(topRef(authed(ADMIN, 'admin'), 't5')));
  });
  it('F7: a supervisor can archive (hide-only) a top-level worker document', async () => {
    await seedTop('t6');
    await assertSucceeds(setDoc(topRef(authed('sup-1', 'supervisor'), 't6'), { archived: true }, { merge: true }));
  });
});
