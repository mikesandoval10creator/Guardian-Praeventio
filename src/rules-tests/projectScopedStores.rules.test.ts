// SPDX-License-Identifier: MIT
//
// Rules tests for the 14 Sprint-K client-SDK stores (createProjectScopedStore).
//
// Context: these collections write via the Firebase CLIENT SDK to
// projects/{pid}/<coll> but had NO write rule in firestore.rules — the
// `{subCollection=**}` master-gate granted read-only, so every client save()
// was default-denied in production (masked by the open firestore.test.rules
// used by the firestore-stores CI job). See TODO.md §17 "HALLAZGO CRÍTICO".
//
// These tests pin the conservative write model added 2026-06-01:
//   • create: project member + anti-spoof on the creator-uid field;
//   • update: project member + creator-uid immutable (+ append-only once signed);
//   • delete: false for compliance records, admin/supervisor for operational.
//
// Phase 5 · F1 (2026-06-03): this suite previously swallowed the emulator
// connect error and every test early-returned (`if (!testEnv) return`), so with
// no emulator it reported 78 "passing" tests asserting NOTHING. It now uses the
// shared fail-closed harness (`./_harness`): `createRulesTestEnv()` THROWS when
// the emulator is unreachable, so the `beforeAll` rejects and the suite FAILS
// rather than faking green. Run via `npm run test:rules`.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-stores-1';
const MEMBER = 'member-uid-1';
const OTHER_MEMBER = 'member-uid-2';
const NON_MEMBER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  // Fail-closed: createRulesTestEnv() THROWS if the emulator is unreachable, so
  // this hook rejects and every test FAILS — no silent-pass (the old bug).
  testEnv = await createRulesTestEnv();
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  // Seed the project with two members + an admin user doc, bypassing rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Stores Test Project',
      createdBy: MEMBER,
      members: [MEMBER, OTHER_MEMBER],
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

// `.firestore()` from rules-unit-testing returns the compat Firestore type,
// which the modular `doc()` accepts at runtime; cast to satisfy the typings.
type CtxDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
function ref(ctxDb: CtxDb, coll: string, id: string) {
  return doc(ctxDb as unknown as Parameters<typeof doc>[0], 'projects', PID, coll, id);
}

/** Seed a doc into a store bypassing rules (so we can test update/delete). */
async function seed(coll: string, id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, coll, id), data);
  });
}

interface OwnerStore {
  coll: string;
  owner: string;
  compliance: boolean; // delete must be denied even for admin
  signed?: boolean; // append-only once signedAt is set
}

// Collections with a confirmed creator-uid field (anti-spoof applies).
const OWNER_STORES: OwnerStore[] = [
  { coll: 'stoppages', owner: 'declaredByUid', compliance: true },
  { coll: 'operational_changes', owner: 'declaredByUid', compliance: true },
  { coll: 'root_causes', owner: 'analyzedByUid', compliance: true },
  { coll: 'site_book', owner: 'recordedByUid', compliance: true, signed: true },
  { coll: 'site_book_entries', owner: 'recordedByUid', compliance: true, signed: true },
  { coll: 'lone_worker_sessions', owner: 'workerUid', compliance: false },
  { coll: 'lone_worker_events', owner: 'workerUid', compliance: false },
  { coll: 'safety_talks_given', owner: 'givenByUid', compliance: false },
  { coll: 'audit_portals', owner: 'createdByUid', compliance: false },
  { coll: 'documents_for_read', owner: 'authorUid', compliance: false },
];

// Collections with no confirmed creator-uid field (plain member-gated write).
// NOTE: 'exceptions' (approvedByUid) and 'shifts' (supervisorUid) are excluded —
// they gained anti-spoof creator-uid requirements in the V2 hardening (2026-06-22)
// and are tested in dedicated describe blocks below.
const NO_OWNER_STORES = ['legal_obligations'];

