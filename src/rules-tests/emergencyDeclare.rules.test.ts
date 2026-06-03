// SPDX-License-Identifier: MIT
//
// B1 — Declaring an emergency must not silently fail.
//
// `EmergencyCheckIn.toggleEmergency` writes `isEmergencyActive` onto the project
// doc via the CLIENT SDK (`setDoc(projectRef, { isEmergencyActive }, { merge })`,
// EmergencyCheckIn.tsx:115). The project update rule (firestore.rules:254) gates
// on `isValidProject(incoming())`, whose `hasOnly` allowlist did NOT include the
// emergency-state fields — so the write was default-denied and declaring an
// emergency failed silently in production. This suite pins the fix: the three
// emergency fields are now allowed, and the schema gate still rejects junk.
//
// Uses the shared fail-closed harness (Phase 5 · F1).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-emergency-1';
const CREATOR = 'creator-uid-1';
const MEMBER = 'member-uid-2'; // a member who is NOT the creator
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

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  // Seed a schema-valid project owned by CREATOR, bypassing rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID), {
      name: 'Emergency Test Project',
      members: [CREATOR, MEMBER],
      status: 'active',
      createdAt: '2026-06-01T00:00:00Z',
      createdBy: CREATOR,
    });
  });
});

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function projectRef(ctxDb: CtxDb) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID);
}

describe('declare-emergency — isValidProject emergency fields (B1)', () => {
  it('project owner can set isEmergencyActive (declare emergency)', async () => {
    const db = requireEnv().authenticatedContext(CREATOR, verifiedToken('supervisor')).firestore();
    await assertSucceeds(setDoc(projectRef(db), { isEmergencyActive: true }, { merge: true }));
  });

  it('owner can set the full emergency triad (active + protocol + startTime)', async () => {
    const db = requireEnv().authenticatedContext(CREATOR, verifiedToken('supervisor')).firestore();
    await assertSucceeds(
      setDoc(
        projectRef(db),
        {
          isEmergencyActive: true,
          activeEmergencyProtocol: 'evacuation',
          emergencyStartTime: '2026-06-03T12:00:00Z',
        },
        { merge: true },
      ),
    );
  });

  it('owner can stand the emergency down (isEmergencyActive=false)', async () => {
    const db = requireEnv().authenticatedContext(CREATOR, verifiedToken('supervisor')).firestore();
    await assertSucceeds(setDoc(projectRef(db), { isEmergencyActive: false }, { merge: true }));
  });

  it('an outsider (non-member) cannot declare an emergency', async () => {
    const db = requireEnv().authenticatedContext(OUTSIDER, verifiedToken('worker')).firestore();
    await assertFails(setDoc(projectRef(db), { isEmergencyActive: true }, { merge: true }));
  });

  it('the schema gate still rejects an unknown field (no allowlist bypass)', async () => {
    const db = requireEnv().authenticatedContext(CREATOR, verifiedToken('supervisor')).firestore();
    await assertFails(setDoc(projectRef(db), { hackerField: true }, { merge: true }));
  });

  // Documents the CURRENT access model: a non-creator member cannot update the
  // project doc (rule:254 gates on creator/admin/supervisor). Broadening
  // emergency declaration to any member would need a member-writable
  // subcollection — tracked as a B1 follow-up.
  it('a non-creator member cannot declare via the project doc (current access model)', async () => {
    const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
    await assertFails(setDoc(projectRef(db), { isEmergencyActive: true }, { merge: true }));
  });
});
