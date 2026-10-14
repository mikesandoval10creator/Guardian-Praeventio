import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('MCP compiles for Node and the entrypoint reaches configuration validation', () => {
  const build = spawnSync(process.execPath, [
    resolve(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.mcp.json',
  ], { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stdout + build.stderr);

  // No credentials or tenant are inherited: loading all runtime imports must
  // succeed before the CLI rejects its missing tenant configuration.
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run this regression with npm run test:mcp-build');
  const scratch = mkdtempSync(join(tmpdir(), 'mcp-start-'));
  try {
    const startup = spawnSync(process.execPath, [npmCli, '--silent', 'run', 'mcp:start'], {
      cwd: repo,
      env: {
        PATH: process.platform === 'win32'
          ? `${dirname(process.execPath)};C:\\Windows\\System32`
          : `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: scratch,
        TMPDIR: scratch,
        npm_config_cache: join(scratch, 'cache'),
      },
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 65536,
    });
    assert.ifError(startup.error);
    assert.equal(startup.status, 1, startup.stdout + startup.stderr);
    assert.match(startup.stderr, /PRAEVENTIO_MCP_TENANTS no configurada/);
    assert.equal(startup.stdout, '', 'MCP diagnostics must not pollute stdout');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