describe('projectScopedStores firestore.rules', () => {
  for (const s of OWNER_STORES) {
    describe(`${s.coll} (owner=${s.owner}, compliance=${s.compliance})`, () => {
      it('member can create their own doc (owner == caller)', async () => {
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(
          setDoc(ref(db, s.coll, 'd1'), { [s.owner]: MEMBER, status: 'active' }),
        );
      });

      it('non-member cannot create', async () => {
        const db = requireEnv().authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd2'), { [s.owner]: NON_MEMBER, status: 'active' }),
        );
      });

      it('member cannot spoof the creator-uid field (server-field-spoof-deny)', async () => {
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd3'), { [s.owner]: OTHER_MEMBER, status: 'active' }),
        );
      });

      it('member can update their own doc keeping the creator-uid', async () => {
        await seed(s.coll, 'd4', { [s.owner]: MEMBER, status: 'active' });
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(
          setDoc(ref(db, s.coll, 'd4'), { [s.owner]: MEMBER, status: 'updated' }),
        );
      });

      it('cannot change the creator-uid on update', async () => {
        await seed(s.coll, 'd5', { [s.owner]: MEMBER, status: 'active' });
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd5'), { [s.owner]: OTHER_MEMBER, status: 'active' }),
        );
      });

      if (s.signed) {
        // The canonical signed shape, mirroring signEntry() (siteBookService.ts)
        // and the adapter's tx.update({ status:'signed', signature }). NO
        // top-level signedAt — production marks signed via status + nested
        // signature.signedAt only.
        const signedDoc = {
          [s.owner]: MEMBER,
          status: 'signed',
          folio: 'SB-2026-000006',
          signature: {
            signerUid: MEMBER,
            signedAt: '2026-06-01T00:00:00Z',
            algorithm: 'webauthn-ecdsa-p256',
            payloadHashHex: 'a'.repeat(64),
          },
        };

        it('cannot mutate a signed entry (real signed shape: status + nested signature)', async () => {
          // B9: gate must trigger on status=='signed', NOT a phantom top-level
          // `signedAt`. This seeds the exact shape prod persists; under the old
          // rule the update below SUCCEEDS (bug) — under the fixed rule it FAILS.
          await seed(s.coll, 'd6', signedDoc);
          const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(
            setDoc(ref(db, s.coll, 'd6'), {
              ...signedDoc,
              status: 'open', // attempt to re-open
              description: 'TAMPERED legally-binding record',
            }),
          );
        });

        it('cannot tamper a signed entry even keeping status=signed (any field change denied)', async () => {
          // Defence-in-depth: once signed the doc is fully immutable — flipping
          // any substantive field (description) while leaving status:'signed'
          // must still be denied.
          await seed(s.coll, 'd6b', signedDoc);
          const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(
            setDoc(ref(db, s.coll, 'd6b'), {
              ...signedDoc,
              description: 'silently rewritten after signature',
            }),
          );
        });

        it('an OPEN (unsigned) entry is still editable by the recorder', async () => {
          // Regression guard: the fix must NOT freeze open entries — the
          // create→edit→sign flow depends on open entries staying mutable.
          await seed(s.coll, 'd6c', { [s.owner]: MEMBER, status: 'open', description: 'draft' });
          const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertSucceeds(
            setDoc(ref(db, s.coll, 'd6c'), { [s.owner]: MEMBER, status: 'open', description: 'draft v2' }),
          );
        });
      }

      if (s.compliance) {
        it('compliance record cannot be deleted (even by admin)', async () => {
          await seed(s.coll, 'd7', { [s.owner]: MEMBER, status: 'active' });
          const adminDb = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
          await assertFails(deleteDoc(ref(adminDb, s.coll, 'd7')));
        });
      } else {
        it('member cannot delete; admin/supervisor can', async () => {
          await seed(s.coll, 'd8', { [s.owner]: MEMBER, status: 'active' });
          const memberDb = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(deleteDoc(ref(memberDb, s.coll, 'd8')));
          const adminDb = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
          await assertSucceeds(deleteDoc(ref(adminDb, s.coll, 'd8')));
        });
      }
    });
  }

  for (const coll of NO_OWNER_STORES) {
    describe(`${coll} (member-gated, no owner field)`, () => {
      it('member can create', async () => {
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(setDoc(ref(db, coll, 'd1'), { status: 'open' }));
      });
      it('non-member cannot create', async () => {
        const db = requireEnv().authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(setDoc(ref(db, coll, 'd2'), { status: 'open' }));
      });
      it('member can update', async () => {
        await seed(coll, 'd3', { status: 'open' });
        const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(setDoc(ref(db, coll, 'd3'), { status: 'closed' }));
      });
      it('member cannot delete; admin can', async () => {
        await seed(coll, 'd4', { status: 'open' });
        const memberDb = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(deleteDoc(ref(memberDb, coll, 'd4')));
        const adminDb = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
        await assertSucceeds(deleteDoc(ref(adminDb, coll, 'd4')));
      });
      it('non-member cannot update', async () => {
        await seed(coll, 'd5', { status: 'open' });
        const db = requireEnv().authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(setDoc(ref(db, coll, 'd5'), { status: 'closed' }));
      });
    });
  }

  // exceptions — V2 anti-spoof: approvedByUid must equal request.auth.uid on
  // create; immutable on update. delete is allowed for admin OR supervisor.
  describe('exceptions (member-gated, approvedByUid anti-spoof)', () => {
    it('member can create with their own approvedByUid', async () => {
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertSucceeds(
        setDoc(ref(db, 'exceptions', 'ex-s1'), { approvedByUid: MEMBER, status: 'open' }),
      );
    });
    it('non-member cannot create', async () => {
      const db = requireEnv().authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'exceptions', 'ex-s2'), { approvedByUid: NON_MEMBER, status: 'open' }),
      );
    });
    it('member can update keeping approvedByUid unchanged', async () => {
      await seed('exceptions', 'ex-s3', { approvedByUid: MEMBER, status: 'open' });
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertSucceeds(
        setDoc(ref(db, 'exceptions', 'ex-s3'), { approvedByUid: MEMBER, status: 'closed' }),
      );
    });
    it('member cannot spoof approvedByUid on create', async () => {
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'exceptions', 'ex-s4'), { approvedByUid: OTHER_MEMBER, status: 'open' }),
      );
    });
    it('member cannot change approvedByUid on update (immutable)', async () => {
      await seed('exceptions', 'ex-s5', { approvedByUid: MEMBER, status: 'open' });
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'exceptions', 'ex-s5'), { approvedByUid: OTHER_MEMBER, status: 'open' }),
      );
    });
    it('worker CANNOT delete; admin can (delete rule: isAdmin || isSupervisor)', async () => {
      await seed('exceptions', 'ex-s6', { approvedByUid: MEMBER, status: 'open' });
      const memberDb = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(deleteDoc(ref(memberDb, 'exceptions', 'ex-s6')));
      const adminDb = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
      await assertSucceeds(deleteDoc(ref(adminDb, 'exceptions', 'ex-s6')));
    });
  });

  // shifts — V3 supervisor-role-gated: only isSupervisor()/isAdmin() may create
  // or mutate a shift; supervisorUid must equal the caller uid on create and stay
  // immutable on update. A plain worker is denied (privilege-escalation fix).
  describe('shifts (supervisor-role-gated, anti-spoof)', () => {
    it('SECURITY: a worker (non-supervisor) member CANNOT create a shift', async () => {
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'shifts', 'sh-s1'), {
          supervisorUid: MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('a supervisor member can create with their own supervisorUid', async () => {
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('supervisor')).firestore();
      await assertSucceeds(
        setDoc(ref(db, 'shifts', 'sh-sup1'), {
          supervisorUid: MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('non-member cannot create', async () => {
      const db = requireEnv().authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'shifts', 'sh-s2'), {
          supervisorUid: NON_MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('SECURITY: a worker member CANNOT update a shift (close it / edit notes)', async () => {
      await seed('shifts', 'sh-s3', {
        supervisorUid: MEMBER,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        logEntries: [],
        handoverNotes: [],
      });
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'shifts', 'sh-s3'), {
          supervisorUid: MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          endedAt: '2026-06-22T14:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('a supervisor member can update keeping supervisorUid unchanged', async () => {
      await seed('shifts', 'sh-sup3', {
        supervisorUid: MEMBER,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        logEntries: [],
        handoverNotes: [],
      });
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('supervisor')).firestore();
      await assertSucceeds(
        setDoc(ref(db, 'shifts', 'sh-sup3'), {
          supervisorUid: MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          endedAt: '2026-06-22T14:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('member cannot spoof supervisorUid on create', async () => {
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'shifts', 'sh-s4'), {
          supervisorUid: OTHER_MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('member cannot change supervisorUid on update (immutable)', async () => {
      await seed('shifts', 'sh-s5', {
        supervisorUid: MEMBER,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        logEntries: [],
        handoverNotes: [],
      });
      const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(
        setDoc(ref(db, 'shifts', 'sh-s5'), {
          supervisorUid: OTHER_MEMBER,
          kind: 'morning',
          startedAt: '2026-06-22T06:00:00Z',
          logEntries: [],
          handoverNotes: [],
        }),
      );
    });
    it('worker CANNOT delete; admin can (delete rule: isAdmin || isSupervisor)', async () => {
      await seed('shifts', 'sh-s6', {
        supervisorUid: MEMBER,
        kind: 'morning',
        startedAt: '2026-06-22T06:00:00Z',
        logEntries: [],
        handoverNotes: [],
      });
      const memberDb = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
      await assertFails(deleteDoc(ref(memberDb, 'shifts', 'sh-s6')));
      const adminDb = requireEnv().authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
      await assertSucceeds(deleteDoc(ref(adminDb, 'shifts', 'sh-s6')));
    });
  });

  // B17 (Fase 5) — lone-worker session integrity. A lone-worker session/event
  // belongs to ONE worker; a different project member must NOT be able to flip
  // its state (e.g. mark a worker-in-distress as "safe"). Only the owner or a
  // rescue coordinator (admin/supervisor) may update it.
  for (const coll of ['lone_worker_sessions', 'lone_worker_events']) {
    describe(`${coll} (owner-or-rescuer update integrity)`, () => {
      it('a DIFFERENT member cannot update the worker\'s session', async () => {
        await seed(coll, 'lw1', { workerUid: MEMBER, status: 'active' });
        const otherDb = requireEnv()
          .authenticatedContext(OTHER_MEMBER, verifiedToken('worker'))
          .firestore();
        await assertFails(
          setDoc(ref(otherDb, coll, 'lw1'), { workerUid: MEMBER, status: 'safe' }),
        );
      });

      it('the owning worker can update their own session', async () => {
        await seed(coll, 'lw2', { workerUid: MEMBER, status: 'active' });
        const ownerDb = requireEnv()
          .authenticatedContext(MEMBER, verifiedToken('worker'))
          .firestore();
        await assertSucceeds(
          setDoc(ref(ownerDb, coll, 'lw2'), { workerUid: MEMBER, status: 'safe' }),
        );
      });

      it('a supervisor (rescue coordinator) can update any worker\'s session', async () => {
        await seed(coll, 'lw3', { workerUid: MEMBER, status: 'active' });
        const supDb = requireEnv()
          .authenticatedContext('supervisor-uid-1', verifiedToken('supervisor'))
          .firestore();
        await assertSucceeds(
          setDoc(ref(supDb, coll, 'lw3'), { workerUid: MEMBER, status: 'rescued' }),
        );
      });
    });
  }
});
