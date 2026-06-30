// SPDX-License-Identifier: MIT
//
// V2 security hardening — anti-spoof creator-uid guards for exceptions and
// shifts (firestore.rules ~887-930, 2026-06-22).
//
// Covers:
//   exceptions  — approvedByUid must match caller on create; immutable on update.
//   shifts      — supervisorUid must match caller on create; immutable on update.
//   legal_obligations — no creator field (N/A); existing member-gated rule unchanged.
//
// CLAUDE.md §4: ≥5 rules tests covering owner-allow, non-member-deny,
// schema/spoof-violation-deny, post-create update-deny (uid change), and
// server-field-spoof-deny.
//
// Run via: npm run test:rules  (requires Firestore emulator + JDK 21).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-v2-antispoof';
const SUPERVISOR = 'supervisor-uid-1';
const OTHER_SUPERVISOR = 'supervisor-uid-2';
const NON_MEMBER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  // Fail-closed: createRulesTestEnv() THROWS if the emulator is unreachable.
  testEnv = await createRulesTestEnv();
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Seed the project with both supervisors + the admin.
    await setDoc(doc(db, 'projects', PID), {
      name: 'Anti-Spoof Test Project',
      createdBy: SUPERVISOR,
      members: [SUPERVISOR, OTHER_SUPERVISOR],
    });
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN,
      email: `${ADMIN}@example.com`,
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
  });
});

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('testEnv not initialized');
  return testEnv;
}

type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, coll: string, id: string) {
  return doc(
    ctxDb as unknown as Parameters<typeof doc>[0],
    'projects', PID, coll, id,
  );
}

async function seed(coll: string, id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, coll, id), data);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// exceptions — approvedByUid
// ──────────────────────────────────────────────────────────────────────────────

