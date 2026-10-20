// SPDX-License-Identifier: MIT
//
// Tenant-scope regression suite for top-level libraries and user profiles.
//
// Findings closed here:
//   • projects/{pid}/training & safety_solutions used global isAdmin/isSupervisor
//     for read/write → a privileged user of tenant B could reach tenant A.
//   • users/{uid} read/delete used global isAdmin/isSupervisor → cross-tenant.
//   • projects/{pid} master gate allowlisted tenant-only collections
//     (supervisor_only, emergency_alerts, suseso_*, conflict_queue,
//     evidence_artifacts, ar_anchors), creating a latent bypass if a
//     project-level copy ever appeared.
//
// Requires the Firestore emulator (npm run test:rules). The harness fails closed
// when the emulator is unavailable.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const WORKER_A = 'worker-a';
const WORKER_B = 'worker-b';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const SUPER_A = 'supervisor-a';
const SUPER_B = 'supervisor-b';
const ADMIN_A = 'admin-a';
const ADMIN_B = 'admin-b';
const PLATFORM = 'platform-operator';

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

function authed(
  uid: string,
  role: string,
  extra: Record<string, unknown> = {},
): CtxDb {
  return requireEnv()
    .authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`, extra))
    .firestore();
}

function userDoc(uid: string, role: string, tenantId: string) {
  return {
    uid,
    email: `${uid}@x.cl`,
    role,
    createdAt: '2026-06-01T00:00:00Z',
    tenantId,
  };
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'users', WORKER_A), userDoc(WORKER_A, 'worker', 'tA'));
    await setDoc(doc(db, 'users', WORKER_B), userDoc(WORKER_B, 'worker', 'tB'));
    await setDoc(doc(db, 'users', OWNER_A), userDoc(OWNER_A, 'worker', 'tA'));
    await setDoc(doc(db, 'users', OWNER_B), userDoc(OWNER_B, 'worker', 'tB'));
    await setDoc(doc(db, 'users', SUPER_A), userDoc(SUPER_A, 'supervisor', 'tA'));
    await setDoc(doc(db, 'users', SUPER_B), userDoc(SUPER_B, 'supervisor', 'tB'));
    await setDoc(doc(db, 'users', ADMIN_A), userDoc(ADMIN_A, 'admin', 'tA'));
    await setDoc(doc(db, 'users', ADMIN_B), userDoc(ADMIN_B, 'admin', 'tB'));
    await setDoc(doc(db, 'users', PLATFORM), userDoc(PLATFORM, 'platform_operator', ''));

    await setDoc(doc(db, 'projects', 'pA'), {
      tenantId: 'tA',
      createdBy: OWNER_A,
      members: [WORKER_A, OWNER_A],
    });
    await setDoc(doc(db, 'projects', 'pB'), {
      tenantId: 'tB',
      createdBy: OWNER_B,
      members: [WORKER_B, OWNER_B],
    });

    await setDoc(doc(db, 'training', 'trA'), {
      title: 'Project A training',
      projectId: 'pA',
      status: 'scheduled',
      attendees: [],
      date: '2026-10-20T00:00:00Z',
      duration: 15,
    });
    await setDoc(doc(db, 'training', 'trB'), {
      title: 'Project B training',
      projectId: 'pB',
      status: 'scheduled',
      attendees: [],
      date: '2026-10-20T00:00:00Z',
      duration: 15,
    });
    await setDoc(doc(db, 'training', 'trCurated'), {
      title: 'Curated global training',
      projectId: null,
      isCurated: true,
      status: 'scheduled',
      attendees: [],
      date: '2026-10-20T00:00:00Z',
      duration: 15,
    });

    await setDoc(doc(db, 'safety_solutions', 'solGlobal'), {
      title: 'Global solution',
      problem: 'p',
      solution: 's',
    });
    await setDoc(doc(db, 'safety_solutions', 'solA'), {
      title: 'Solution A',
      problem: 'p',
      solution: 's',
      projectId: 'pA',
    });
    await setDoc(doc(db, 'safety_solutions', 'solB'), {
      title: 'Solution B',
      problem: 'p',
      solution: 's',
      projectId: 'pB',
    });

    await setDoc(doc(db, 'projects', 'pA', 'reports', 'r1'), { ok: true });
    await setDoc(doc(db, 'projects', 'pA', 'supervisor_only', 's1'), { secret: true });
    await setDoc(doc(db, 'projects', 'pA', 'emergency_alerts', 'e1'), { secret: true });
    await setDoc(doc(db, 'projects', 'pA', 'ar_anchors', 'a1'), { secret: true });
  });
});

// Supervisor-tier tokens use the multi-tenant claim shape (token.tenants[tid]),
// which is the form isSupervisorOfTenant() reads for per-tenant authority.
const supervisorA = () => authed(SUPER_A, 'worker', { tenants: { tA: 'supervisor' } });
const supervisorB = () => authed(SUPER_B, 'worker', { tenants: { tB: 'supervisor' } });
const adminA = () => authed(ADMIN_A, 'admin', { tenantId: 'tA' });
const adminB = () => authed(ADMIN_B, 'admin', { tenantId: 'tB' });
const workerA = () => authed(WORKER_A, 'worker', { tenantId: 'tA' });
const workerB = () => authed(WORKER_B, 'worker', { tenantId: 'tB' });

describe('training — tenant-scoped project records + global curated library', () => {
  it('allows a project member to read project-A training', async () => {
    await assertSucceeds(getDoc(doc(workerA(), 'training', 'trA')));
  });

  it('denies a tenant-B worker reading project-A training', async () => {
    await assertFails(getDoc(doc(workerB(), 'training', 'trA')));
  });

  it('allows a tenant-A supervisor (not a project member) to read project-A training', async () => {
    await assertSucceeds(getDoc(doc(supervisorA(), 'training', 'trA')));
  });

  it('denies a tenant-B supervisor reading project-A training', async () => {
    await assertFails(getDoc(doc(supervisorB(), 'training', 'trA')));
  });

  it('allows any verified worker to read curated global training', async () => {
    await assertSucceeds(getDoc(doc(workerB(), 'training', 'trCurated')));
  });

  it('denies a worker updating project-A training', async () => {
    await assertFails(
      updateDoc(doc(workerA(), 'training', 'trA'), { title: 'tampered' }),
    );
  });

  it('allows a tenant-A supervisor to update project-A training', async () => {
    await assertSucceeds(
      updateDoc(doc(supervisorA(), 'training', 'trA'), { title: 'updated' }),
    );
  });

  it('denies a tenant-A supervisor updating project-B training', async () => {
    await assertFails(
      updateDoc(doc(supervisorA(), 'training', 'trB'), { title: 'tampered' }),
    );
  });

  it('denies a tenant-B admin updating project-A training', async () => {
    await assertFails(
      updateDoc(doc(adminB(), 'training', 'trA'), { title: 'tampered' }),
    );
  });

  it('denies re-homing project-A training into project B', async () => {
    await assertFails(
      updateDoc(doc(supervisorA(), 'training', 'trA'), { projectId: 'pB' }),
    );
  });

  it('allows an admin to create a curated global training item', async () => {
    await assertSucceeds(
      setDoc(doc(adminA(), 'training', 'newCurated'), {
        title: 'New curated',
        projectId: null,
        isCurated: true,
      }),
    );
  });
});

describe('safety_solutions — tenant-scoped project records + global library', () => {
  it('allows any verified worker to read a global solution', async () => {
    await assertSucceeds(getDoc(doc(workerB(), 'safety_solutions', 'solGlobal')));
  });

  it('allows a project member to read a project-A solution', async () => {
    await assertSucceeds(getDoc(doc(workerA(), 'safety_solutions', 'solA')));
  });

  it('denies a tenant-B worker reading a project-A solution', async () => {
    await assertFails(getDoc(doc(workerB(), 'safety_solutions', 'solA')));
  });

  it('denies a supervisor creating a global solution (admin-only platform content)', async () => {
    await assertFails(
      setDoc(doc(supervisorA(), 'safety_solutions', 'newGlobal'), {
        title: 'Global',
        problem: 'p',
        solution: 's',
      }),
    );
  });

  it('allows an admin to create a global solution', async () => {
    await assertSucceeds(
      setDoc(doc(adminA(), 'safety_solutions', 'newGlobal'), {
        title: 'Global',
        problem: 'p',
        solution: 's',
      }),
    );
  });

  it('allows a tenant-A supervisor to create a project-A solution', async () => {
    await assertSucceeds(
      setDoc(doc(supervisorA(), 'safety_solutions', 'newA'), {
        title: 'A',
        problem: 'p',
        solution: 's',
        projectId: 'pA',
      }),
    );
  });

  it('denies a tenant-A supervisor creating a project-B solution', async () => {
    await assertFails(
      setDoc(doc(supervisorA(), 'safety_solutions', 'newB'), {
        title: 'B',
        problem: 'p',
        solution: 's',
        projectId: 'pB',
      }),
    );
  });
});

describe('users/{uid} — tenant-scoped privileged read/delete', () => {
  it('allows the owner to read their own profile', async () => {
    await assertSucceeds(getDoc(doc(workerA(), 'users', WORKER_A)));
  });

  it('allows a tenant-A supervisor to read a tenant-A profile', async () => {
    await assertSucceeds(getDoc(doc(supervisorA(), 'users', WORKER_A)));
  });

  it('denies a tenant-A supervisor reading a tenant-B profile', async () => {
    await assertFails(getDoc(doc(supervisorA(), 'users', WORKER_B)));
  });

  it('denies a tenant-A admin reading a tenant-B profile', async () => {
    await assertFails(getDoc(doc(adminA(), 'users', WORKER_B)));
  });

  it('allows a platform operator to read a tenant-B profile', async () => {
    await assertSucceeds(
      getDoc(doc(authed(PLATFORM, 'platform_operator'), 'users', WORKER_B)),
    );
  });

  it('denies a tenant-A supervisor deleting a tenant-B profile', async () => {
    await assertFails(deleteDoc(doc(supervisorA(), 'users', WORKER_B)));
  });

  it('denies a tenant-A supervisor deleting a tenant-A profile (delete is admin-only)', async () => {
    await assertFails(deleteDoc(doc(supervisorA(), 'users', WORKER_A)));
  });

  it('allows a tenant-A admin deleting a tenant-A profile', async () => {
    await assertSucceeds(deleteDoc(doc(adminA(), 'users', WORKER_A)));
  });
});

describe('projects/{pid} master gate — tenant-only collections are not allowlisted', () => {
  it('allows a project member to read a regular allowlisted subcollection (reports)', async () => {
    await assertSucceeds(getDoc(doc(workerA(), 'projects', 'pA', 'reports', 'r1')));
  });

  it('denies a project member reading a project-level supervisor_only copy', async () => {
    await assertFails(
      getDoc(doc(workerA(), 'projects', 'pA', 'supervisor_only', 's1')),
    );
  });

  it('denies a project member reading a project-level emergency_alerts copy', async () => {
    await assertFails(
      getDoc(doc(workerA(), 'projects', 'pA', 'emergency_alerts', 'e1')),
    );
  });

  it('denies a project member reading a project-level ar_anchors copy', async () => {
    await assertFails(
      getDoc(doc(workerA(), 'projects', 'pA', 'ar_anchors', 'a1')),
    );
  });
});
