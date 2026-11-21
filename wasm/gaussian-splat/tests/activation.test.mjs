import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

test('Guardian application paths do not reference the experimental splat engine', () => {
  const { status, stdout, stderr, error } = spawnSync(
    'git',
    ['grep', '-nE', 'gaussian-splat/|guardian_gaussian_splat|createSplatValidator', '--', 'src', 'public', 'vite.config.ts', 'server.ts', 'package.json', 'index.html'],
    { cwd: join(import.meta.dirname, '../../..'), encoding: 'utf8' },
  );
  assert.ifError(error);
  assert.equal(status, 1, stderr || stdout);
});
