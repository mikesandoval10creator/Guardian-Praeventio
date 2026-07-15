#!/usr/bin/env node
'use strict';

const {
  canonicalNamespace,
  parseExportFolder,
  parseGsUri,
} = require('./firestore-backup-layout.cjs');

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function backupUriFor(bucketName, fullPrefix) {
  return `gs://${bucketName}/${trimSlashes(fullPrefix)}`;
}

async function listImmediatePrefixes(bucket, prefix) {
  const normalized = trimSlashes(prefix);
  const queryPrefix = normalized ? `${normalized}/` : '';
  const [, , response] = await bucket.getFiles({
    prefix: queryPrefix,
    delimiter: '/',
    autoPaginate: false,
  });
  return (response && response.prefixes) || [];
}

async function discoverBackups(storage, bucketName, discoveryPrefix) {
  const bucket = storage.bucket(bucketName);
  const canonicalBase = canonicalNamespace(discoveryPrefix);
  const [canonicalPrefixes, legacyPrefixes] = await Promise.all([
    listImmediatePrefixes(bucket, canonicalBase),
    listImmediatePrefixes(bucket, discoveryPrefix),
  ]);
  const unique = new Map();
  for (const prefix of [...canonicalPrefixes, ...legacyPrefixes]) {
    const parsed = parseExportFolder(prefix, discoveryPrefix);
    if (parsed) unique.set(parsed.fullPrefix, parsed);
  }
  return [...unique.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

function resolveExactBackup(backupUri, bucketName, discoveryPrefix) {
  const exact = parseGsUri(backupUri);
  if (exact.bucket !== bucketName) {
    throw new Error(
      `backup URI bucket ${exact.bucket} does not match configured bucket ${bucketName}`,
    );
  }
  const parsed = parseExportFolder(exact.prefix, discoveryPrefix);
  if (!parsed) {
    throw new Error(`backup URI does not match a recognized Firestore export layout: ${backupUri}`);
  }
  return parsed;
}

function baseReport() {
  return {
    backupUri: null,
    layout: null,
    discoveredBackups: 0,
    files: 0,
    ageHours: null,
    manifest: null,
    errors: [],
    warnings: [],
  };
}

function normalizeUri(uri) {
  return String(uri || '').replace(/\/+$/, '');
}

function parseCliArgs(args, env) {
  const backupUriArg = args.find((arg) => arg.startsWith('--backup-uri='));
  const maxAgeArg = args.find((arg) => arg.startsWith('--max-age-hours='));
  const maxAgeHours = maxAgeArg
    ? Number.parseFloat(maxAgeArg.slice('--max-age-hours='.length))
    : Number.parseFloat(env.BACKUP_MAX_AGE_HOURS || '30');
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error('max age hours must be a positive number.');
  }
  const backupUri = backupUriArg
    ? backupUriArg.slice('--backup-uri='.length).trim()
    : null;
  if (backupUriArg && !backupUri) {
    throw new Error('--backup-uri must be a non-empty GCS URI.');
  }
  return {
    backupUri,
    maxAgeHours,
    withDryRunImport: args.includes('--with-dry-run-import'),
  };
}

async function runIntegrityCheck(options) {
  const {
    storage,
    projectId,
    bucketUri,
    backupUri = null,
    maxAgeHours,
    nowMs = Date.now(),
    dryRunImport = null,
  } = options;
  const report = baseReport();

  if (!storage || typeof storage.bucket !== 'function') {
    report.errors.push('storage dependency is required.');
    return { healthy: false, report };
  }
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    report.errors.push('projectId is required.');
    return { healthy: false, report };
  }
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    report.errors.push('maxAgeHours must be a positive number.');
    return { healthy: false, report };
  }

  let bucketName;
  let discoveryPrefix;
  let selected;
  try {
    ({ bucket: bucketName, prefix: discoveryPrefix } = parseGsUri(bucketUri));
    if (backupUri) {
      selected = resolveExactBackup(backupUri, bucketName, discoveryPrefix);
      report.discoveredBackups = 1;
    } else {
      const backups = await discoverBackups(storage, bucketName, discoveryPrefix);
      report.discoveredBackups = backups.length;
      selected = backups[0];
      if (!selected) {
        report.errors.push('no recognized Firestore backups found in the configured bucket.');
        return { healthy: false, report };
      }
    }
  } catch (error) {
    report.errors.push(`failed to select backup: ${error.message || error}`);
    return { healthy: false, report };
  }

  report.layout = selected.layout;
  report.backupUri = backupUriFor(bucketName, selected.fullPrefix);
  if (selected.layout === 'legacy') {
    report.warnings.push('latest backup uses the legacy firestore-export-* layout.');
  }

  let files;
  try {
    [files] = await storage
      .bucket(bucketName)
      .getFiles({ prefix: `${selected.fullPrefix}/` });
  } catch (error) {
    report.errors.push(`failed to list selected backup: ${error.message || error}`);
    return { healthy: false, report };
  }
  report.files = files.length;
  if (files.length === 0) {
    report.errors.push('selected backup folder is empty.');
    return { healthy: false, report };
  }

  const metadataFile = files.find((file) => file.name.endsWith('.overall_export_metadata'));
  if (!metadataFile) {
    report.errors.push('missing Firestore .overall_export_metadata file.');
  }

  const manifestFile = files.find((file) => file.name === `${selected.fullPrefix}/manifest.json`);
  if (!manifestFile) {
    report.errors.push('missing mandatory manifest.json.');
  } else {
    try {
      const [buffer] = await manifestFile.download();
      const manifest = JSON.parse(buffer.toString('utf8'));
      report.manifest = manifest;
      if (manifest.schemaVersion !== 1) {
        report.errors.push(`unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
      }
      if (manifest.project !== projectId) {
        report.errors.push(
          `manifest project mismatch: expected ${projectId}, got ${manifest.project || '(missing)'}`,
        );
      }
      if (normalizeUri(manifest.outputUriPrefix) !== normalizeUri(report.backupUri)) {
        report.errors.push('manifest outputUriPrefix does not match the selected backup URI.');
      }
      const timestampMs = Date.parse(manifest.timestamp);
      if (!Number.isFinite(timestampMs)) {
        report.errors.push('manifest timestamp is missing or invalid.');
      } else {
        const ageHours = (nowMs - timestampMs) / (60 * 60 * 1000);
        report.ageHours = ageHours;
        if (ageHours < -5 / 60) {
          report.errors.push('manifest timestamp is unexpectedly in the future.');
        } else if (ageHours > maxAgeHours) {
          report.errors.push(
            `STALE: latest backup is ${ageHours.toFixed(2)}h old, threshold=${maxAgeHours}h.`,
          );
        }
      }
    } catch (error) {
      report.errors.push(`invalid manifest.json: ${error.message || error}`);
    }
  }

  if (report.errors.length === 0 && typeof dryRunImport === 'function') {
    try {
      const exitCode = await dryRunImport(report.backupUri);
      if (exitCode !== 0) report.errors.push(`dry-run import exited ${exitCode}.`);
    } catch (error) {
      report.errors.push(`dry-run import failed: ${error.message || error}`);
    }
  }

  return { healthy: report.errors.length === 0, report };
}

module.exports = {
  discoverBackups,
  parseCliArgs,
  resolveExactBackup,
  runIntegrityCheck,
};
