// SPDX-License-Identifier: MIT
//
// cphs_meetings — signatures[] APPEND-ONLY + PREFIX-PRESERVED update rule.
//
// Once an acta carries >=1 WebAuthn co-signature the doc is immutable except
// for an APPEND to signatures[] that PRESERVES the existing prefix bit-for-bit
// (firestore.rules Caso B). These tests drive the real firestore.rules via
// authenticatedContext against the emulator (F1 fail-closed _harness) — NEVER
// the Admin SDK (which bypasses rules). withSecurityRulesDisabled is used ONLY
// to seed preconditions, never to satisfy the assertion under test.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-cphs-mtg-1';
const COMMITTEE = 'committee-1';
const MEMBER = 'member-uid-1';
const MEMBER_B = 'member-uid-2';
const OUTSIDER = 'outsider-uid-9';

const SIG_A = {
  uid: MEMBER,
  signedAt: '2026-06-08T10:00:00.000Z',
  credentialId: 'cred-A',
  signature: 'c2lnLUE=',
};
const SIG_B = {
  uid: MEMBER_B,
  signedAt: '2026-06-08T10:05:00.000Z',
  credentialId: 'cred-B',
  signature: 'c2lnLUI=',
};

// A meeting already carrying ONE signature (SIG_A) — i.e. signed/immutable.
const signedMeeting = {
  committeeId: COMMITTEE,
  scheduledAt: '2026-06-08T09:00:00.000Z',
  heldAt: '2026-06-08T09:30:00.000Z',
  attendees: [MEMBER, MEMBER_B],
  agenda: ['punto 1'],
  minutes: 'acta firmada',
  resolutions: [],
  signatures: [SIG_A],
  status: 'held',
};

// A meeting NOT yet signed (signatures: []) — i.e. the Caso A draft/first-
// signature path. recordMinutes() leaves status='held' with signatures still
// empty; the first signMinutes() call performs the 0 -> 1 transition.
const unsignedMeeting = {
  committeeId: COMMITTEE,
  scheduledAt: '2026-06-08T09:00:00.000Z',
  heldAt: '2026-06-08T09:30:00.000Z',
  attendees: [MEMBER, MEMBER_B],
  agenda: ['punto 1'],
  minutes: 'acta sin firmar',
  resolutions: [],
  signatures: [],
  status: 'held',
};

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

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function mref(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'cphs_meetings', id);
}
function authed(uid: string, role = 'worker'): CtxDb {
  return requireEnv().authenticatedContext(uid, verifiedToken(role)).firestore();
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'CPHS Mtg Project',
      members: [MEMBER, MEMBER_B],
      status: 'active',
      createdAt: '2026-06-01T00:00:00.000Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'cphs_committees', COMMITTEE), {
      projectId: PID,
      status: 'active',
      members: [],
      createdAt: '2026-06-01T00:00:00.000Z',
      createdBy: MEMBER,
    });
    await setDoc(doc(db, 'cphs_meetings', 'm1'), signedMeeting);
    await setDoc(doc(db, 'cphs_meetings', 'u1'), unsignedMeeting);
  });
});

