#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildCanonicalExportUri,
  parseExportFolder,
  parseGsUri,
  sanitizeLabel,
} = require('./firestore-backup-layout.cjs');
const {
  parseCliArgs,
  runIntegrityCheck,
} = require('./firestore-backup-integrity-lib.cjs');

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test('parseGsUri separates bucket and normalized prefix', () => {
  assert.deepEqual(parseGsUri('gs://guardian-backups/nested/firestore/'), {
    bucket: 'guardian-backups',
    prefix: 'nested/firestore',
  });
  assert.throws(() => parseGsUri('https://guardian-backups/firestore'), /Invalid GCS URI/);
});

test('sanitizeLabel produces a bounded path-safe suffix', () => {
  assert.equal(sanitizeLabel(' before migration / prod '), 'before_migration___prod');
  assert.equal(sanitizeLabel(''), '');
  assert.equal(sanitizeLabel('a'.repeat(90)).length, 64);
});

test('buildCanonicalExportUri writes under the firestore namespace', () => {
  assert.equal(
    buildCanonicalExportUri(
      'gs://guardian-backups',
      new Date('2026-07-15T07:12:59.000Z'),
      'before migration',
    ),
    'gs://guardian-backups/firestore/2026-07-15-0712-before_migration',
  );
  assert.equal(
    buildCanonicalExportUri(
      'gs://guardian-backups/team-a',
      new Date('2026-07-15T07:12:59.000Z'),
      '',
    ),
    'gs://guardian-backups/team-a/firestore/2026-07-15-0712',
  );
});

test('parseExportFolder recognizes canonical workflow and script folders', () => {
  assert.deepEqual(
    parseExportFolder('firestore/2026-07-15/', ''),
    {
      folder: '2026-07-15',
      fullPrefix: 'firestore/2026-07-15',
      date: new Date('2026-07-15T00:00:00.000Z'),
      layout: 'canonical',
      label: null,
    },
  );
  assert.deepEqual(
    parseExportFolder('team-a/firestore/2026-07-15-0712-before_migration/', 'team-a'),
    {
      folder: '2026-07-15-0712-before_migration',
      fullPrefix: 'team-a/firestore/2026-07-15-0712-before_migration',
      date: new Date('2026-07-15T07:12:00.000Z'),
      layout: 'canonical',
      label: 'before_migration',
    },
  );
});

test('parseExportFolder retains read compatibility with legacy folders', () => {
  assert.deepEqual(
    parseExportFolder('firestore-export-2026-07-15-0712-before_migration/', ''),
    {
      folder: 'firestore-export-2026-07-15-0712-before_migration',
      fullPrefix: 'firestore-export-2026-07-15-0712-before_migration',
      date: new Date('2026-07-15T07:12:00.000Z'),
      layout: 'legacy',
      label: 'before_migration',
    },
  );
  assert.equal(parseExportFolder('firestore/not-a-date/', ''), null);
  assert.equal(parseExportFolder('firestore/2026-02-30/', ''), null);
});

test('parseCliArgs accepts exact backup verification without losing dry-run support', () => {
  assert.deepEqual(
    parseCliArgs(
      [
        '--backup-uri=gs://guardian-backups/firestore/2026-07-15',
        '--max-age-hours=4',
        '--with-dry-run-import',
      ],
      {},
    ),
    {
      backupUri: 'gs://guardian-backups/firestore/2026-07-15',
      maxAgeHours: 4,
      withDryRunImport: true,
    },
  );
  assert.throws(() => parseCliArgs(['--max-age-hours=0'], {}), /positive number/i);
});

