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
const NO_OWNER_STORES = ['exceptions', 'legal_obligations', 'shifts'];

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
        it('cannot update once signed (post-sign update-deny)', async () => {
          // FIXME(B9): the rule gate (firestore.rules:414) checks TOP-LEVEL
          // `signedAt`, and this seeds top-level `signedAt` to match it — so it
          // validates the gate AS WRITTEN. But production signs via NESTED
          // `signature.signedAt` (siteBookSigning.ts), which the gate does NOT
          // catch → a real signed site_book stays mutable in prod. Reconcile
          // rule + sign-path + seed to ONE shape in B9.
          await seed(s.coll, 'd6', { [s.owner]: MEMBER, status: 'signed', signedAt: '2026-06-01T00:00:00Z' });
          const db = requireEnv().authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(
            setDoc(ref(db, s.coll, 'd6'), { [s.owner]: MEMBER, status: 'tampered', signedAt: '2026-06-01T00:00:00Z' }),
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
});
