// SPDX-License-Identifier: MIT
// Server-only storage for tenant-level and per-device IoT credentials.
// All values below are synthetic fixtures; no production secret is read.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
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

const TENANT = 'tenant-iot-secrets-a';
const OTHER_TENANT = 'tenant-iot-secrets-b';
const DEVICE_ID = 'sensor-fixture-1';
const FIXTURE_SECRET = 'not-a-real-secret-fixture-only';

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

function memberDb(tenantId: string, role: 'worker' | 'admin' = 'worker') {
  return requireEnv()
    .authenticatedContext(`${tenantId}-${role}`, {
      email: `${tenantId}-${role}@example.com`,
      email_verified: true,
      role,
      tenantId,
    })
    .firestore();
}

async function seedServerOwnedSecrets() {
  await requireEnv().withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'tenants', TENANT), {
      name: 'Synthetic tenant',
    });
    await setDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID), {
      projectId: 'synthetic-project',
      status: 'active',
      secret: FIXTURE_SECRET,
    });
    await setDoc(doc(db, 'tenant_iot_secrets', TENANT), {
      iotSecret: FIXTURE_SECRET,
      rotatedAt: 'synthetic-only',
    });
  });
}

describe('server-only IoT credentials — Firestore rules', () => {
  beforeEach(async () => {
    await requireEnv().clearFirestore();
    await seedServerOwnedSecrets();
  });

  it('denies a tenant member direct read of tenant_iot_secrets', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDoc(doc(db, 'tenant_iot_secrets', TENANT)));
  });

  it('denies a tenant member listing tenant_iot_secrets', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDocs(collection(db, 'tenant_iot_secrets')));
  });

  it('denies a tenant admin read of both protected secret paths', async () => {
    const db = memberDb(TENANT, 'admin');
    await assertFails(getDoc(doc(db, 'tenant_iot_secrets', TENANT)));
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID)));
  });

  it('denies unauthenticated reads of both protected secret paths', async () => {
    const db = requireEnv().unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'tenant_iot_secrets', TENANT)));
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID)));
  });

  it('denies a member of another tenant reading tenant_iot_secrets', async () => {
    const db = memberDb(OTHER_TENANT);
    await assertFails(getDoc(doc(db, 'tenant_iot_secrets', TENANT)));
  });

  it('denies a member of another tenant reading iot_devices', async () => {
    const db = memberDb(OTHER_TENANT);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID)));
  });

  it('denies tenant-member reads of per-device secrets under iot_devices', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID)));
  });

  it('denies tenant-member listing of iot_devices', async () => {
    const db = memberDb(TENANT);
    await assertFails(getDocs(collection(db, 'tenants', TENANT, 'iot_devices')));
  });

  it('denies tenant-member collection-group queries over iot_devices', async () => {
    const db = memberDb(TENANT);
    const deviceQuery = query(
      collectionGroup(db, 'iot_devices'),
      where('projectId', '==', 'synthetic-project'),
    );
    await assertFails(getDocs(deviceQuery));
  });

  it('denies client writes to tenant_iot_secrets', async () => {
    const db = memberDb(TENANT);
    const ref = doc(db, 'tenant_iot_secrets', TENANT);
    await assertFails(setDoc(ref, { iotSecret: FIXTURE_SECRET }));
    await assertFails(updateDoc(ref, { iotSecret: 'another-fixture' }));
    await assertFails(deleteDoc(ref));
  });

  it('denies client writes to iot_devices', async () => {
    const db = memberDb(TENANT);
    const ref = doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID);
    await assertFails(setDoc(ref, { secret: FIXTURE_SECRET }));
    await assertFails(updateDoc(ref, { secret: 'another-fixture' }));
    await assertFails(deleteDoc(ref));
  });

  it('denies unauthenticated writes to both protected secret paths', async () => {
    const db = requireEnv().unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'tenant_iot_secrets', TENANT), { iotSecret: FIXTURE_SECRET }));
    await assertFails(
      setDoc(doc(db, 'tenants', TENANT, 'iot_devices', DEVICE_ID), { secret: FIXTURE_SECRET }),
    );
  });

  it('documents the legacy-read residual: a root field remains readable until backfill', async () => {
    await requireEnv().withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tenants', TENANT), {
        name: 'Synthetic tenant',
        iotSecret: FIXTURE_SECRET,
      });
    });

    const snapshot = await getDoc(doc(memberDb(TENANT), 'tenants', TENANT));
    expect(snapshot.data()?.iotSecret === FIXTURE_SECRET).toBe(true);
  });
});
