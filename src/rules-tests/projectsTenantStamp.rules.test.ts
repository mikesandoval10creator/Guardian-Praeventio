// M-1 Phase 1 — rules pin for the `tenantId` project field.
//
// Phase 1 contract (deliberately permissive — see design doc §4 and the
// inline comment in firestore.rules isValidProject):
//   • a create that STAMPS tenantId passes the allowlist (this is what
//     ProjectContext/onboarding now send),
//   • a create WITHOUT tenantId still passes (optional until backfill),
//   • the allowlist stays tight: unknown keys are still rejected,
//   • KNOWN PHASE-1 LIMIT (flips to deny in Phase 3): tenantId is not yet
//     bound to the caller (`incoming().tenantId == request.auth.uid`), so a
//     forged tenantId currently passes schema. Pinned here so Phase 3 MUST
//     flip this assertion consciously.

import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const CREATOR = 'creator-uid-m1';

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

function creatorDb() {
  return requireEnv()
    .authenticatedContext(CREATOR, verifiedToken('worker', `${CREATOR}@example.com`))
    .firestore();
}

function validProject(extra: Record<string, unknown> = {}) {
  return {
    name: 'Faena M1',
    members: [CREATOR],
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: CREATOR,
    ...extra,
  };
}

describe('projects create — M-1 tenantId field (phase 3)', () => {
  it('ALLOWS a create that stamps tenantId = own uid (what the app now sends)', async () => {
    await assertSucceeds(
      setDoc(doc(creatorDb(), 'projects', 'm1-with-tenant'), validProject({ tenantId: CREATOR })),
    );
  });

  it('Phase 3: DENIES a create without tenantId (now REQUIRED by isValidProject)', async () => {
    await assertFails(
      setDoc(doc(creatorDb(), 'projects', 'm1-without-tenant'), validProject()),
    );
  });

  it('keeps the allowlist tight: an unknown key is still rejected', async () => {
    await assertFails(
      setDoc(
        doc(creatorDb(), 'projects', 'm1-unknown-key'),
        validProject({ tenantId: CREATOR, totallyUnknownKey: true }),
      ),
    );
  });

  it('Phase 3: DENIES a forged tenantId (≠ own uid) — anti-spoof (incoming().tenantId == request.auth.uid)', async () => {
    await assertFails(
      setDoc(
        doc(creatorDb(), 'projects', 'm1-forged-tenant'),
        validProject({ tenantId: 'someone-else' }),
      ),
    );
  });
});
