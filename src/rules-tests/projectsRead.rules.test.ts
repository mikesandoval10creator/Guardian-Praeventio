// SPDX-License-Identifier: MIT
//
// Top-level `projects/{projectId}` rules — firestore.rules.
//
// M-1 Phase 3 (docs/security/M1-multitenant-tenant-scope-design.md): the
// project model is TENANT-SCOPED. A GLOBAL admin/supervisor of tenant t1 must
// NOT read/list/write a project owned by tenant t2 — privilege is now
// `isSupervisorOfTenant(project.tenantId)`, not a global role. The MEMBER and
// CREATOR branches are preserved (life-safety: the SOS/evacuation path still
// works for a project member). `tenantId` is required on the doc, immutable,
// and can only be stamped to the caller's own uid (anti-spoof).
//
// Regression guard for the SOS E2E (tests/e2e/sos-button.spec.ts): the member
// LIST (`where('members','array-contains',uid)`) must keep succeeding so
// ProjectContext auto-selects the emergency project and renders SOSButton.
// (CLAUDE.md #4 — ≥5 rules-tests; the design §5 asks for ≥9.)

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { createRulesTestEnv, verifiedToken } from './_harness';

const MEMBER = 'member-uid-1'; // member of PROJECT_A (t1), role worker
const UNVERIFIED = 'unverified-uid-2'; // member of PROJECT_A but email NOT verified
const OUTSIDER = 'outsider-uid-3'; // member + creator of PROJECT_B (t2)
const CREATOR = 'creator-uid-5'; // created PROJECT_A (t1), NOT in its members
const SUP_T1 = 'sup-t1-uid-6'; // supervisor, tenantId claim t1, member of nothing
const ADMIN_T1 = 'admin-t1-uid-7'; // admin, tenantId claim t1, member of nothing
const OWNER = 'owner-uid-8'; // owns PROJECT_OWN (tenantId == its own uid)

const PROJECT_A = 'project-alpha'; // tenant t1
const PROJECT_B = 'project-beta'; // tenant t2
const PROJECT_OWN = 'project-own'; // tenant == OWNER uid

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
// `tenantId` injects the single-tenant custom claim the tenant-scoped rules read.
function fs(uid: string, role = 'worker', tenantId?: string, emailVerified = true): CtxDb {
  const token = emailVerified
    ? verifiedToken(role, `${uid}@example.com`, tenantId ? { tenantId } : {})
    : { email: `${uid}@example.com`, email_verified: false, role };
  return requireEnv().authenticatedContext(uid, token).firestore();
}
function db(ctx: CtxDb) {
  return ctx as unknown as Parameters<typeof collection>[0];
}

// A schema-valid project doc (isValidProject) with overridable fields.
function validProject(overrides: Record<string, unknown>) {
  return {
    name: 'P',
    members: [] as string[],
    status: 'active',
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

async function seed() {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'projects', PROJECT_A), {
      name: 'Alpha', tenantId: 't1', members: [MEMBER, UNVERIFIED],
      createdBy: CREATOR, status: 'active', createdAt: '2026-07-04T00:00:00.000Z',
    });
    await setDoc(doc(d, 'projects', PROJECT_B), {
      name: 'Beta', tenantId: 't2', members: [OUTSIDER],
      createdBy: OUTSIDER, status: 'active', createdAt: '2026-07-04T00:00:00.000Z',
    });
    await setDoc(doc(d, 'projects', PROJECT_OWN), {
      name: 'Own', tenantId: OWNER, members: [OWNER],
      createdBy: OWNER, status: 'active', createdAt: '2026-07-04T00:00:00.000Z',
    });
    // A subcollection doc under PROJECT_B (t2) for the master-gate leak test.
    await setDoc(doc(d, 'projects', PROJECT_B, 'reports', 'r1'), {
      title: 'B report', type: 'Incidente', status: 'Pendiente',
      projectId: PROJECT_B, createdAt: '2026-07-04T00:00:00.000Z',
    });
    for (const [uid, role] of [
      [MEMBER, 'worker'], [UNVERIFIED, 'worker'], [OUTSIDER, 'worker'],
      [CREATOR, 'worker'], [SUP_T1, 'supervisor'], [ADMIN_T1, 'admin'], [OWNER, 'gerente'],
    ] as const) {
      await setDoc(doc(d, 'users', uid), { role });
    }
  });
}

