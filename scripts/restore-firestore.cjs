#!/usr/bin/env node
/**
 * Restore Firestore from a GCS export. DANGEROUS — read DR_RUNBOOK.md first.
 *
 * Usage (PRODUCTION — requires --confirm-i-know-what-im-doing):
 *   GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
 *   GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-28-0300/ \
 *   GCP_PROJECT_ID=praeventio-prod \
 *   node scripts/restore-firestore.cjs --confirm-i-know-what-im-doing
 *
 * Staging (no confirm flag needed; project name does NOT match praeventio-prod):
 *   GCP_PROJECT_ID=praeventio-staging \
 *   GCS_RESTORE_PATH=gs://praeventio-backups/firestore-export-2026-04-28-0300/ \
 *   node scripts/restore-firestore.cjs
 *
 * Flags:
 *   --collections=a,b,c                  Restore only these collections.
 *   --dry-run                            Validate the export exists, log
 *                                        what would be restored, then exit.
 *   --confirm-i-know-what-im-doing       Required against praeventio-prod.
 *
 * Note: Firestore importDocuments OVERWRITES documents with matching IDs.
 *       Documents not in the export are NOT touched. There is no atomic
 *       rollback — if the import fails midway, partial data may have been
 *       written. Always restore to a fresh / staging project first.
 */

'use strict';

const { v1 } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

const PROD_PROJECT_ID = 'praeventio-prod';
const CONFIRM_FLAG = '--confirm-i-know-what-im-doing';
const IMPORT_TIMEOUT_MS = 50 * 60 * 1000;

// ---- arg parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirmed = args.includes(CONFIRM_FLAG);
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const collections = collectionsArg
  ? collectionsArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

// ---- logging helpers -------------------------------------------------------

function log(...m) {
  // eslint-disable-next-line no-console
  console.log('[restore-firestore]', ...m);
}
function warn(...m) {
  // eslint-disable-next-line no-console
  console.warn('[restore-firestore][WARN]', ...m);
}
function err(...m) {
  // eslint-disable-next-line no-console
  console.error('[restore-firestore][ERROR]', ...m);
}
function fail(msg, code = 1) {
  err(msg);
  process.exit(code);
}

// ---- helpers ---------------------------------------------------------------

function parseGsUri(uri) {
  if (!uri || !uri.startsWith('gs://')) {
    throw new Error(`Invalid GCS URI: ${uri || '(empty)'} (must start with gs://)`);
  }
  const without = uri.slice('gs://'.length);
  const slash = without.indexOf('/');
  if (slash === -1) return { bucket: without, prefix: '' };
  return { bucket: without.slice(0, slash), prefix: without.slice(slash + 1).replace(/\/$/, '') };
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function validateExport(storage, gsPath) {
  // An exportDocuments output folder always contains a top-level
  // <slug>.overall_export_metadata file. We check for either it OR a
  // manifest.json (written by our backup script).
  const { bucket, prefix } = parseGsUri(gsPath);
  const [files] = await storage.bucket(bucket).getFiles({ prefix: prefix ? `${prefix}/` : '' });
  if (files.length === 0) {
    throw new Error(`no files found at ${gsPath}`);
  }
  const hasManifest = files.some((f) => f.name.endsWith('/manifest.json') || f.name === 'manifest.json');
  const hasMetadata = files.some((f) => f.name.endsWith('.overall_export_metadata'));
  return {
    fileCount: files.length,
    hasManifest,
    hasMetadata,
    sample: files.slice(0, 5).map((f) => f.name),
  };
}

// ---- main ------------------------------------------------------------------

(async () => {
  const projectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    fail('GCP_PROJECT_ID is not set. Export GCP_PROJECT_ID=praeventio-staging (or prod, with confirm).');
  }

  const restorePath = process.env.GCS_RESTORE_PATH;
  if (!restorePath) {
    fail('GCS_RESTORE_PATH is not set. Example: gs://praeventio-backups/firestore-export-2026-04-28-0300/');
  }

  // 1. Production safeguard.
  const isProd = projectId === PROD_PROJECT_ID;
  if (isProd && !confirmed && !dryRun) {
    fail(
      `Refusing to restore to ${PROD_PROJECT_ID} without ${CONFIRM_FLAG}. ` +
        `Re-read DR_RUNBOOK.md, then re-run with the flag.`,
    );
  }

  log(`project=${projectId}${isProd ? ' (PRODUCTION)' : ''}`);
  log(`restorePath=${restorePath}`);
  log(`collections=${collections.length === 0 ? '(all in export)' : collections.join(',')}`);
  log(`dryRun=${dryRun}`);

  // 2. Validate export exists and looks like a managed export.
  const storage = new Storage({ projectId });
  let validation;
  try {
    validation = await validateExport(storage, restorePath);
  } catch (e) {
    fail(`validation failed: ${e && e.message ? e.message : e}`);
  }
  log(
    `validation: ${validation.fileCount} files, ` +
      `manifest.json=${validation.hasManifest}, overall_export_metadata=${validation.hasMetadata}`,
  );
  if (!validation.hasMetadata) {
    warn(
      'no .overall_export_metadata file found at this prefix — this may not be a Firestore managed export. ' +
        'importDocuments will likely fail. Continuing anyway so the failure is visible.',
    );
  }

  if (dryRun) {
    log('--- dry-run summary ---');
    log(`would call importDocuments on database projects/${projectId}/databases/(default)`);
    log(`would import collections: ${collections.length === 0 ? '(all)' : collections.join(', ')}`);
    log(`from inputUriPrefix: ${restorePath}`);
    log('sample files:');
    for (const s of validation.sample) log(`  ${s}`);
    log('exit (dry-run, no changes made)');
    process.exit(0);
  }

  // 3. Last-chance prompt with 5s sleep when running against prod.
  if (isProd) {
    err(`*** ABOUT TO IMPORT INTO ${PROD_PROJECT_ID} IN 5 SECONDS — Ctrl+C TO CANCEL ***`);
    await sleep(5000);
  }

  // 4. Trigger import.
  const client = new v1.FirestoreAdminClient();
  const databaseName = client.databasePath(projectId, '(default)');

  log('starting importDocuments()…');
  let operationResult;
  try {
    const [operation] = await client.importDocuments({
      name: databaseName,
      inputUriPrefix: restorePath.replace(/\/$/, ''),
      collectionIds: collections,
    });
    log(`operation started: ${operation.name}`);

    operationResult = await Promise.race([
      operation.promise(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `import operation did not complete within ${IMPORT_TIMEOUT_MS / 60000} minutes`,
              ),
            ),
          IMPORT_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    fail(`importDocuments failed: ${e && e.stack ? e.stack : e}`, 2);
  }

  const [, metadata] = operationResult || [];
  log('--- import summary ---');
  log(`project    : ${projectId}`);
  log(`source     : ${restorePath}`);
  log(`collections: ${collections.length === 0 ? '(all)' : collections.join(', ')}`);
  if (metadata && metadata.progressDocuments) {
    log(`documents  : ${JSON.stringify(metadata.progressDocuments)}`);
  }
  if (metadata && metadata.progressBytes) {
    log(`bytes      : ${JSON.stringify(metadata.progressBytes)}`);
  }
  log('SUCCESS');
  process.exit(0);
})().catch((e) => {
  fail(`unhandled error: ${e && e.stack ? e.stack : e}`, 2);
});
