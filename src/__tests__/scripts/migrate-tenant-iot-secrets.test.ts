import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createFakeFirestore, FieldValue } from '../helpers/fakeFirestore';

const require = createRequire(import.meta.url);
const { migrateTenantIotSecrets, parseArgs } = require('../../../scripts/migrate-tenant-iot-secrets.cjs') as {
  migrateTenantIotSecrets: (options: {
    db: ReturnType<typeof createFakeFirestore>;
    FieldValue: typeof FieldValue;
    tenantId?: string;
    apply?: boolean;
    log?: (row: Record<string, unknown>) => void;
  }) => Promise<{
    scanned: number;
    skipped: number;
    wouldMigrate: number;
    wouldClearLegacy: number;
    migrated: number;
    clearedLegacy: number;
    conflicts: number;
    missing: number;
  }>;
  parseArgs: (argv: string[], env?: Record<string, string | undefined>) => {
    help?: boolean;
    projectId?: string;
    tenantId?: string;
    all?: boolean;
    apply?: boolean;
    dryRun?: boolean;
  };
};

const TENANT = 'tenant-iot-migration-fixture';
const DUMMY_SECRET = 'fixture-only-not-a-production-secret';
const DIFFERENT_SECRET = 'another-fixture-only-secret';

function seedLegacy(db: ReturnType<typeof createFakeFirestore>, secret = DUMMY_SECRET) {
  db._seed(`tenants/${TENANT}`, {
    displayName: 'Synthetic tenant metadata',
    iotSecret: secret,
    iotSecretRotatedAt: 'synthetic-rotation-time',
  });
}

describe('migrate-tenant-iot-secrets', () => {
  it('dry-run reports work without writing and never logs key values', async () => {
    const db = createFakeFirestore();
    seedLegacy(db);
    const logs: Record<string, unknown>[] = [];

    const result = await migrateTenantIotSecrets({
      db,
      FieldValue,
      tenantId: TENANT,
      log: (row) => logs.push(row),
    });

    const dump = db._dump();
    expect(result.wouldMigrate).toBe(1);
    expect(result.migrated).toBe(0);
    expect(dump[`tenants/${TENANT}`].iotSecret === DUMMY_SECRET).toBe(true);
    expect(dump[`tenant_iot_secrets/${TENANT}`]).toBeUndefined();
    expect(JSON.stringify({ result, logs }).includes(DUMMY_SECRET)).toBe(false);
  });

  it('copies the legacy key and deletes its readable-root copy in one transaction', async () => {
    const db = createFakeFirestore();
    seedLegacy(db);
    const logs: Record<string, unknown>[] = [];

    const result = await migrateTenantIotSecrets({
      db,
      FieldValue,
      tenantId: TENANT,
      apply: true,
      log: (row) => logs.push(row),
    });

    const dump = db._dump();
    expect(result.migrated).toBe(1);
    expect(dump[`tenants/${TENANT}`].displayName).toBe('Synthetic tenant metadata');
    expect('iotSecret' in dump[`tenants/${TENANT}`]).toBe(false);
    expect(dump[`tenant_iot_secrets/${TENANT}`].iotSecret === DUMMY_SECRET).toBe(true);
    expect(dump[`tenant_iot_secrets/${TENANT}`].iotSecretRotatedAt).toBe('synthetic-rotation-time');
    expect(JSON.stringify({ result, logs }).includes(DUMMY_SECRET)).toBe(false);
  });

  it('clears a matching legacy duplicate and is idempotent on a second pass', async () => {
    const db = createFakeFirestore();
    seedLegacy(db);
    db._seed(`tenant_iot_secrets/${TENANT}`, {
      iotSecret: DUMMY_SECRET,
      iotSecretRotatedAt: 'synthetic-rotation-time',
    });

    const first = await migrateTenantIotSecrets({ db, FieldValue, tenantId: TENANT, apply: true });
    const second = await migrateTenantIotSecrets({ db, FieldValue, tenantId: TENANT, apply: true });

    expect(first.clearedLegacy).toBe(1);
    expect(second.skipped).toBe(1);
    expect('iotSecret' in db._dump()[`tenants/${TENANT}`]).toBe(false);
  });

  it('leaves conflicting keys untouched and reports the tenant without either key', async () => {
    const db = createFakeFirestore();
    seedLegacy(db);
    db._seed(`tenant_iot_secrets/${TENANT}`, { iotSecret: DIFFERENT_SECRET });
    const logs: Record<string, unknown>[] = [];

    const result = await migrateTenantIotSecrets({
      db,
      FieldValue,
      tenantId: TENANT,
      apply: true,
      log: (row) => logs.push(row),
    });

    const dump = db._dump();
    expect(result.conflicts).toBe(1);
    expect(dump[`tenants/${TENANT}`].iotSecret === DUMMY_SECRET).toBe(true);
    expect(dump[`tenant_iot_secrets/${TENANT}`].iotSecret === DIFFERENT_SECRET).toBe(true);
    expect(JSON.stringify({ result, logs }).includes(DUMMY_SECRET)).toBe(false);
    expect(JSON.stringify({ result, logs }).includes(DIFFERENT_SECRET)).toBe(false);
  });

  it('requires an explicit project and exactly one tenant scope', () => {
    expect(() => parseArgs(['--all'], {})).toThrow('--project is required');
    expect(() => parseArgs(['--project', 'test-project'], {})).toThrow('Choose exactly one');
    expect(() => parseArgs(['--project', 'test-project', '--all', '--tenant', TENANT], {})).toThrow('Choose exactly one');
  });

  it('requires project-bound confirmation before apply', () => {
    expect(() => parseArgs(['--project', 'prod-project', '--all', '--apply'], {})).toThrow('IOT_SECRET_MIGRATION_CONFIRM');
    expect(
      parseArgs(['--project', 'test-project', '--all', '--apply'], {
        IOT_SECRET_MIGRATION_CONFIRM: 'migrate-tenant-iot-secrets:test-project',
      }).apply,
    ).toBe(true);
  });
});
