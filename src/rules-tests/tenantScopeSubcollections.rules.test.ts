// SPDX-License-Identifier: MIT
//
// M-1 Phase 3 — the SUBCOLLECTION-SPECIFIC leak (firestore.rules, 2026-07-21).
//
// The master gate (`match /{subCollection=**}` under /projects) was already
// tenant-scoped. But subcollections with their OWN `allow read` rule that used
// the legacy global `isProjectMember()` RE-OPENED the leak: in Firestore, read
// rules combine with OR, so a specific rule granting a GLOBAL admin/supervisor
// of tenant B access to tenant A's attendance/reports overrode the master
// gate's deny. This suite proves that after migrating those rules to
// `isProjectMemberTenantScoped()`, the specific-rule leak is closed while the
// member / creator / same-tenant path (life-safety) still works.
//
// (CLAUDE.md #4 — ≥5 rules-tests, owner-allow + non-member-deny + cross-tenant.)

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const MEMBER_B = 'member-b-uid'; // member of PROJECT_B (t2)
const CREATOR_B = 'creator-b-uid'; // created PROJECT_B (t2), not in members
const SUP_T2 = 'sup-t2-uid'; // supervisor, tenant t2 claim
const ADMIN_T1 = 'admin-t1-uid'; // admin, tenant t1 claim — the hostile cross-tenant actor
const MEMBER_A = 'member-a-uid'; // member of PROJECT_A (t1)

const PROJECT_A = 'project-alpha'; // tenant t1
const PROJECT_B = 'project-beta'; // tenant t2

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

type CtxDb = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function fs(uid: string, role = 'worker', tenantId?: string): CtxDb {
  return requireEnv()
    .authenticatedContext(uid, verifiedToken(role, `${uid}@example.com`, tenantId ? { tenantId } : {}))
    .firestore();
}
function db(ctx: CtxDb) {
  return ctx as unknown as Parameters<typeof collection>[0];
}

async function seed() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'projects', PROJECT_A), {
      name: 'Alpha', tenantId: 't1', members: [MEMBER_A],
      createdBy: MEMBER_A, status: 'active', createdAt: '2026-07-04T00:00:00.000Z',
    });
    await setDoc(doc(d, 'projects', PROJECT_B), {
      name: 'Beta', tenantId: 't2', members: [MEMBER_B],
      createdBy: CREATOR_B, status: 'active', createdAt: '2026-07-04T00:00:00.000Z',
    });
    // Attendance under PROJECT_B (t2) — a subcollection with its OWN read rule.
    await setDoc(doc(d, 'projects', PROJECT_B, 'attendance', 'a1'), {
      workerId: MEMBER_B, projectId: PROJECT_B, recordedBy: MEMBER_B,
      timestamp: '2026-07-04T08:00:00.000Z',
    });
    for (const [uid, role] of [
      [MEMBER_B, 'worker'], [CREATOR_B, 'worker'], [SUP_T2, 'supervisor'],
      [ADMIN_T1, 'admin'], [MEMBER_A, 'worker'],
    ] as const) {
      await setDoc(doc(d, 'users', uid), { role });
    }
  });
}

describe('M-1 subcollection-specific rules — tenant-scoped (attendance)', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seed();
  });

  // ── Preserved: legitimate same-tenant access (life-safety headcount path) ──
  it('member of PROJECT_B CAN read its attendance', async () => {
    await assertSucceeds(getDoc(doc(db(fs(MEMBER_B)), 'projects', PROJECT_B, 'attendance', 'a1')));
  });
  it('creator of PROJECT_B CAN read its attendance (not in members[])', async () => {
    await assertSucceeds(getDoc(doc(db(fs(CREATOR_B)), 'projects', PROJECT_B, 'attendance', 'a1')));
  });
  it('supervisor of tenant t2 CAN read PROJECT_B attendance', async () => {
    await assertSucceeds(getDoc(doc(db(fs(SUP_T2, 'supervisor', 't2')), 'projects', PROJECT_B, 'attendance', 'a1')));
  });

  // ── THE FIX: the specific-rule cross-tenant leak is closed ─────────────────
  it('M-1 KEY: GLOBAL admin of tenant t1 CANNOT read PROJECT_B (t2) attendance via the specific rule', async () => {
    await assertFails(getDoc(doc(db(fs(ADMIN_T1, 'admin', 't1')), 'projects', PROJECT_B, 'attendance', 'a1')));
  });
  it('admin with NO tenantId claim CANNOT read another project attendance by role alone', async () => {
    await assertFails(getDoc(doc(db(fs(ADMIN_T1, 'admin')), 'projects', PROJECT_B, 'attendance', 'a1')));
  });
  it('member of PROJECT_A CANNOT read PROJECT_B attendance (non-member, wrong tenant)', async () => {
    await assertFails(getDoc(doc(db(fs(MEMBER_A, 'worker', 't1')), 'projects', PROJECT_B, 'attendance', 'a1')));
  });
});
