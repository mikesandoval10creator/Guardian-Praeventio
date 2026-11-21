const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { test } = require('node:test');

test('Guardian application paths do not reference the experimental splat engine', () => {
  const { status, stdout, stderr, error } = spawnSync(
    'git',
    ['grep', '-nE', 'gaussian-splat/|guardian_gaussian_splat|createSplatValidator', '--', 'src', 'public', 'vite.config.ts', 'server.ts', 'package.json', 'index.html'],
    { cwd: join(__dirname, '../../..'), encoding: 'utf8' },
  );
  assert.ifError(error);
  assert.equal(status, 1, stderr || stdout);
});