describe('cphs_meetings signatures[] — append-only + prefix-preserved', () => {
  // 1. APPEND ALLOWED — genuine co-sign preserving the existing prefix.
  it('allows a member to APPEND one signature preserving the existing prefix', async () => {
    await assertSucceeds(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [SIG_A, SIG_B] }),
    );
  });

  // 2. PREFIX-REWRITE DENIED — prior signature forged while count still grows by one.
  it('denies an update that REWRITES an existing signature in the prefix', async () => {
    const forgedA = { ...SIG_A, credentialId: 'cred-FORGED', signature: 'Zm9yZ2Vk' };
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [forgedA, SIG_B] }),
    );
  });

  // 3. TRUNCATE DENIED — dropping a prior signature (array shrinks / wrong size).
  it('denies an update that TRUNCATES / drops a prior signature', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [] }),
    );
  });

  // 4. REORDER DENIED — same-length reorder is not an append (size unchanged).
  it('denies a REORDER / same-length replacement of signatures', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [SIG_B] }),
    );
  });

  // 5. NON-MEMBER DENIED — outsider cannot even append.
  it('denies a NON-MEMBER appending a signature', async () => {
    await assertFails(
      updateDoc(mref(authed(OUTSIDER), 'm1'), { signatures: [SIG_A, SIG_B] }),
    );
  });

  // 6. BULK-REPLACE DENIED — whole array swapped for new entries (size old+1).
  it('denies a BULK replace of the whole signatures array (size old+1, new entries)', async () => {
    const fresh1 = { ...SIG_B, uid: MEMBER, credentialId: 'x1', signature: 'eDE=' };
    const fresh2 = { ...SIG_B, uid: MEMBER_B, credentialId: 'x2', signature: 'eDI=' };
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [fresh1, fresh2] }),
    );
  });

  // 7. BODY-TAMPER-ON-APPEND DENIED — appending while also mutating minutes.
  it('denies appending a signature while mutating the immutable meeting body', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), {
        signatures: [SIG_A, SIG_B],
        minutes: 'acta alterada despues de firmar',
      }),
    );
  });

  // 8. CO-SIGN-FOR-ANOTHER DENIED — append whose tail uid != caller (Caso B
  //    self-bind). MEMBER_B appends a signature carrying SIG_A's uid (MEMBER).
  it('denies a co-sign whose appended tail signature uid is not the caller', async () => {
    const tailForAnother = { ...SIG_B, uid: MEMBER };
    await assertFails(
      updateDoc(mref(authed(MEMBER_B), 'm1'), { signatures: [SIG_A, tailForAnother] }),
    );
  });
});

describe('cphs_meetings Caso A — draft + first-signature (0 -> 1) transition', () => {
  // A1. DRAFT EDIT ALLOWED — unsigned acta, signatures stays empty, body free.
  it('A1: allows a member to edit body fields while the acta is unsigned', async () => {
    await assertSucceeds(
      updateDoc(mref(authed(MEMBER), 'u1'), {
        minutes: 'acta editada antes de firmar',
        resolutions: ['acuerdo 1'],
      }),
    );
  });

  // A2. FIRST SELF-SIGN ALLOWED — 0 -> 1 with tail uid == caller, body intact.
  it('A2: allows the first signature when its uid is the caller and body is intact', async () => {
    await assertSucceeds(
      updateDoc(mref(authed(MEMBER), 'u1'), { signatures: [{ ...SIG_A, uid: MEMBER }] }),
    );
  });

  // A2. FIRST-SIGN-FOR-ANOTHER DENIED — plant the first signature under another
  //     member's uid (no self-binding) over an unsigned acta.
  it('A2: denies planting the first signature under another member uid', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER), 'u1'), { signatures: [{ ...SIG_B, uid: MEMBER_B }] }),
    );
  });

  // A2. BATCH-PLANT DENIED — 0 -> 2 pre-forged signatures in one write, even if
  //     the first carries the caller's uid (size cap to exactly 1).
  it('A2: denies batch-planting two pre-forged signatures (0 -> 2)', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER), 'u1'), {
        signatures: [{ ...SIG_A, uid: MEMBER }, SIG_B],
      }),
    );
  });

  // A2. BODY-TAMPER-WHILE-SIGNING DENIED — mutate minutes during the first sign.
  it('A2: denies mutating the body while landing the first signature', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER), 'u1'), {
        signatures: [{ ...SIG_A, uid: MEMBER }],
        minutes: 'cuerpo alterado durante la primera firma',
      }),
    );
  });

  // A2. SCHEDULED-DRIFT-WHILE-SIGNING DENIED — committeeId/scheduledAt are
  //     hoisted invariants; drifting scheduledAt during first sign is denied.
  it('A2: denies drifting scheduledAt while landing the first signature', async () => {
    await assertFails(
      updateDoc(mref(authed(MEMBER), 'u1'), {
        signatures: [{ ...SIG_A, uid: MEMBER }],
        scheduledAt: '2099-01-01T00:00:00.000Z',
      }),
    );
  });

  // A. NON-MEMBER DENIED — an outsider cannot edit or first-sign the draft.
  it('A: denies a non-member editing or first-signing an unsigned acta', async () => {
    await assertFails(
      updateDoc(mref(authed(OUTSIDER), 'u1'), { signatures: [{ ...SIG_A, uid: OUTSIDER }] }),
    );
  });
});
