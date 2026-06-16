// SPDX-License-Identifier: MIT
//
// `assets` (machinery / vehicles / tools) rules — Phase 5 disconnection hunt #7.
// The top-level `assets` collection had NO rule: MaquinariaManager.tsx writes
// `collection(db,'assets')` and the server reads `db.collection('assets')`, but
// firestore.rules only ruled the sub-collection `projects/{pid}/assets` (a path
// nobody uses), so every machinery record was silently default-denied in prod.
// This suite pins the new top-level rule: project members create/update/read
// their project's assets, projectId is immutable, type/status are validated,
// delete is admin/supervisor only, outsiders/anon are denied. Fail-closed F1
// harness (real emulator; cannot be skipped).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-assets-1';
const OTHER_PID = 'proj-assets-2';
const MEMBER = 'member-uid-1';
const OUTSIDER = 'outsider-uid-9';
const SUPERVISOR = 'sup-uid-1';
const DOC_ID = 'asset-1';

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

const validAsset = {
  projectId: PID,
  name: 'Excavadora CAT 320',
  type: 'Maquinaria',
  status: 'Operativo',
  lastMaintenance: '2026-05-01',
  nextMaintenance: '2026-08-01',
  operatorId: 'worker-7',
  createdAt: '2026-06-16T00:00:00.000Z',
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Assets Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'projects', OTHER_PID), {
      name: 'Other Project',
      members: ['other-member'],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: 'other-member',
    });
    await setDoc(doc(db, 'assets', DOC_ID), validAsset);
  });
});

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'assets', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('assets (machinery/vehicles/tools) — firestore.rules', () => {
  it('a project MEMBER can read an asset in their project', async () => {
    await assertSucceeds(getDoc(ref(authed(MEMBER), DOC_ID)));
  });

  it('a non-member CANNOT read an asset (cross-tenant)', async () => {
    await assertFails(getDoc(ref(authed(OUTSIDER), DOC_ID)));
  });

  it('an anonymous user CANNOT read an asset', async () => {
    await assertFails(getDoc(ref(anonDb(), DOC_ID)));
  });

  it('a project MEMBER can CREATE a valid asset (the prod write path that was denied)', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'asset-new'), validAsset));
  });

  it('a non-member CANNOT create an asset in another project', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'asset-forged'), validAsset));
  });

  it('rejects an invalid `type` (schema violation)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'asset-badtype'), { ...validAsset, type: 'Nave Espacial' }),
    );
  });

  it('rejects an invalid `status` (schema violation)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'asset-badstatus'), { ...validAsset, status: 'Volando' }),
    );
  });

  it('a MEMBER can UPDATE the status (operational maintenance)', async () => {
    await assertSucceeds(updateDoc(ref(authed(MEMBER), DOC_ID), { status: 'En Mantenimiento' }));
  });

  it('CANNOT move an asset to another project (projectId is immutable)', async () => {
    await assertFails(updateDoc(ref(authed(MEMBER), DOC_ID), { projectId: OTHER_PID }));
  });

  it('a MEMBER cannot DELETE an asset (admin/supervisor only)', async () => {
    await assertFails(deleteDoc(ref(authed(MEMBER), DOC_ID)));
  });

  it('a SUPERVISOR can DELETE an asset', async () => {
    await assertSucceeds(deleteDoc(ref(authed(SUPERVISOR, 'supervisor'), DOC_ID)));
  });

  it('an anonymous user cannot create an asset', async () => {
    await assertFails(setDoc(ref(anonDb(), 'asset-anon'), validAsset));
  });
});
