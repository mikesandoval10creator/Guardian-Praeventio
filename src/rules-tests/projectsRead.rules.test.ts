// SPDX-License-Identifier: MIT
//
// Top-level `projects/{projectId}` READ rule — firestore.rules.
//
// ProjectContext (src/contexts/ProjectContext.tsx) lists a non-admin user's
// projects with
//   query(collection(db,'projects'), where('members','array-contains', uid))
// The read rule MUST allow that LIST for a member and DENY cross-tenant reads.
//
// Regression guard for the SOS E2E (tests/e2e/sos-button.spec.ts): the global
// SOSButton renders only when ProjectContext auto-selects the (emergency)
// project, which requires this LIST to succeed against the Firestore emulator.
// The pre-fix rule called isProjectMember() → a self-referential get() on the
// project doc, which the emulator cannot resolve during list evaluation
// ("Null value error" @ the projects read line). The fix evaluates membership
// against resource.data (the doc itself). Semantics preserved: member OR
// creator OR admin OR supervisor. (CLAUDE.md #4 — ≥5 rules-tests.)

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const MEMBER = 'member-uid-1'; // member of PROJECT_A (role worker)
const UNVERIFIED = 'unverified-uid-2'; // member of PROJECT_A but email NOT verified
const OUTSIDER = 'outsider-uid-3'; // member of PROJECT_B only
const ADMIN = 'admin-uid-4'; // token role admin, member of nothing
const CREATOR = 'creator-uid-5'; // created PROJECT_A, NOT in its members

const PROJECT_A = 'project-alpha';
const PROJECT_B = 'project-beta';

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

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function fs(uid: string, role = 'worker', emailVerified = true): CtxDb {
  const token = emailVerified
    ? verifiedToken(role, `${uid}@example.com`)
    : { email: `${uid}@example.com`, email_verified: false, role };
  return requireEnv().authenticatedContext(uid, token).firestore();
}
function db(ctx: CtxDb) {
  return ctx as unknown as Parameters<typeof collection>[0];
}

async function seed() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'projects', PROJECT_A), {
      name: 'Alpha',
      tenantId: 't1',
      members: [MEMBER, UNVERIFIED],
      createdBy: CREATOR,
    });
    await setDoc(doc(d, 'projects', PROJECT_B), {
      name: 'Beta',
      tenantId: 't2',
      members: [OUTSIDER],
      createdBy: OUTSIDER,
    });
    // users/{uid} docs so isAdmin()/isSupervisor()'s get() fallback resolves
    // cleanly (mirrors prod, where every user has a doc).
    for (const [uid, role] of [
      [MEMBER, 'worker'],
      [UNVERIFIED, 'worker'],
      [OUTSIDER, 'worker'],
      [ADMIN, 'admin'],
      [CREATOR, 'worker'],
    ] as const) {
      await setDoc(doc(d, 'users', uid), { role });
    }
  });
}

describe('projects/{projectId} read — firestore.rules', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seed();
  });

  it('member CAN list their projects via members array-contains (ProjectContext/SOS path)', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(db(fs(MEMBER)), 'projects'),
          where('members', 'array-contains', MEMBER),
        ),
      ),
    );
  });

  it('member CAN get a project they belong to by id', async () => {
    await assertSucceeds(getDoc(doc(db(fs(MEMBER)), 'projects', PROJECT_A)));
  });

  it('creator CAN read their project even when not in members[]', async () => {
    await assertSucceeds(getDoc(doc(db(fs(CREATOR)), 'projects', PROJECT_A)));
  });

  it('admin CAN read any project (not a member)', async () => {
    await assertSucceeds(getDoc(doc(db(fs(ADMIN, 'admin')), 'projects', PROJECT_B)));
  });

  it('non-member CANNOT read another tenant project', async () => {
    await assertFails(getDoc(doc(db(fs(OUTSIDER)), 'projects', PROJECT_A)));
  });

  it('member CANNOT list ALL projects (unfiltered query leaks other tenants)', async () => {
    await assertFails(getDocs(query(collection(db(fs(MEMBER)), 'projects'))));
  });

  it('admin CAN list ALL projects via the unfiltered query (ProjectContext admin path)', async () => {
    await assertSucceeds(getDocs(query(collection(db(fs(ADMIN, 'admin')), 'projects'))));
  });

  it('unverified-email member CANNOT read their project', async () => {
    await assertFails(
      getDoc(doc(db(fs(UNVERIFIED, 'worker', false)), 'projects', PROJECT_A)),
    );
  });
});
