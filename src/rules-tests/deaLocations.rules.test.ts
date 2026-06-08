// SPDX-License-Identifier: MIT
//
// #4 — `dea_locations` (PUBLIC AED registry) rules. A bystander in a cardiac
// arrest finds the nearest defibrillator WITHOUT login. Pins: anonymous READ is
// allowed (life-safety public good, ADR 0021); WRITE is gated to members of the
// owning project (randoms can't pollute the public map); the schema is validated
// (coordinates required, no PII smuggling). Uses the F1 fail-closed harness.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-dea-1';
const MEMBER = 'member-uid-1';
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

const validDea = {
  location: 'Recepción Principal',
  coordinates: { lat: -33.45, lng: -70.66 },
  status: 'operational',
  projectId: PID,
  updatedAt: '2026-06-08T00:00:00Z',
};

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'DEA Project',
      members: [MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'dea_locations', 'seeded'), validDea);
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'dea_locations', id);
}
function anonDb(): CtxDb {
  return requireEnv().unauthenticatedContext().firestore();
}
function authed(uid: string): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken('worker')).firestore();
}

describe('dea_locations (public AED registry) — firestore.rules (#4)', () => {
  it('ANYONE (anonymous) can read the public DEA map — life-safety, no login', async () => {
    await assertSucceeds(getDoc(ref(anonDb(), 'seeded')));
  });

  it('a project member can publish a DEA location', async () => {
    await assertSucceeds(setDoc(ref(authed(MEMBER), 'd1'), validDea));
  });

  it('an anonymous user CANNOT write to the public map', async () => {
    await assertFails(setDoc(ref(anonDb(), 'd2'), validDea));
  });

  it("a non-member CANNOT publish a DEA for someone else's project", async () => {
    await assertFails(setDoc(ref(authed(OUTSIDER), 'd3'), validDea));
  });

  it('rejects a malformed DEA (missing required coordinates)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'd4'), {
        location: 'Sin coords',
        status: 'operational',
        projectId: PID,
        updatedAt: '2026-06-08T00:00:00Z',
      }),
    );
  });

  it('rejects an unexpected extra field (no PII smuggling onto the public map)', async () => {
    await assertFails(
      setDoc(ref(authed(MEMBER), 'd5'), { ...validDea, assignedToName: 'Juan Pérez' }),
    );
  });

  it('a project member can delete a DEA from their project', async () => {
    await assertSucceeds(deleteDoc(ref(authed(MEMBER), 'seeded')));
  });
});