describe('exceptions — approvedByUid anti-spoof (V2)', () => {
  // 1. Owner-allow: supervisor creates an exception with their own uid.
  it('supervisor can create an exception with their own approvedByUid', async () => {
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'exceptions', 'ex-1'), {
        approvedByUid: SUPERVISOR,
        domain: 'training_gap',
        status: 'active',
        validUntil: '2026-12-31T00:00:00Z',
      }),
    );
  });

  // 2. Server-field-spoof-deny (create): cannot set approvedByUid to another uid.
  it('member CANNOT spoof approvedByUid to another user on create', async () => {
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'exceptions', 'ex-2'), {
        approvedByUid: OTHER_SUPERVISOR, // spoofed
        domain: 'training_gap',
        status: 'active',
        validUntil: '2026-12-31T00:00:00Z',
      }),
    );
  });

  // 3. Non-member-deny: outsider cannot create at all.
  it('non-member CANNOT create an exception', async () => {
    const db = requireEnv()
      // NON_MEMBER must carry a NON-privileged role: a global 'supervisor'/'admin'
      // claim satisfies isProjectMember() via the global-role branch (firestore.rules
      // isProjectMember → isSupervisor||isAdmin), which would make this outsider write
      // SUCCEED and mask a real cross-project-write property. Peer convention:
      // projectScopedStores.rules.test.ts uses 'worker' for the same reason.
      .authenticatedContext(NON_MEMBER, verifiedToken('worker'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'exceptions', 'ex-3'), {
        approvedByUid: NON_MEMBER,
        domain: 'training_gap',
        status: 'active',
        validUntil: '2026-12-31T00:00:00Z',
      }),
    );
  });

  // 4. Update-allow: owner can update other fields while keeping approvedByUid.
  it('owner can update an exception without changing approvedByUid', async () => {
    await seed('exceptions', 'ex-4', {
      approvedByUid: SUPERVISOR,
      status: 'active',
    });
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'exceptions', 'ex-4'), {
        approvedByUid: SUPERVISOR, // unchanged
        status: 'expired',         // changed — allowed
      }),
    );
  });

  // 5. Update-spoof-deny: cannot reassign approvedByUid on update.
  it('member CANNOT change approvedByUid on update (immutable)', async () => {
    await seed('exceptions', 'ex-5', {
      approvedByUid: SUPERVISOR,
      status: 'active',
    });
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'exceptions', 'ex-5'), {
        approvedByUid: OTHER_SUPERVISOR, // attempt to reassign
        status: 'active',
      }),
    );
  });

  // 6. Delete-allow: admin can delete.
  it('admin can delete an exception', async () => {
    await seed('exceptions', 'ex-6', {
      approvedByUid: SUPERVISOR,
      status: 'active',
    });
    const adminDb = requireEnv()
      .authenticatedContext(ADMIN, verifiedToken('admin'))
      .firestore();
    await assertSucceeds(deleteDoc(ref(adminDb, 'exceptions', 'ex-6')));
  });

  // 7. Delete-deny: a plain worker (role='worker') cannot delete.
  //    Delete is restricted to isAdmin() || isSupervisor() per firestore.rules.
  //    A supervisor CAN delete (correct — tested in test #6 above).
  it('worker CANNOT delete an exception (only admin/supervisor can)', async () => {
    await seed('exceptions', 'ex-7', {
      approvedByUid: SUPERVISOR,
      status: 'active',
    });
    const memberDb = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('worker'))
      .firestore();
    await assertFails(deleteDoc(ref(memberDb, 'exceptions', 'ex-7')));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// shifts — supervisorUid
// ──────────────────────────────────────────────────────────────────────────────

describe('shifts — supervisorUid anti-spoof (V2)', () => {
  // 1. Owner-allow: supervisor creates a shift with their own uid.
  it('supervisor can create a shift with their own supervisorUid', async () => {
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'shifts', 'sh-1'), {
        supervisorUid: SUPERVISOR,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        projectId: PID,
        logEntries: [],
        handoverNotes: [],
      }),
    );
  });

  // 2. Server-field-spoof-deny (create): cannot set supervisorUid to another uid.
  it('member CANNOT spoof supervisorUid to another user on create', async () => {
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'shifts', 'sh-2'), {
        supervisorUid: OTHER_SUPERVISOR, // spoofed
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        projectId: PID,
        logEntries: [],
        handoverNotes: [],
      }),
    );
  });

  // 3. Non-member-deny.
  it('non-member CANNOT create a shift', async () => {
    const db = requireEnv()
      // NON_MEMBER must carry a NON-privileged role: a global 'supervisor'/'admin'
      // claim satisfies isProjectMember() via the global-role branch (firestore.rules
      // isProjectMember → isSupervisor||isAdmin), which would make this outsider write
      // SUCCEED and mask a real cross-project-write property. Peer convention:
      // projectScopedStores.rules.test.ts uses 'worker' for the same reason.
      .authenticatedContext(NON_MEMBER, verifiedToken('worker'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'shifts', 'sh-3'), {
        supervisorUid: NON_MEMBER,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        projectId: PID,
        logEntries: [],
        handoverNotes: [],
      }),
    );
  });

  // 4. Update-allow: member can acknowledge a shift (adds acknowledgedByUid)
  // while keeping supervisorUid unchanged.
  it('member can update a shift (add acknowledgedByUid) without changing supervisorUid', async () => {
    await seed('shifts', 'sh-4', {
      supervisorUid: SUPERVISOR,
      kind: 'morning',
      startedAt: '2026-06-22T06:00:00Z',
      logEntries: [],
      handoverNotes: [],
    });
    const db = requireEnv()
      .authenticatedContext(OTHER_SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'shifts', 'sh-4'), {
        supervisorUid: SUPERVISOR,          // unchanged
        acknowledgedByUid: OTHER_SUPERVISOR, // handover acknowledgement
        acknowledgedAt: '2026-06-22T14:00:00Z',
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        endedAt: '2026-06-22T14:00:00Z',
        logEntries: [],
        handoverNotes: [],
      }),
    );
  });

  // 5. Update-spoof-deny: cannot reassign supervisorUid on update.
  it('member CANNOT change supervisorUid on update (immutable)', async () => {
    await seed('shifts', 'sh-5', {
      supervisorUid: SUPERVISOR,
      kind: 'morning',
      startedAt: '2026-06-22T06:00:00Z',
      logEntries: [],
      handoverNotes: [],
    });
    const db = requireEnv()
      .authenticatedContext(OTHER_SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'shifts', 'sh-5'), {
        supervisorUid: OTHER_SUPERVISOR, // attempt to reassign
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        logEntries: [],
        handoverNotes: [],
      }),
    );
  });

  // 6. Delete-allow: admin can delete.
  it('admin can delete a shift', async () => {
    await seed('shifts', 'sh-6', { supervisorUid: SUPERVISOR, kind: 'morning' });
    const adminDb = requireEnv()
      .authenticatedContext(ADMIN, verifiedToken('admin'))
      .firestore();
    await assertSucceeds(deleteDoc(ref(adminDb, 'shifts', 'sh-6')));
  });

  // 7. Delete-deny: a plain worker (role='worker') cannot delete.
  //    Delete is restricted to isAdmin() || isSupervisor() per firestore.rules.
  //    A supervisor CAN delete (correct — tested in test #6 above).
  it('worker CANNOT delete a shift (only admin/supervisor can)', async () => {
    await seed('shifts', 'sh-7', { supervisorUid: SUPERVISOR, kind: 'morning' });
    const memberDb = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('worker'))
      .firestore();
    await assertFails(deleteDoc(ref(memberDb, 'shifts', 'sh-7')));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// legal_obligations — N/A for anti-spoof (no client-facing creator field)
// The rule is unchanged; these tests pin the existing member-gated behavior.
// ──────────────────────────────────────────────────────────────────────────────

describe('legal_obligations — member-gated (anti-spoof N/A, V2)', () => {
  // 1. Member can create (no creator-uid field required).
  it('member can create a legal_obligation without a creator field', async () => {
    const db = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'legal_obligations', 'lo-1'), {
        kind: 'audit',
        label: 'Annual safety audit',
        legalCitation: 'DS 594 art. 3',
        recurrence: 'annual',
        alertLeadDays: 30,
        nextDueAt: '2027-01-01T00:00:00Z',
        projectId: PID,
      }),
    );
  });

  // 2. Non-member cannot create.
  it('non-member CANNOT create a legal_obligation', async () => {
    const db = requireEnv()
      .authenticatedContext(NON_MEMBER, verifiedToken('worker'))
      .firestore();
    await assertFails(
      setDoc(ref(db, 'legal_obligations', 'lo-2'), {
        kind: 'audit',
        projectId: PID,
      }),
    );
  });

  // 3. Member can update.
  it('member can update a legal_obligation', async () => {
    await seed('legal_obligations', 'lo-3', {
      kind: 'audit',
      projectId: PID,
      nextDueAt: '2027-01-01T00:00:00Z',
    });
    const db = requireEnv()
      .authenticatedContext(OTHER_SUPERVISOR, verifiedToken('supervisor'))
      .firestore();
    await assertSucceeds(
      setDoc(ref(db, 'legal_obligations', 'lo-3'), {
        kind: 'audit',
        projectId: PID,
        nextDueAt: '2027-02-01T00:00:00Z', // rolled forward
        lastAcknowledgedAt: '2026-06-22T00:00:00Z',
      }),
    );
  });

  // 4. Admin can delete.
  it('admin can delete a legal_obligation', async () => {
    await seed('legal_obligations', 'lo-4', { kind: 'audit', projectId: PID });
    const adminDb = requireEnv()
      .authenticatedContext(ADMIN, verifiedToken('admin'))
      .firestore();
    await assertSucceeds(deleteDoc(ref(adminDb, 'legal_obligations', 'lo-4')));
  });

  // 5. Delete-deny: a plain worker (role='worker') cannot delete.
  //    Delete is restricted to isAdmin() || isSupervisor() per firestore.rules.
  //    A supervisor CAN delete (correct — tested in test #4 above).
  it('worker CANNOT delete a legal_obligation (only admin/supervisor can)', async () => {
    await seed('legal_obligations', 'lo-5', { kind: 'audit', projectId: PID });
    const memberDb = requireEnv()
      .authenticatedContext(SUPERVISOR, verifiedToken('worker'))
      .firestore();
    await assertFails(deleteDoc(ref(memberDb, 'legal_obligations', 'lo-5')));
  });
});
