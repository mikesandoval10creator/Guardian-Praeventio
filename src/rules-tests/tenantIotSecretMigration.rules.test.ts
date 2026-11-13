import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import { createRulesTestEnv, RULES_PROJECT_ID } from './_harness';

const require = createRequire(import.meta.url);
const { migrateTenantIotSecrets } = require('../../scripts/migrate-tenant-iot-secrets.cjs') as {
  migrateTenantIotSecrets: (options: {
    db: Firestore;
    FieldValue: typeof FieldValue;
    tenantId: string;
    apply: boolean;
    log: (row: Record<string, unknown>) => void;
  }) => Promise<{
    migrated: number;
    clearedLegacy: number;
    conflicts: number;
    skipped: number;
  }>;
};

const APP_NAME = 'tenant-iot-secret-migration-emulator-test';
const TENANT_ID = 'tenant-iot-migration-emulator-fixture';
const FIXTURE_SECRET = 'emulator-fixture-only-not-a-production-secret';

let rulesEnv: RulesTestEnvironment | null = null;
let adminApp: ReturnType<typeof initializeApp> | null = null;
let adminDb: Firestore | null = null;

beforeAll(async () => {
  rulesEnv = await createRulesTestEnv();
  adminApp = initializeApp({ projectId: RULES_PROJECT_ID }, APP_NAME);
  adminDb = getFirestore(adminApp);
});

afterAll(async () => {
  if (adminApp) await deleteApp(adminApp);
  if (rulesEnv) await rulesEnv.cleanup();
});

function requireRulesEnv(): RulesTestEnvironment {
  if (!rulesEnv) throw new Error('rulesEnv not initialized');
  return rulesEnv;
}

function requireAdminDb(): Firestore {
  if (!adminDb) throw new Error('adminDb not initialized');
  return adminDb;
}

function tenantMemberDb(tenantId: string) {
  return requireRulesEnv()
    .authenticatedContext(`${tenantId}-worker`, {
      email: `${tenantId}-worker@example.com`,
      email_verified: true,
      role: 'worker',
      tenantId,
    })
    .firestore();
}

describe('tenant IoT secret migration — real Firestore emulator transaction', () => {
  beforeEach(async () => {
    await requireRulesEnv().clearFirestore();
    await requireRulesEnv().withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tenants', TENANT_ID), {
        displayName: 'Emulator fixture only',
        iotSecret: FIXTURE_SECRET,
        iotSecretRotatedAt: 'synthetic-rotation-time',
      });
    });
  });

  it('survives eight simultaneous migration attempts with a client-safe read-back', async () => {
    const db = requireAdminDb();
    const logs: Record<string, unknown>[] = [];
    const migrate = () =>
      migrateTenantIotSecrets({
        db,
        FieldValue,
        tenantId: TENANT_ID,
        apply: true,
        log: (row) => logs.push(row),
      });
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => migrate()));
    expect(outcomes.reduce((sum, result) => sum + result.migrated, 0)).toBe(1);
    expect(outcomes.reduce((sum, result) => sum + result.conflicts, 0)).toBe(0);

    const memberDb = tenantMemberDb(TENANT_ID);
    const rootReadback = await getDoc(doc(memberDb, 'tenants', TENANT_ID));
    expect(rootReadback.data()?.iotSecret).toBeUndefined();
    expect(rootReadback.data()?.displayName).toBe('Emulator fixture only');
    await assertFails(getDoc(doc(memberDb, 'tenant_iot_secrets', TENANT_ID)));

    const protectedReadback = await db.collection('tenant_iot_secrets').doc(TENANT_ID).get();
    expect(protectedReadback.data()?.iotSecret === FIXTURE_SECRET).toBe(true);
    expect(JSON.stringify({ outcomes, logs }).includes(FIXTURE_SECRET)).toBe(false);
  }, 60_000);
});
