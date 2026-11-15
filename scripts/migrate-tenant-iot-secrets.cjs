#!/usr/bin/env node
/* global process, console, require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Move legacy plaintext tenant IoT HMAC keys out of readable tenants/{id} docs.
 * Dry-run is the default. Apply is explicit, project-bound, and transactional
 * per tenant. Key values are never printed.
 *
 * Examples:
 *   node scripts/migrate-tenant-iot-secrets.cjs --project praeventio-prod --all
 *   node scripts/migrate-tenant-iot-secrets.cjs --project praeventio-prod --tenant TENANT_ID
 *   IOT_SECRET_MIGRATION_CONFIRM=migrate-tenant-iot-secrets:praeventio-prod \
 *     node scripts/migrate-tenant-iot-secrets.cjs --project praeventio-prod --all --apply
 */

function parseArgs(argv, env = process.env) {
  const args = [...argv];
  const takeValue = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    args.splice(index, 2);
    return value;
  };

  const projectId = takeValue('--project');
  const tenantId = takeValue('--tenant');
  const apply = args.includes('--apply');
  const dryRunFlag = args.includes('--dry-run');
  const all = args.includes('--all');
  const help = args.includes('--help');
  for (const flag of ['--apply', '--dry-run', '--all', '--help']) {
    const index = args.indexOf(flag);
    if (index >= 0) args.splice(index, 1);
  }
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(' ')}`);
  if (help) return { help: true };
  if (!projectId) throw new Error('--project is required; no ambient/default project is used');
  if (Boolean(tenantId) === all) throw new Error('Choose exactly one of --tenant <id> or --all');
  if (apply && dryRunFlag) throw new Error('--apply and --dry-run cannot be combined');
  if (apply && env.IOT_SECRET_MIGRATION_CONFIRM !== `migrate-tenant-iot-secrets:${projectId}`) {
    throw new Error('Apply requires IOT_SECRET_MIGRATION_CONFIRM=migrate-tenant-iot-secrets:<project-id>');
  }
  return { projectId, tenantId, all, apply, dryRun: !apply };
}

/**
 * Migrate legacy keys without exposing their values. `db` and `FieldValue` are
 * injected so this logic can be exercised against a deterministic test store.
 */
async function migrateTenantIotSecrets({ db, FieldValue, tenantId, apply = false, log = () => {} }) {
  if (!db || !FieldValue) throw new Error('db and FieldValue are required');
  const tenantDocs = tenantId
    ? [await db.collection('tenants').doc(tenantId).get()]
    : (await db.collection('tenants').get()).docs;
  const summary = {
    scanned: tenantDocs.length,
    skipped: 0,
    wouldMigrate: 0,
    wouldClearLegacy: 0,
    migrated: 0,
    clearedLegacy: 0,
    conflicts: 0,
    missing: 0,
  };

  for (const tenantSnap of tenantDocs) {
    if (!tenantSnap.exists) {
      summary.missing++;
      continue;
    }
    const tenantRef = tenantSnap.ref;
    const legacySecret = (tenantSnap.data() || {}).iotSecret;
    if (typeof legacySecret !== 'string' || legacySecret.length === 0) {
      summary.skipped++;
      continue;
    }

    const secretRef = db.collection('tenant_iot_secrets').doc(tenantSnap.id);
    const protectedSnap = await secretRef.get();
    if (protectedSnap.exists) {
      const protectedSecret = (protectedSnap.data() || {}).iotSecret;
      if (typeof protectedSecret !== 'string' || protectedSecret !== legacySecret) {
        summary.conflicts++;
        log({ tenantId: tenantSnap.id, status: 'conflict' });
        continue;
      }
      if (!apply) {
        summary.wouldClearLegacy++;
        log({ tenantId: tenantSnap.id, status: 'would-clear-legacy-copy' });
        continue;
      }
    } else if (!apply) {
      summary.wouldMigrate++;
      log({ tenantId: tenantSnap.id, status: 'would-migrate' });
      continue;
    }

    const outcome = await db.runTransaction(async (transaction) => {
      const latestTenant = await transaction.get(tenantRef);
      if (!latestTenant.exists) return 'missing-or-already-cleared';
      const latestTenantData = latestTenant.data() || {};
      const latestLegacySecret = latestTenantData.iotSecret;
      if (typeof latestLegacySecret !== 'string' || latestLegacySecret.length === 0) {
        return 'missing-or-already-cleared';
      }

      const latestProtected = await transaction.get(secretRef);
      if (latestProtected.exists) {
        const latestProtectedSecret = (latestProtected.data() || {}).iotSecret;
        if (typeof latestProtectedSecret !== 'string' || latestProtectedSecret !== latestLegacySecret) {
          return 'conflict';
        }
        transaction.update(tenantRef, { iotSecret: FieldValue.delete() });
        return 'cleared-legacy';
      }

      transaction.set(
        secretRef,
        {
          iotSecret: latestLegacySecret,
          iotSecretRotatedAt:
            latestTenantData.iotSecretRotatedAt ?? FieldValue.serverTimestamp(),
          migratedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.update(tenantRef, { iotSecret: FieldValue.delete() });
      return 'migrated';
    });

    if (outcome === 'migrated') summary.migrated++;
    else if (outcome === 'cleared-legacy') summary.clearedLegacy++;
    else if (outcome === 'conflict') summary.conflicts++;
    else summary.skipped++;
    log({ tenantId: tenantSnap.id, status: outcome });
  }

  return summary;
}

function printHelp() {
  console.log('Usage: migrate-tenant-iot-secrets.cjs --project <id> (--tenant <id> | --all) [--dry-run|--apply]');
  console.log('Default mode is dry-run. Apply requires IOT_SECRET_MIGRATION_CONFIRM=migrate-tenant-iot-secrets:<project-id>.');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[migrate-tenant-iot-secrets][FATAL] ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: options.projectId });
  const db = admin.firestore();
  const log = (row) => console.log(`[migrate-tenant-iot-secrets] ${JSON.stringify(row)}`);

  console.log(`[migrate-tenant-iot-secrets] project=${options.projectId} mode=${options.apply ? 'APPLY' : 'DRY-RUN'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log('[migrate-tenant-iot-secrets] Firestore emulator detected');
  }
  const summary = await migrateTenantIotSecrets({
    db,
    FieldValue: admin.firestore.FieldValue,
    tenantId: options.tenantId,
    apply: options.apply,
    log,
  });
  console.log(`[migrate-tenant-iot-secrets] summary ${JSON.stringify(summary)}`);
  if (summary.conflicts > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    const kind = error && typeof error.code === 'string' ? error.code : 'migration-failed';
    console.error(`[migrate-tenant-iot-secrets][FATAL] ${kind}; no secret values were logged`);
    process.exitCode = 1;
  });
}

module.exports = { migrateTenantIotSecrets, parseArgs };