describe('projects/{projectId} — M-1 tenant-scoped rules', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seed();
  });

  // ── Preserved: member / creator access (life-safety path) ──────────────────
  it('member CAN list their projects via members array-contains (SOS/ProjectContext path)', async () => {
    await assertSucceeds(
      getDocs(query(collection(db(fs(MEMBER)), 'projects'), where('members', 'array-contains', MEMBER))),
    );
  });
  it('member CAN get a project they belong to', async () => {
    await assertSucceeds(getDoc(doc(db(fs(MEMBER)), 'projects', PROJECT_A)));
  });
  it('creator CAN read their project even when not in members[]', async () => {
    await assertSucceeds(getDoc(doc(db(fs(CREATOR)), 'projects', PROJECT_A)));
  });
  it('unverified-email member CANNOT read their project', async () => {
    await assertFails(getDoc(doc(db(fs(UNVERIFIED, 'worker', undefined, false)), 'projects', PROJECT_A)));
  });

  // ── Tenant-scoped supervisor/admin (the M-1 fix) ───────────────────────────
  it('supervisor of tenant t1 CAN read a t1 project', async () => {
    await assertSucceeds(getDoc(doc(db(fs(SUP_T1, 'supervisor', 't1')), 'projects', PROJECT_A)));
  });
  it('M-1 KEY: admin of tenant t1 CANNOT read a t2 project (cross-tenant leak closed)', async () => {
    await assertFails(getDoc(doc(db(fs(ADMIN_T1, 'admin', 't1')), 'projects', PROJECT_B)));
  });
  it('admin with NO tenantId claim CANNOT read a project by role alone', async () => {
    await assertFails(getDoc(doc(db(fs(ADMIN_T1, 'admin')), 'projects', PROJECT_A)));
  });
  it('outsider (non-member, wrong tenant) CANNOT read another tenant project', async () => {
    await assertFails(getDoc(doc(db(fs(OUTSIDER, 'worker', 't2')), 'projects', PROJECT_A)));
  });

  // ── list: tenant-scoped ────────────────────────────────────────────────────
  it('admin CANNOT list ALL projects unfiltered (cross-tenant leak closed)', async () => {
    await assertFails(getDocs(query(collection(db(fs(ADMIN_T1, 'admin', 't1')), 'projects'))));
  });
  it('admin of t1 CAN list with where(tenantId == t1)', async () => {
    await assertSucceeds(
      getDocs(query(collection(db(fs(ADMIN_T1, 'admin', 't1')), 'projects'), where('tenantId', '==', 't1'))),
    );
  });
  it('member CANNOT list ALL projects unfiltered', async () => {
    await assertFails(getDocs(query(collection(db(fs(MEMBER)), 'projects'))));
  });

  // ── create: schema + anti-spoof ────────────────────────────────────────────
  it('create WITHOUT tenantId is denied (schema requires it)', async () => {
    await assertFails(
      setDoc(doc(db(fs(OWNER, 'gerente')), 'projects', 'new-a'), validProject({ members: [OWNER], createdBy: OWNER })),
    );
  });
  it('create with a FOREIGN tenantId is denied (anti-spoof)', async () => {
    await assertFails(
      setDoc(doc(db(fs(OWNER, 'gerente')), 'projects', 'new-b'),
        validProject({ members: [OWNER], createdBy: OWNER, tenantId: 'someone-else' })),
    );
  });
  it('create with tenantId == own uid is allowed', async () => {
    await assertSucceeds(
      setDoc(doc(db(fs(OWNER, 'gerente')), 'projects', 'new-c'),
        validProject({ members: [OWNER], createdBy: OWNER, tenantId: OWNER })),
    );
  });

  // ── update: tenantId immutable ─────────────────────────────────────────────
  it('update changing tenantId is denied (immutable — no re-homing to another tenant)', async () => {
    await assertFails(updateDoc(doc(db(fs(OWNER, 'gerente')), 'projects', PROJECT_OWN), { tenantId: 't2' }));
  });

  // ── master gate: subcollection reads tenant-scoped ─────────────────────────
  it('M-1 KEY: admin of t1 CANNOT read a t2 project subcollection doc (master gate)', async () => {
    await assertFails(getDoc(doc(db(fs(ADMIN_T1, 'admin', 't1')), 'projects', PROJECT_B, 'reports', 'r1')));
  });
});
