// SPDX-License-Identifier: MIT
//
// Rules tests for the "rules-trio" (2026-06-13) — three firestore.rules holes:
//
//   (A) projects/{pid}/root_cause_analyses/{incidentId}
//       The 5-Why analyses persisted CLIENT-SIDE by rootCauseStore.ts
//       (RootCauseInvestigation.tsx) had NO write rule — the {subCollection=**}
//       master-gate granted read-only, so every save() was default-denied. New
//       rule: member create with anti-spoof on `analyzedByUid`, immutable owner
//       on update, no client delete (compliance record).
//
//   (B) /nodes/{nodeId} anonymous public read.
//       The public QR-scan page (PublicNodeView.tsx, route /public/node/:nodeId,
//       OUTSIDE the auth-gated RootLayout) was re-wired to read the canonical
//       `nodes` collection. The read rule now grants ANONYMOUS read to a node
//       flagged isPublic:true that carries NO worker RUT; RUT-bearing and private
//       nodes stay restricted (PII defence in depth).
//
//   (C) /user_stats/{userId} — XP is server-authoritative.
//       The owner-update rule used to allow `points`/`medals`/`completedTrainings`
//       /`safetyPosts`, so a user could self-grant XP and manipulate the
//       leaderboard. Those keys are removed from the owner's hasOnly() set; only
//       non-gameable session/profile fields remain owner-writable.
//       Review #876 hardening: `role` is ALSO removed from the owner-update set
//       (privilege-escalation vector) and the bootstrap `create` rule now
//       rejects pre-loaded `medals`/`completedTrainings`/`safetyPosts`/
//       `completedChallenges`/`role` (previously only `points == 0` was checked).
//
// Uses the F1 fail-closed harness (`./_harness`): the emulator must be up or the
// suite FAILS (never silent-pass). Run via `npm run test:rules`.

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const PID = 'proj-rules-trio-1';
const MEMBER = 'member-uid-1';
const OTHER_MEMBER = 'member-uid-2';
const NON_MEMBER = 'outsider-uid-9';
const ADMIN = 'admin-uid-1';

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  // Fail-closed: createRulesTestEnv() THROWS if the emulator is unreachable, so
  // this hook rejects and every test FAILS — no silent-pass.
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
function authed(uid: string, role = 'worker') {
  return requireEnv().authenticatedContext(uid, verifiedToken(role, `${uid}@x.cl`)).firestore();
}
function anon() {
  return requireEnv().unauthenticatedContext().firestore();
}

beforeEach(async () => {
  const env = requireEnv();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', PID), {
      name: 'Rules Trio Test',
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

// ─────────────────────────────────────────────────────────────────────────────
// (A) projects/{pid}/root_cause_analyses
// ─────────────────────────────────────────────────────────────────────────────
function rcaRef(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'projects', PID, 'root_cause_analyses', id);
}
async function seedRca(id: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', PID, 'root_cause_analyses', id), data);
  });
}

