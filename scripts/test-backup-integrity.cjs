#!/usr/bin/env node
/**
 * Periodic backup integrity check.
 *
 * Verifies that the most recent Firestore export under GCS_BACKUP_BUCKET:
 *   1. exists and is < BACKUP_MAX_AGE_HOURS old (default 30h, i.e. nightly + slack)
 *   2. contains a `manifest.json` written by backup-firestore.cjs
 *   3. contains a Firestore-managed `<slug>.overall_export_metadata` file
 *   4. (optional) passes a dry-run import against a DR test project
 *
 * Designed to run on a Cloud Scheduler / cron cadence (daily or weekly).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
 *   GCS_BACKUP_BUCKET=gs://praeventio-backups \
 *   GCP_PROJECT_ID=praeventio-prod \
 *   node scripts/test-backup-integrity.cjs
 *
 *   # Optional: also dry-run import into a throwaway project
 *   DR_TEST_PROJECT_ID=praeventio-dr-test \
 *   node scripts/test-backup-integrity.cjs --with-dry-run-import
 *
 * Flags:
 *   --max-age-hours=N         Maximum allowed age for the latest backup
 *                             (default: BACKUP_MAX_AGE_HOURS env or 30).
 *   --with-dry-run-import     Spawn restore-firestore.cjs --dry-run against
 *                             DR_TEST_PROJECT_ID using the latest backup.
 *
 * Exit codes:
 *   0 — backup looks healthy
 *   1 — bad invocation
 *   2 — backup missing, stale, or malformed
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { Storage } = require('@google-cloud/storage');

const DEFAULT_BUCKET = 'gs://praeventio-backups';
const EXPORT_FOLDER_RE = /^firestore-export-(\d{4}-\d{2}-\d{2}-\d{4})(?:-([a-zA-Z0-9_-]+))?\/$/;

// ---- arg parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const withDryRunImport = args.includes('--with-dry-run-import');
const maxAgeArg = args.find((a) => a.startsWith('--max-age-hours='));
const maxAgeHours = maxAgeArg
  ? parseFloat(maxAgeArg.split('=')[1])
  : parseFloat(process.env.BACKUP_MAX_AGE_HOURS || '30');

if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
  console.error(`[test-backup-integrity][FATAL] invalid --max-age-hours: ${maxAgeHours}`);
  process.exit(1);
}

// ---- logging ---------------------------------------------------------------

function log(...m) {
  // eslint-disable-next-line no-console
  console.log('[test-backup-integrity]', ...m);
}
function warn(...m) {
  // eslint-disable-next-line no-console
  console.warn('[test-backup-integrity][WARN]', ...m);
}
function err(...m) {
  // eslint-disable-next-line no-console
  console.error('[test-backup-integrity][ERROR]', ...m);
}
function fail(msg, code = 2) {
  err(msg);
  process.exit(code);
}

// ---- helpers ---------------------------------------------------------------

function parseGsUri(uri) {
  if (!uri.startsWith('gs://')) {
    throw new Error(`Invalid GCS URI: ${uri}`);
  }
  const without = uri.slice('gs://'.length);
  const slash = without.indexOf('/');
  if (slash === -1) return { bucket: without, prefix: '' };
  return { bucket: without.slice(0, slash), prefix: without.slice(slash + 1).replace(/\/$/, '') };
}

function parseSlugToDate(slug) {
  // 2026-04-28-0314 -> Date (UTC)
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(slug);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

async function listBackupFolders(storage, bucketName, bucketPrefix) {
  const prefix = bucketPrefix ? `${bucketPrefix}/` : '';
  // Use delimiter=/ to get only the immediate sub-folders (apiResponse.prefixes).
  const [, , apiResponse] = await storage.bucket(bucketName).getFiles({
    prefix,
    delimiter: '/',
    autoPaginate: false,
  });
  const prefixes = (apiResponse && apiResponse.prefixes) || [];
  return prefixes
    .map((full) => {
      // Strip leading bucketPrefix to get the bare folder name.
      const bare = prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
      const m = EXPORT_FOLDER_RE.exec(bare);
      if (!m) return null;
      const [, slug, label] = m;
      const date = parseSlugToDate(slug);
      if (!date) return null;
      return {
        folder: bare.replace(/\/$/, ''),
        fullPrefix: full.replace(/\/$/, ''),
        slug,
        label: label || null,
        date,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

function spawnNode(scriptPath, env, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code == null ? 1 : code));
  });
}

// ---- main ------------------------------------------------------------------

(async () => {
  const projectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    fail('GCP_PROJECT_ID is not set.', 1);
  }
  const bucketUri = process.env.GCS_BACKUP_BUCKET || DEFAULT_BUCKET;
  const { bucket: bucketName, prefix: bucketPrefix } = parseGsUri(bucketUri);

  log(`project=${projectId}`);
  log(`bucket=gs://${bucketName}${bucketPrefix ? '/' + bucketPrefix : ''}`);
  log(`maxAgeHours=${maxAgeHours}`);

  const storage = new Storage({ projectId });

  // 1. Enumerate firestore-export-* folders.
  let folders;
  try {
    folders = await listBackupFolders(storage, bucketName, bucketPrefix);
  } catch (e) {
    fail(`failed to list bucket: ${e && e.message ? e.message : e}`);
  }

  if (folders.length === 0) {
    fail('no firestore-export-* folders found in the bucket.');
  }
  log(`found ${folders.length} export folder(s); newest=${folders[0].folder}`);

  const latest = folders[0];

  // 2. Age check.
  const ageMs = Date.now() - latest.date.getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  log(`latest backup age: ${ageHours.toFixed(2)}h (slug=${latest.slug})`);
  let healthy = true;
  if (ageHours > maxAgeHours) {
    err(`STALE: latest backup is ${ageHours.toFixed(2)}h old, threshold=${maxAgeHours}h`);
    healthy = false;
  }

  // 3. List files in the latest folder; check for manifest + metadata.
  const [files] = await storage.bucket(bucketName).getFiles({ prefix: `${latest.fullPrefix}/` });
  if (files.length === 0) {
    err(`MALFORMED: latest folder ${latest.folder} is empty.`);
    healthy = false;
  }
  const hasManifest = files.some((f) => f.name.endsWith('/manifest.json'));
  const hasMetadata = files.some((f) => f.name.endsWith('.overall_export_metadata'));
  log(`files=${files.length}, manifest.json=${hasManifest}, overall_export_metadata=${hasMetadata}`);

  if (!hasMetadata) {
    err('MALFORMED: latest export is missing .overall_export_metadata — likely incomplete.');
    healthy = false;
  }
  if (!hasManifest) {
    warn(
      'no manifest.json present — backup is still importable, but our backup script ' +
        'should write one. Investigate why it was skipped.',
    );
  }

  // 4. Optional: dry-run import.
  if (withDryRunImport) {
    const drProject = process.env.DR_TEST_PROJECT_ID;
    if (!drProject) {
      err('--with-dry-run-import requires DR_TEST_PROJECT_ID env.');
      healthy = false;
    } else {
      const restorePath = `gs://${bucketName}/${latest.fullPrefix}/`;
      log(`spawning restore-firestore.cjs --dry-run against ${drProject}…`);
      const restoreScript = path.join(__dirname, 'restore-firestore.cjs');
      const code = await spawnNode(
        restoreScript,
        { GCP_PROJECT_ID: drProject, GCS_RESTORE_PATH: restorePath },
        ['--dry-run'],
      );
      if (code !== 0) {
        err(`dry-run import exited ${code}`);
        healthy = false;
      } else {
        log('dry-run import OK.');
      }
    }
  }

  // 5. Final report.
  log('--- integrity report ---');
  log(`bucket          : gs://${bucketName}${bucketPrefix ? '/' + bucketPrefix : ''}`);
  log(`latest backup   : ${latest.folder}`);
  log(`age             : ${ageHours.toFixed(2)}h (limit ${maxAgeHours}h)`);
  log(`overall_metadata: ${hasMetadata ? 'OK' : 'MISSING'}`);
  log(`manifest.json   : ${hasManifest ? 'OK' : 'MISSING'}`);
  log(`status          : ${healthy ? 'PASS' : 'FAIL'}`);

  process.exit(healthy ? 0 : 2);
})().catch((e) => {
  fail(`unhandled error: ${e && e.stack ? e.stack : e}`);
});