test('fallback producer uses the canonical layout and fails if its manifest is not durable', () => {
  const source = fs.readFileSync(path.join(__dirname, 'backup-firestore.cjs'), 'utf8');
  assert.match(source, /buildCanonicalExportUri/);
  assert.doesNotMatch(source, /firestore-export-/);
  assert.match(source, /fail\(`failed to write manifest\.json:/);
});

test('daily workflow verifies the exact export after writing its manifest', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'firestore-backup.yml'),
    'utf8',
  );
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: '20'/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  const manifestIndex = workflow.indexOf('- name: Write manifest');
  const verifyIndex = workflow.indexOf('- name: Verify export integrity');
  assert.ok(manifestIndex >= 0, 'workflow must write the manifest');
  assert.ok(verifyIndex > manifestIndex, 'exact verification must run after manifest creation');
  assert.match(
    workflow,
    /node scripts\/test-backup-integrity\.cjs[\s\S]*--backup-uri="gs:\/\/\$\{\{ secrets\.BACKUP_BUCKET \}\}\/firestore\/\$\{\{ steps\.folder\.outputs\.folder \}\}"/,
  );

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  );
  assert.equal(
    packageJson.scripts['test:backup-integrity'],
    'node scripts/test-backup-integrity.test.cjs',
  );
});

function makeStorage(objects) {
  const objectMap = new Map(Object.entries(objects));
  const bucket = {
    async getFiles(options = {}) {
      const prefix = options.prefix || '';
      if (options.delimiter === '/') {
        const prefixes = new Set();
        for (const name of objectMap.keys()) {
          if (!name.startsWith(prefix)) continue;
          const remainder = name.slice(prefix.length);
          const slash = remainder.indexOf('/');
          if (slash >= 0) prefixes.add(`${prefix}${remainder.slice(0, slash + 1)}`);
        }
        return [[], null, { prefixes: [...prefixes] }];
      }
      const files = [...objectMap.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, content]) => ({
          name,
          async download() {
            return [Buffer.from(String(content))];
          },
        }));
      return [files];
    },
  };
  return {
    bucket() {
      return bucket;
    },
  };
}

function healthyBackup(prefix, overrides = {}) {
  const uri = `gs://guardian-backups/${prefix}`;
  return {
    [`${prefix}/all_namespaces_kind_all.overall_export_metadata`]: 'metadata',
    [`${prefix}/manifest.json`]: JSON.stringify({
      schemaVersion: 1,
      timestamp: '2026-07-15T07:13:00.000Z',
      project: 'guardian-prod',
      outputUriPrefix: uri,
      ...overrides,
    }),
  };
}

test('exact canonical backup passes only when metadata and manifest agree', async () => {
  const prefix = 'firestore/2026-07-15-0712';
  const result = await runIntegrityCheck({
    storage: makeStorage(healthyBackup(prefix)),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    backupUri: `gs://guardian-backups/${prefix}`,
    maxAgeHours: 2,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(result.healthy, true);
  assert.equal(result.report.layout, 'canonical');
  assert.equal(result.report.backupUri, `gs://guardian-backups/${prefix}`);
  assert.deepEqual(result.report.errors, []);
});

test('discovery finds canonical backups below firestore/ and keeps legacy readable', async () => {
  const legacy = 'firestore-export-2026-07-14-0712';
  const canonical = 'firestore/2026-07-15-0712';
  const result = await runIntegrityCheck({
    storage: makeStorage({
      ...healthyBackup(legacy, { timestamp: '2026-07-14T07:13:00.000Z' }),
      ...healthyBackup(canonical),
    }),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    maxAgeHours: 30,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(result.healthy, true);
  assert.equal(result.report.layout, 'canonical');
  assert.equal(result.report.backupUri, `gs://guardian-backups/${canonical}`);
  assert.equal(result.report.discoveredBackups, 2);
});

test('absence of recognized backups is an integrity failure', async () => {
  const result = await runIntegrityCheck({
    storage: makeStorage({ 'unrelated/file.txt': 'x' }),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    maxAgeHours: 30,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(result.healthy, false);
  assert.match(result.report.errors.join('\n'), /no recognized Firestore backups/i);
});

test('missing manifest or managed metadata is an integrity failure', async () => {
  const prefix = 'firestore/2026-07-15-0712';
  const noManifest = await runIntegrityCheck({
    storage: makeStorage({
      [`${prefix}/all_namespaces_kind_all.overall_export_metadata`]: 'metadata',
    }),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    backupUri: `gs://guardian-backups/${prefix}`,
    maxAgeHours: 2,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(noManifest.healthy, false);
  assert.match(noManifest.report.errors.join('\n'), /manifest\.json/i);

  const noMetadata = await runIntegrityCheck({
    storage: makeStorage({
      [`${prefix}/manifest.json`]: healthyBackup(prefix)[`${prefix}/manifest.json`],
    }),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    backupUri: `gs://guardian-backups/${prefix}`,
    maxAgeHours: 2,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(noMetadata.healthy, false);
  assert.match(noMetadata.report.errors.join('\n'), /overall_export_metadata/i);
});

test('manifest project, URI, JSON and freshness are validated', async () => {
  const prefix = 'firestore/2026-07-15-0712';
  for (const [name, manifest, expected] of [
    ['project', { project: 'other-project' }, /project/i],
    ['URI', { outputUriPrefix: 'gs://guardian-backups/firestore/other' }, /outputUriPrefix/i],
    ['stale', { timestamp: '2026-07-14T00:00:00.000Z' }, /stale/i],
  ]) {
    const result = await runIntegrityCheck({
      storage: makeStorage(healthyBackup(prefix, manifest)),
      projectId: 'guardian-prod',
      bucketUri: 'gs://guardian-backups',
      backupUri: `gs://guardian-backups/${prefix}`,
      maxAgeHours: 2,
      nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
    });
    assert.equal(result.healthy, false, name);
    assert.match(result.report.errors.join('\n'), expected, name);
  }

  const malformed = await runIntegrityCheck({
    storage: makeStorage({
      [`${prefix}/all_namespaces_kind_all.overall_export_metadata`]: 'metadata',
      [`${prefix}/manifest.json`]: '{not-json',
    }),
    projectId: 'guardian-prod',
    bucketUri: 'gs://guardian-backups',
    backupUri: `gs://guardian-backups/${prefix}`,
    maxAgeHours: 2,
    nowMs: Date.parse('2026-07-15T08:00:00.000Z'),
  });
  assert.equal(malformed.healthy, false);
  assert.match(malformed.report.errors.join('\n'), /invalid manifest/i);
});

(async () => {
  let failures = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      process.stdout.write(`OK: ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL: ${name}\n${error.stack}\n`);
    }
  }
  if (failures > 0) {
    process.stderr.write(`\n${failures} backup integrity test(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nOK: backup integrity tests passed (${cases.length}/${cases.length}).\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
