// SPDX-License-Identifier: MIT
//
// B-DigitalTwin (#356) — reconstruction_jobs rules.
//
// projects/{pid}/reconstruction_jobs/{jobId} is the on-device photogrammetry
// job store (src/services/digitalTwin/photogrammetry/reconstructionJobStore.ts,
// CLIENT SDK). The worker running the scan creates the job and persists
// progress/completion/failure client-side — so create/update are member-gated
// (NOT server-only). The collection had NO rule (default-denied), so
// createReconstructionJob() failed and the on-device pipeline died before the
// GLB upload even started.
//
// Rule: member read + member create/update + admin/supervisor delete
// (mirrors placed_objects). Uses the F1 fail-closed harness (authenticatedContext;
// Admin-SDK only to seed preconditions, never in an assertion).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-recon-1';
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
      name: 'Recon Project', members: [MEMBER], status: 'active',
      createdAt: '2026-06-01T00:00:00Z', createdBy: MEMBER,
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, role: 'admin', email: `${ADMIN}@x.cl`, createdAt: '2026-06-01T00:00:00Z',
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, 'reconstruction_jobs', id);
}
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}
async function seed(id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'reconstruction_jobs', id), data);
  });
}

const job = () => ({
  jobId: 'job-1', projectId: PID, userId: MEMBER,
  status: 'pending', progressPct: 0, createdAt: '2026-06-08T00:00:00.000Z',
});

describe('reconstruction_jobs — firestore.rules (#356)', () => {
  // member-allow (create — the job is written BEFORE the GLB upload)
  it('a project member can CREATE a reconstruction job', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'job-1'), job()));
  });

  // member-allow (read)
  it('a project member can READ a reconstruction job', async () => {
    await seed('job-1', job());
    await assertSucceeds(getDoc(ref(authed(MEMBER), 'job-1')));
  });

  // member-allow (update — progress/completion persisted client-side)
  it('a project member can UPDATE job progress', async () => {
    await seed('job-1', job());
    await assertSucceeds(
      setDoc(ref(authed(MEMBER), 'job-1'), { status: 'running', progressPct: 42 }, { merge: true }),
    );
  });

  // non-member-deny (create)
  it('a non-member CANNOT create a reconstruction job', async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'job-2'), job()));
  });

  // non-member-deny (read — cross-project isolation)
  it('a non-member CANNOT read a reconstruction job', async () => {
    await seed('job-1', job());
    await assertFails(getDoc(ref(authed(OUTSIDER), 'job-1')));
  });

  // non-member-deny (update)
  it('a non-member CANNOT update a reconstruction job', async () => {
    await seed('job-1', job());
    await assertFails(
      setDoc(ref(authed(OUTSIDER), 'job-1'), { status: 'running' }, { merge: true }),
    );
  });

  // delete gating — member cannot erase a job record; admin/supervisor can
  it('a member CANNOT delete a job; an admin CAN', async () => {
    await seed('job-1', job());
    await assertFails(deleteDoc(ref(authed(MEMBER), 'job-1')));
    await assertSucceeds(deleteDoc(ref(authed(ADMIN, 'admin'), 'job-1')));
  });
});