describe('(A) root_cause_analyses firestore.rules', () => {
  it('owner-allow: member can create their own analysis (analyzedByUid == caller)', async () => {
    await assertSucceeds(
      setDoc(rcaRef(authed(MEMBER), 'inc-1'), {
        incidentId: 'inc-1',
        analyzedByUid: MEMBER,
        primaryFactor: 'falla_epp',
        factors: ['falla_epp'],
      }),
    );
  });

  it('non-member-deny: an outsider cannot create', async () => {
    await assertFails(
      setDoc(rcaRef(authed(NON_MEMBER), 'inc-2'), {
        incidentId: 'inc-2',
        analyzedByUid: NON_MEMBER,
        primaryFactor: 'falla_epp',
        factors: ['falla_epp'],
      }),
    );
  });

  it('server-field-spoof-deny: member cannot create with someone else as analyzedByUid', async () => {
    await assertFails(
      setDoc(rcaRef(authed(MEMBER), 'inc-3'), {
        incidentId: 'inc-3',
        analyzedByUid: OTHER_MEMBER,
        primaryFactor: 'falla_epp',
        factors: ['falla_epp'],
      }),
    );
  });

  it('update-keep-owner: member can update their own analysis keeping analyzedByUid', async () => {
    await seedRca('inc-4', { incidentId: 'inc-4', analyzedByUid: MEMBER, primaryFactor: 'falla_epp', factors: ['falla_epp'] });
    await assertSucceeds(
      setDoc(rcaRef(authed(MEMBER), 'inc-4'), { incidentId: 'inc-4', analyzedByUid: MEMBER, primaryFactor: 'falla_supervision', factors: ['falla_supervision'] }),
    );
  });

  it('update-spoof-deny: cannot reassign analyzedByUid on update', async () => {
    await seedRca('inc-5', { incidentId: 'inc-5', analyzedByUid: MEMBER, primaryFactor: 'falla_epp', factors: ['falla_epp'] });
    await assertFails(
      setDoc(rcaRef(authed(MEMBER), 'inc-5'), { incidentId: 'inc-5', analyzedByUid: OTHER_MEMBER, primaryFactor: 'falla_epp', factors: ['falla_epp'] }),
    );
  });

  it('delete-deny: compliance record cannot be deleted, even by admin', async () => {
    await seedRca('inc-6', { incidentId: 'inc-6', analyzedByUid: MEMBER, primaryFactor: 'falla_epp', factors: ['falla_epp'] });
    await assertFails(deleteDoc(rcaRef(authed(ADMIN, 'admin'), 'inc-6')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) /nodes anonymous public read
// ─────────────────────────────────────────────────────────────────────────────
const PUBLIC_NODE = 'node-public';
const PRIVATE_NODE = 'node-private';
const PUBLIC_RUT_NODE = 'node-public-rut';

function nodeRef(db: CtxDb, id: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'nodes', id);
}
const baseNode = (over: Record<string, unknown> = {}) => ({
  type: 'RISK',
  title: 'Riesgo: piso resbaloso',
  description: 'Control: antideslizante.',
  projectId: PID,
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
  metadata: { authorId: MEMBER },
  ...over,
});

describe('(B) nodes anonymous public read — firestore.rules', () => {
  beforeEach(async () => {
    await requireEnv().withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'nodes', PUBLIC_NODE), baseNode({ isPublic: true }));
      await setDoc(doc(db, 'nodes', PRIVATE_NODE), baseNode({ isPublic: false }));
      await setDoc(doc(db, 'nodes', PUBLIC_RUT_NODE), baseNode({
        isPublic: true,
        metadata: { authorId: MEMBER, workerRut: '12.345.678-5' },
      }));
    });
  });

  it('THE FIX — an ANONYMOUS caller CAN read a public, non-RUT node (QR-scan page)', async () => {
    await assertSucceeds(getDoc(nodeRef(anon() as unknown as CtxDb, PUBLIC_NODE)));
  });

  it('an anonymous caller CANNOT read a non-public node', async () => {
    await assertFails(getDoc(nodeRef(anon() as unknown as CtxDb, PRIVATE_NODE)));
  });

  it('PII guard — an anonymous caller CANNOT read a public node that carries a worker RUT', async () => {
    await assertFails(getDoc(nodeRef(anon() as unknown as CtxDb, PUBLIC_RUT_NODE)));
  });

  it('NO REGRESSION — a verified project member can still read an ordinary (private) node', async () => {
    await assertSucceeds(getDoc(nodeRef(authed(MEMBER), PRIVATE_NODE)));
  });

  it('PII guard depth — a verified NON-MEMBER still cannot read a public RUT-bearing node', async () => {
    await assertFails(getDoc(nodeRef(authed(NON_MEMBER), PUBLIC_RUT_NODE)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) /user_stats XP server-authoritative
// ─────────────────────────────────────────────────────────────────────────────
function statsRef(db: CtxDb, uid: string) {
  return doc(db as unknown as Parameters<typeof doc>[0], 'user_stats', uid);
}
async function seedStats(uid: string, data: Record<string, unknown>) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'user_stats', uid), data);
  });
}

