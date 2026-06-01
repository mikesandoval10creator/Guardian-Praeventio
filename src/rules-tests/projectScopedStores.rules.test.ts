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
// Emulator dependency: like the sibling rules suites, this auto-skips when the
// Firestore emulator is unreachable (run via `npm run test:rules`).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, setLogLevel } from 'firebase/firestore';

const PROJECT_ID = 'praeventio-rules-test';
const RULES_PATH = resolve(__dirname, '../../firestore.rules');

const PID = 'proj-stores-1';
const MEMBER = 'member-uid-1';
const OTHER_MEMBER = 'member-uid-2';
const NON_MEMBER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';

function verifiedToken(role: string, email = 'user@example.com') {
  return { email, email_verified: true, role };
}

let testEnv: RulesTestEnvironment | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  setLogLevel('silent');
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
    });
  } catch (err) {
    skipReason = `Firestore emulator not reachable: ${(err as Error).message}`;
    testEnv = null;
  }
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (!testEnv) return;
  await testEnv.clearFirestore();
  // Seed the project with two members + an admin user doc, bypassing rules.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
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
  it('skips when the emulator is unavailable', () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.warn(`[projectScopedStores.rules] SKIPPED — ${skipReason}`);
    }
  });

  for (const s of OWNER_STORES) {
    describe(`${s.coll} (owner=${s.owner}, compliance=${s.compliance})`, () => {
      it('member can create their own doc (owner == caller)', async () => {
        if (!testEnv) return;
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(
          setDoc(ref(db, s.coll, 'd1'), { [s.owner]: MEMBER, status: 'active' }),
        );
      });

      it('non-member cannot create', async () => {
        if (!testEnv) return;
        const db = testEnv.authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd2'), { [s.owner]: NON_MEMBER, status: 'active' }),
        );
      });

      it('member cannot spoof the creator-uid field (server-field-spoof-deny)', async () => {
        if (!testEnv) return;
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd3'), { [s.owner]: OTHER_MEMBER, status: 'active' }),
        );
      });

      it('member can update their own doc keeping the creator-uid', async () => {
        if (!testEnv) return;
        await seed(s.coll, 'd4', { [s.owner]: MEMBER, status: 'active' });
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(
          setDoc(ref(db, s.coll, 'd4'), { [s.owner]: MEMBER, status: 'updated' }),
        );
      });

      it('cannot change the creator-uid on update', async () => {
        if (!testEnv) return;
        await seed(s.coll, 'd5', { [s.owner]: MEMBER, status: 'active' });
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(
          setDoc(ref(db, s.coll, 'd5'), { [s.owner]: OTHER_MEMBER, status: 'active' }),
        );
      });

      if (s.signed) {
        it('cannot update once signed (post-sign update-deny)', async () => {
          if (!testEnv) return;
          await seed(s.coll, 'd6', { [s.owner]: MEMBER, status: 'signed', signedAt: '2026-06-01T00:00:00Z' });
          const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(
            setDoc(ref(db, s.coll, 'd6'), { [s.owner]: MEMBER, status: 'tampered', signedAt: '2026-06-01T00:00:00Z' }),
          );
        });
      }

      if (s.compliance) {
        it('compliance record cannot be deleted (even by admin)', async () => {
          if (!testEnv) return;
          await seed(s.coll, 'd7', { [s.owner]: MEMBER, status: 'active' });
          const adminDb = testEnv.authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
          await assertFails(deleteDoc(ref(adminDb, s.coll, 'd7')));
        });
      } else {
        it('member cannot delete; admin/supervisor can', async () => {
          if (!testEnv) return;
          await seed(s.coll, 'd8', { [s.owner]: MEMBER, status: 'active' });
          const memberDb = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
          await assertFails(deleteDoc(ref(memberDb, s.coll, 'd8')));
          const adminDb = testEnv.authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
          await assertSucceeds(deleteDoc(ref(adminDb, s.coll, 'd8')));
        });
      }
    });
  }

  for (const coll of NO_OWNER_STORES) {
    describe(`${coll} (member-gated, no owner field)`, () => {
      it('member can create', async () => {
        if (!testEnv) return;
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(setDoc(ref(db, coll, 'd1'), { status: 'open' }));
      });
      it('non-member cannot create', async () => {
        if (!testEnv) return;
        const db = testEnv.authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(setDoc(ref(db, coll, 'd2'), { status: 'open' }));
      });
      it('member can update', async () => {
        if (!testEnv) return;
        await seed(coll, 'd3', { status: 'open' });
        const db = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertSucceeds(setDoc(ref(db, coll, 'd3'), { status: 'closed' }));
      });
      it('member cannot delete; admin can', async () => {
        if (!testEnv) return;
        await seed(coll, 'd4', { status: 'open' });
        const memberDb = testEnv.authenticatedContext(MEMBER, verifiedToken('worker')).firestore();
        await assertFails(deleteDoc(ref(memberDb, coll, 'd4')));
        const adminDb = testEnv.authenticatedContext(ADMIN, verifiedToken('admin')).firestore();
        await assertSucceeds(deleteDoc(ref(adminDb, coll, 'd4')));
      });
      it('non-member cannot update', async () => {
        if (!testEnv) return;
        await seed(coll, 'd5', { status: 'open' });
        const db = testEnv.authenticatedContext(NON_MEMBER, verifiedToken('worker')).firestore();
        await assertFails(setDoc(ref(db, coll, 'd5'), { status: 'closed' }));
      });
    });
  }
});
