#!/usr/bin/env node
/**
 * Verify the latest recognized Firestore export, or one exact export URI.
 *
 * Canonical layout:
 *   gs://<bucket>/<optional-prefix>/firestore/YYYY-MM-DD[-HHMM][-label]/
 *
 * Legacy `firestore-export-*` folders remain readable during migration but
 * are never produced by current tooling.
 *
 * Usage:
 *   GCS_BACKUP_BUCKET=gs://praeventio-backups \
 *   GCP_PROJECT_ID=praeventio-prod \
 *   node scripts/test-backup-integrity.cjs
 *
 *   node scripts/test-backup-integrity.cjs \
 *     --backup-uri=gs://praeventio-backups/firestore/2026-07-15 \
 *     --max-age-hours=2
 *
 * Exit codes: 0 healthy, 1 invalid invocation, 2 unhealthy backup.
 */

'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { Storage } = require('@google-cloud/storage');
const {
  parseCliArgs,
  runIntegrityCheck,
} = require('./firestore-backup-integrity-lib.cjs');

const DEFAULT_BUCKET = 'gs://praeventio-backups';

function log(...messages) {
  console.log('[test-backup-integrity]', ...messages);
}

function warn(...messages) {
  console.warn('[test-backup-integrity][WARN]', ...messages);
}

function error(...messages) {
  console.error('[test-backup-integrity][ERROR]', ...messages);
}

function spawnNode(scriptPath, env, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code == null ? 1 : code));
  });
}

async function main(args = process.argv.slice(2), env = process.env) {
  let cli;
  try {
    cli = parseCliArgs(args, env);
  } catch (err) {
    error(err.message || err);
    return 1;
  }

  const projectId = env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    error('GCP_PROJECT_ID is not set.');
    return 1;
  }

  const bucketUri = env.GCS_BACKUP_BUCKET || DEFAULT_BUCKET;
  let dryRunImport = null;
  if (cli.withDryRunImport) {
    if (!env.DR_TEST_PROJECT_ID) {
      error('--with-dry-run-import requires DR_TEST_PROJECT_ID.');
      return 1;
    }
    dryRunImport = (backupUri) =>
      spawnNode(
        path.join(__dirname, 'restore-firestore.cjs'),
        {
          GCP_PROJECT_ID: env.DR_TEST_PROJECT_ID,
          GCS_RESTORE_PATH: `${backupUri}/`,
        },
        ['--dry-run'],
      );
  }

  log(`project=${projectId}`);
  log(`bucket=${bucketUri}`);
  log(`maxAgeHours=${cli.maxAgeHours}`);
  if (cli.backupUri) log(`exactBackup=${cli.backupUri}`);

  const result = await runIntegrityCheck({
    storage: new Storage({ projectId }),
    projectId,
    bucketUri,
    backupUri: cli.backupUri,
    maxAgeHours: cli.maxAgeHours,
    dryRunImport,
  });

  for (const message of result.report.warnings) warn(message);
  for (const message of result.report.errors) error(message);

  log('--- integrity report ---');
  log(`backup URI      : ${result.report.backupUri || '(none)'}`);
  log(`layout          : ${result.report.layout || '(none)'}`);
  log(`discovered      : ${result.report.discoveredBackups}`);
  log(`files           : ${result.report.files}`);
  log(
    `age             : ${
      result.report.ageHours == null ? '(unknown)' : `${result.report.ageHours.toFixed(2)}h`
    }`,
  );
  log(`manifest.json   : ${result.report.manifest ? 'OK' : 'MISSING/INVALID'}`);
  log(`status          : ${result.healthy ? 'PASS' : 'FAIL'}`);
  return result.healthy ? 0 : 2;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      error(`unhandled error: ${err && err.stack ? err.stack : err}`);
      process.exit(2);
    });
}

module.exports = { main, spawnNode };
