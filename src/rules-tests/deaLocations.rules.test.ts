// SPDX-License-Identifier: MIT
//
// #4 — `dea_locations` (PUBLIC AED registry) rules. A bystander in a cardiac
// arrest finds the nearest defibrillator WITHOUT login. Pins: anonymous READ is
// universal (life-safety public good, ADR 0021); CREATE belongs to the publishing
// project; UPDATE/DELETE require direct owner-project association plus a trusted
// management role. Uses the F1 fail-closed harness and two-project adversarial
// cases so incoming data cannot choose which project's membership is checked.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PROJECT_A = 'proj-dea-a';
const PROJECT_B = 'proj-dea-b';
const WORKER_A = 'worker-a';
const SUPERVISOR_A = 'supervisor-a';
const CREATOR_A = 'creator-a';
const WORKER_B = 'worker-b';
const SUPERVISOR_B = 'supervisor-b';
const OUTSIDER = 'outsider-uid-9';

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

const validDeaFor = (projectId: string) => ({
  location: 'Recepción Principal',
  coordinates: { lat: -33.45, lng: -70.66 },
  status: 'operational' as const,
  projectId,
  updatedAt: '2026-06-08T00:00:00Z',
});

const validDea = validDeaFor(PROJECT_A);

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PROJECT_A), {
      name: 'DEA Project A',
      members: [WORKER_A, SUPERVISOR_A],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: CREATOR_A,
    });
    await setDoc(doc(db, 'projects', PROJECT_B), {
      name: 'DEA Project B',
      members: [WORKER_B, SUPERVISOR_B],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: SUPERVISOR_B,
    });
    await setDoc(doc(db, 'dea_locations', 'seeded-a'), validDea);
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'dea_locations', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

describe('dea_locations (public AED registry) — firestore.rules (#4)', () => {
  it('ANYONE (anonymous) can read the public DEA map — life-safety, no login', async () => {
    await assertSucceeds(getDoc(ref(anonDb(), 'seeded-a')));
  });

  it('a project member can publish a DEA location', async () => {
    await assertSucceeds(setDoc(ref(authed(WORKER_A), 'd1'), validDea));
  });

  it('the project creator can publish even when not duplicated in members', async () => {
    await assertSucceeds(setDoc(ref(authed(CREATOR_A), 'd-creator'), validDea));
  });

  it('an anonymous user CANNOT write to the public map', async () => {
    await assertFails(setDoc(ref(anonDb(), 'd2'), validDea));
  });

  it("a non-member CANNOT publish a DEA for someone else's project", async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'd3'), validDea));
  });

  it('a global supervisor CANNOT publish for an unrelated project', async () => {
    await assertFails(
      setDoc(ref(authed('global-supervisor', 'supervisor'), 'd-global'), validDea),
    );
  });

  it('rejects a malformed DEA (missing required coordinates)', async () => {
    await assertFails(
      setDoc(ref(authed(WORKER_A), 'd4'), {
        location: 'Sin coords',
        status: 'operational',
        projectId: PROJECT_A,
        updatedAt: '2026-06-08T00:00:00Z',
      }),
    );
  });

  it('rejects an unexpected extra field (no PII smuggling onto the public map)', async () => {
    await assertFails(
      setDoc(ref(authed(WORKER_A), 'd5'), {
        ...validDea,
        assignedToName: 'Juan Pérez',
      }),
    );
  });

  it('a project-B member CANNOT take over project A by changing projectId', async () => {
    await assertFails(
      updateDoc(ref(authed(WORKER_B), 'seeded-a'), { projectId: PROJECT_B }),
    );
  });

  it('an unrelated supervisor CANNOT update project A via global role', async () => {
    await assertFails(
      updateDoc(ref(authed(SUPERVISOR_B, 'supervisor'), 'seeded-a'), {
        status: 'warning',
      }),
    );
  });

  it('a regular project-A worker CANNOT update its public DEA', async () => {
    await assertFails(
      updateDoc(ref(authed(WORKER_A), 'seeded-a'), { status: 'warning' }),
    );
  });

  it('a project-A supervisor can update public fields while retaining ownership', async () => {
    await assertSucceeds(
      updateDoc(ref(authed(SUPERVISOR_A, 'supervisor'), 'seeded-a'), {
        status: 'warning',
        updatedAt: '2026-07-13T00:00:00Z',
      }),
    );
  });

  it('a project-A supervisor CANNOT transfer the DEA to project B', async () => {
    await assertFails(
      updateDoc(ref(authed(SUPERVISOR_A, 'supervisor'), 'seeded-a'), {
        projectId: PROJECT_B,
      }),
    );
  });

  it('a regular project-A worker CANNOT delete a public DEA', async () => {
    await assertFails(deleteDoc(ref(authed(WORKER_A), 'seeded-a')));
  });

  it('an unrelated supervisor CANNOT delete project A via global role', async () => {
    await assertFails(
      deleteDoc(ref(authed(SUPERVISOR_B, 'supervisor'), 'seeded-a')),
    );
  });

  it('a directly-associated project-A supervisor can delete its public DEA', async () => {
    await assertSucceeds(
      deleteDoc(ref(authed(SUPERVISOR_A, 'supervisor'), 'seeded-a')),
    );
  });
});
