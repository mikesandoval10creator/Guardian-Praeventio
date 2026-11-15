import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { createRulesTestEnv } from './_harness';

const TENANT = 'tenant-onboarding-import-a';
const OTHER_TENANT = 'tenant-onboarding-import-b';
const PROJECT_A = 'project-onboarding-a';
const PROJECT_B = 'project-onboarding-b';
const IMPORT_A = 'onboarding-project-a-fixture';
const IMPORT_B = 'onboarding-project-b-fixture';
const FIXTURE_CSV = 'name,email\nFixture Worker,fixture@example.test\n';

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

function memberDb(tenantId: string, projectId: string, role: 'worker' | 'admin' = 'worker') {
  return requireEnv()
    .authenticatedContext(`${tenantId}-${projectId}-${role}`, {
      email: `${role}@example.test`,
      email_verified: true,
      role,
      tenantId,
      projectId,
    })
    .firestore();
}

async function seedSyntheticImports() {
  await requireEnv().withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'tenants', TENANT), { name: 'Synthetic tenant' });
    await setDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_A), {
      projectId: PROJECT_A,
      uploadedBy: 'synthetic-owner',
      status: 'pending',
      workersCsv: FIXTURE_CSV,
    });
    await setDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_B), {
      projectId: PROJECT_B,
      uploadedBy: 'synthetic-owner',
      status: 'pending',
      workersCsv: FIXTURE_CSV,
    });
  });
}

describe('server-only onboarding CSV staging — Firestore rules', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedSyntheticImports();
  });

  it('denies a same-tenant member reading raw CSV staging documents', async () => {
    const db = memberDb(TENANT, PROJECT_A);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_A)));
  });

  it('denies a same-tenant member listing import staging documents', async () => {
    const db = memberDb(TENANT, PROJECT_A);
    await assertFails(getDocs(collection(db, 'tenants', TENANT, 'imports')));
  });

  it('denies project-A members reading project-B raw CSV documents', async () => {
    const db = memberDb(TENANT, PROJECT_A);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_B)));
  });

  it('denies tenant admins reading raw CSV staging documents', async () => {
    const db = memberDb(TENANT, PROJECT_A, 'admin');
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_A)));
  });

  it('denies unauthenticated reads of raw CSV staging documents', async () => {
    const db = requireEnv().unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_A)));
  });

  it('denies cross-tenant members reading raw CSV staging documents', async () => {
    const db = memberDb(OTHER_TENANT, PROJECT_A);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'imports', IMPORT_A)));
  });

  it('denies collection-group queries over imports', async () => {
    const db = memberDb(TENANT, PROJECT_A);
    const importQuery = query(collectionGroup(db, 'imports'), where('status', '==', 'pending'));
    await assertFails(getDocs(importQuery));
  });

  it('denies client writes to imports; server provisioning uses Admin SDK', async () => {
    const db = memberDb(TENANT, PROJECT_A);
    const ref = doc(db, 'tenants', TENANT, 'imports', IMPORT_A);
    await assertFails(setDoc(ref, { workersCsv: FIXTURE_CSV }));
    await assertFails(updateDoc(ref, { workersCsv: FIXTURE_CSV }));
    await assertFails(deleteDoc(ref));
  });

  it('keeps tenant metadata readable without exposing CSV in the root', async () => {
    const snapshot = await getDoc(doc(memberDb(TENANT, PROJECT_A), 'tenants', TENANT));
    expect(snapshot.exists()).toBe(true);
    expect('workersCsv' in (snapshot.data() ?? {})).toBe(false);
  });
});
