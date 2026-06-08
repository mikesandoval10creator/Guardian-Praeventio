// B16 — conflict_queue rules tests. Real firestore.rules via the F1
// fail-closed harness (createRulesTestEnv THROWS if the emulator is down —
// cannot fake-green). Assertions use authenticatedContext (NEVER the Admin
// SDK; withSecurityRulesDisabled only seeds preconditions).
//
// conflict_queue is server-only WRITE + supervisor-tier READ (§12.2.2). The
// matrix below is the Dirty-Dozen 45-47 coverage proven against real rules.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

let testEnv: RulesTestEnvironment | null = null;
beforeAll(async () => {
  testEnv = await createRulesTestEnv();
});
afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});
beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});
function env(): RulesTestEnvironment {
  if (!testEnv) throw new Error('rules test env not initialised');
  return testEnv;
}

const PATH = ['tenants', 't1', 'conflict_queue', 'q1'] as const;
const entry = {
  queueId: 'q1',
  projectId: 'p1',
  localAuthorUid: 'w1',
  status: 'pending',
  enqueuedAt: '2026-01-01T00:00:00.000Z',
  tenantId: 't1',
  conflict: {
    collection: 'incident_reports',
    docId: 'inc-1',
    docType: 'IncidentReport',
    localUpdatedAt: '2026-01-01T00:00:00Z',
    serverUpdatedAt: '2026-01-01T00:01:00Z',
    isDeletionConflict: false,
    fields: [
      { field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true },
    ],
  },
};

async function seed(): Promise<void> {
  await env().withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('tenants')
      .doc('t1')
      .collection('conflict_queue')
      .doc('q1')
      .set(entry);
  });
}

// Multi-tenant claim shape: token.tenants[tenantId] carries the per-tenant role.
function multiTenant(role: string, tenants: Record<string, string>) {
  return { email: `${role}@example.com`, email_verified: true, role, tenants };
}
// Single-tenant claim shape: token.tenantId + global supervisor-tier role.
function singleTenant(role: string, tenantId: string) {
  return { email: `${role}@example.com`, email_verified: true, role, tenantId };
}

describe('conflict_queue rules (B16)', () => {
  it('supervisor of tenant t1 CAN read (multi-tenant claim)', async () => {
    await seed();
    const sup = env().authenticatedContext('s1', multiTenant('supervisor', { t1: 'supervisor' }));
    await assertSucceeds(getDoc(doc(sup.firestore(), ...PATH)));
  });

  it('admin via single-tenant claim CAN read', async () => {
    await seed();
    const adm = env().authenticatedContext('a1', singleTenant('admin', 't1'));
    await assertSucceeds(getDoc(doc(adm.firestore(), ...PATH)));
  });

  it('worker-tier member CANNOT read (supervisor-only)', async () => {
    await seed();
    const w = env().authenticatedContext('w1', multiTenant('worker', { t1: 'worker' }));
    await assertFails(getDoc(doc(w.firestore(), ...PATH)));
  });

  it('supervisor of another tenant CANNOT read t1 (cross-tenant)', async () => {
    await seed();
    const other = env().authenticatedContext('s2', multiTenant('supervisor', { A: 'supervisor' }));
    await assertFails(getDoc(doc(other.firestore(), ...PATH)));
  });

  it('unauthenticated read denied', async () => {
    await seed();
    await assertFails(getDoc(doc(env().unauthenticatedContext().firestore(), ...PATH)));
  });

  it('client CREATE denied — server-only', async () => {
    const sup = env().authenticatedContext('s1', multiTenant('supervisor', { t1: 'supervisor' }));
    await assertFails(setDoc(doc(sup.firestore(), ...PATH), entry));
  });

  it('client UPDATE denied — resolution only via audited server route', async () => {
    await seed();
    const sup = env().authenticatedContext('s1', multiTenant('supervisor', { t1: 'supervisor' }));
    await assertFails(
      setDoc(doc(sup.firestore(), ...PATH), { status: 'resolved' }, { merge: true }),
    );
  });
});