describe('(C) user_stats XP server-authoritative — firestore.rules', () => {
  beforeEach(async () => {
    await seedStats(MEMBER, {
      points: 100,
      medals: ['m1'],
      completedTrainings: 2,
      safetyPosts: 1,
      loginStreak: 3,
      lastLogin: '2026-06-12T00:00:00Z',
      updatedAt: '2026-06-12T00:00:00Z',
    });
  });

  it('THE FIX — owner CANNOT self-grant points (leaderboard manipulation denied)', async () => {
    await assertFails(
      setDoc(statsRef(authed(MEMBER), MEMBER), {
        points: 999999, medals: ['m1'], completedTrainings: 2, safetyPosts: 1,
        loginStreak: 3, lastLogin: '2026-06-12T00:00:00Z', updatedAt: '2026-06-13T00:00:00Z',
      }),
    );
  });

  it('THE FIX — owner CANNOT self-grant a medal', async () => {
    await assertFails(
      setDoc(statsRef(authed(MEMBER), MEMBER), {
        points: 100, medals: ['m1', 'gold-cheat'], completedTrainings: 2, safetyPosts: 1,
        loginStreak: 3, lastLogin: '2026-06-12T00:00:00Z', updatedAt: '2026-06-13T00:00:00Z',
      }),
    );
  });

  it('owner CANNOT bump completedTrainings / safetyPosts (server-authoritative XP)', async () => {
    await assertFails(
      setDoc(statsRef(authed(MEMBER), MEMBER), {
        points: 100, medals: ['m1'], completedTrainings: 999, safetyPosts: 999,
        loginStreak: 3, lastLogin: '2026-06-12T00:00:00Z', updatedAt: '2026-06-13T00:00:00Z',
      }),
    );
  });

  it('NO REGRESSION — owner CAN still update their non-gameable session fields', async () => {
    await assertSucceeds(
      setDoc(
        statsRef(authed(MEMBER), MEMBER),
        { loginStreak: 4, lastLogin: '2026-06-13T00:00:00Z', displayName: 'Ana', updatedAt: '2026-06-13T00:00:00Z' },
        { merge: true },
      ),
    );
  });

  it('a non-owner CANNOT update another user stats', async () => {
    await assertFails(
      setDoc(
        statsRef(authed(OTHER_MEMBER), MEMBER),
        { loginStreak: 99, lastLogin: '2026-06-13T00:00:00Z', updatedAt: '2026-06-13T00:00:00Z' },
        { merge: true },
      ),
    );
  });

  // ── review #876 hardening ──────────────────────────────────────────────────
  // (A) `role` is a privilege-escalation vector: the owner must NOT be able to
  //     write `role` into their own user_stats doc. It was removed from the
  //     owner-update hasOnly() set, so this falls through to deny.
  it('SECURITY #876 — owner CANNOT update user_stats with role:supervisor (privilege escalation)', async () => {
    await assertFails(
      setDoc(
        statsRef(authed(MEMBER), MEMBER),
        { loginStreak: 4, lastLogin: '2026-06-13T00:00:00Z', role: 'supervisor', updatedAt: '2026-06-13T00:00:00Z' },
        { merge: true },
      ),
    );
  });

  // (B) bootstrap create must reject pre-loaded server-authoritative XP. The
  //     create doc starts a FRESH user (the beforeEach seed is for MEMBER), so
  //     we create the OTHER_MEMBER doc with medals/completedTrainings already
  //     set — must be denied even though points == 0.
  it('SECURITY #876 — owner CANNOT create user_stats with medals/completedTrainings pre-loaded', async () => {
    await assertFails(
      setDoc(statsRef(authed(OTHER_MEMBER), OTHER_MEMBER), {
        points: 0,
        medals: ['gold-cheat'],
        completedTrainings: 99,
        loginStreak: 0,
        updatedAt: '2026-06-13T00:00:00Z',
      }),
    );
  });

  it('SECURITY #876 — owner CAN create a clean bootstrap user_stats (mirrors useGamification initialStats)', async () => {
    await assertSucceeds(
      setDoc(statsRef(authed(OTHER_MEMBER), OTHER_MEMBER), {
        points: 0,
        medals: [],
        lastLogin: '2026-06-13T00:00:00Z',
        loginStreak: 1,
        completedChallenges: {},
        displayName: 'Ana',
      }),
    );
  });

  // (C) `completedChallenges` is server-authoritative too — the owner must not
  //     be able to seed/extend it directly to cross a medal threshold.
  it('SECURITY #876 — owner CANNOT update completedChallenges directly', async () => {
    await assertFails(
      setDoc(
        statsRef(authed(MEMBER), MEMBER),
        { completedChallenges: { report_hazard: '2026-06-13T00:00:00Z' }, updatedAt: '2026-06-13T00:00:00Z' },
        { merge: true },
      ),
    );
  });
});
