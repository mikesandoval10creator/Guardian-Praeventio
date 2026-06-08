// SPDX-License-Identifier: MIT
//
// Phase 5 — `mesh_keys` (per-project mesh signing secret) rules. The key roots
// the offline mesh-packet HMAC trust; it is distributed ONLY by the server
// route GET /api/mesh/key (Admin SDK). Clients must NEVER read it (it would
// leak the project secret to a member's browser console, letting them forge
// mesh SOS packets) nor write it (it would let a member overwrite the trust
// root). Default-deny BOTH for every actor. Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-mesh-1';
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

const validKey = {
  projectId: PID,
  keyId: `${PID}:v1`,
  key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  createdBy: MEMBER,
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Seed the project (MEMBER is a member) AND a pre-existing mesh key, so the
    // read-deny tests prove members are blocked even when the doc exists.
    await setDoc(doc(db, 'projects', PID), {
      name: 'Mesh Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'mesh_keys', PID), validKey);
  });
});

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'mesh_keys', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('mesh_keys (per-project mesh signing secret) — firestore.rules', () => {
  it('a project MEMBER cannot read the mesh key (secret never leaves the server)', async () => {
    await assertFails(getDoc(ref(authed(MEMBER), PID)));
  });

  it('a non-member cannot read the mesh key', async () => {
    await assertFails(getDoc(ref(authed(OUTSIDER), PID)));
  });

  it('an admin cannot read the mesh key directly (server-only distribution)', async () => {
    await assertFails(getDoc(ref(authed(ADMIN, 'admin'), PID)));
  });

  it('an anonymous user cannot read the mesh key', async () => {
    await assertFails(getDoc(ref(anonDb(), PID)));
  });

  it('a project member cannot WRITE the mesh key (cannot overwrite the trust root)', async () => {
    await assertFails(setDoc(ref(authed(MEMBER), PID), validKey));
  });

  it('a non-member cannot write the mesh key', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'proj-other'), validKey));
  });

  it('an anonymous user cannot write the mesh key', async () => {
    await assertFails(setDoc(ref(anonDb(), PID), validKey));
  });
});
