#!/usr/bin/env node
'use strict';

// Cross-platform, non-printing bootstrap/rotation helper. The generated HMAC
// material is passed to gcloud over stdin and is never written to disk or
// echoed to logs.
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateLookupKeyring } = require('./health-professional-lookup-keyring.cjs');

const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
const argv = process.argv.slice(2);
const valueOf = (name) => {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};
const project = valueOf('project') || process.env.GOOGLE_CLOUD_PROJECT;
const rotate = argv.includes('--rotate');
const version = valueOf('version') || new Date().toISOString().slice(0, 10);
const secretId = 'HEALTH_PROFESSIONAL_LOOKUP_KEYS';

if (!project) {
  console.error('Pass --project=<gcp-project> or set GOOGLE_CLOUD_PROJECT.');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{1,40}$/.test(version)) {
  console.error('--version must contain only letters, numbers, dot, underscore or hyphen.');
  process.exit(1);
}

function run(args, input) {
  return spawnSync(gcloud, args, {
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

function failure(result) {
  return result.error?.message || String(result.stderr || '').trim() || 'unknown gcloud error';
}

const described = run(['secrets', 'describe', secretId, '--project', project, '--format=value(name)']);
let createdNow = false;
if (described.status !== 0) {
  const created = run([
    'secrets', 'create', secretId,
    '--project', project,
    '--replication-policy=automatic',
    '--labels=app=praeventio-guard,data-class=restricted',
  ]);
  if (created.status !== 0) {
    console.error(`Could not create ${secretId}: ${failure(created)}`);
    process.exit(1);
  }
  createdNow = true;
}

let keyring = {};
const current = run(['secrets', 'versions', 'access', 'latest', '--secret', secretId, '--project', project]);
if (current.status === 0) {
  try {
    keyring = JSON.parse(current.stdout);
  } catch {
    console.error(`Latest ${secretId} version is not valid JSON; refusing to overwrite it.`);
    process.exit(1);
  }
  if (!validateLookupKeyring(keyring)) {
    console.error(`Latest ${secretId} version has an invalid keyring shape; refusing to overwrite it.`);
    process.exit(1);
  }
  if (!rotate) {
    console.info(`${secretId} already has an accessible version; no change made.`);
    process.exit(0);
  }
} else if (!createdNow) {
  console.error(
    `Could not access the existing ${secretId}; refusing to replace unknown key versions: ${failure(current)}`,
  );
  process.exit(1);
}
if (Object.prototype.hasOwnProperty.call(keyring, version)) {
  console.error(`Key version ${version} already exists; choose a new --version.`);
  process.exit(1);
}

// Insertion order is the contract: the first entry is the active primary key.
const nextKeyring = JSON.stringify({ [version]: randomBytes(32).toString('hex'), ...keyring });
const added = run([
  'secrets', 'versions', 'add', secretId,
  '--project', project,
  '--data-file=-',
], nextKeyring);
if (added.status !== 0) {
  console.error(`Could not add ${secretId} version: ${failure(added)}`);
  process.exit(1);
}
console.info(
  rotate
    ? `Added primary lookup key ${version}; keep old keys until the audited reindex completes.`
    : `Bootstrapped ${secretId} with primary key ${version}.`,
);
