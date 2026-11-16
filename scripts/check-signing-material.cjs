#!/usr/bin/env node
'use strict';

// Defense in depth for accidental signing-material commits. Paths only:
// never read/print file contents, never replace gitleaks, never mutate Git.
const { spawnSync } = require('node:child_process');

function forbiddenPath(file) {
  const normalized = file.replace(/\\/g, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return /\.(?:jks|keystore|p12|pfx)$/i.test(basename)
    || /^(?:local|key|keystore|signing)\.properties$/i.test(basename);
}

function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !['--staged', '--tracked'].includes(args[0]))) {
    console.error('[signing-material-guard] ERROR: use --staged (default) or --tracked.');
    return 2;
  }
  const tracked = args[0] === '--tracked';
  const gitArgs = tracked
    ? ['ls-files', '-z']
    : ['diff', '--cached', '--name-only', '--diff-filter=d', '-z'];
  const result = spawnSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    console.error('[signing-material-guard] ERROR: Git inspection failed; refusing to pass.');
    return 2;
  }
  const blocked = result.stdout.split('\0').filter(Boolean).filter(forbiddenPath);
  if (blocked.length) {
    console.error(`[signing-material-guard] BLOCKED: ${JSON.stringify(blocked)}`);
    console.error('Remove local/signing files from the index; keep real keys outside version control. Deletions are allowed.');
    return 1;
  }
  console.log(`[signing-material-guard] PASS — ${tracked ? 'tracked tree' : 'staged paths'} contain no protected signing/local filenames.`);
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { forbiddenPath, main };
