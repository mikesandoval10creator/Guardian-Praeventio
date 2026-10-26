import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../node_modules/vite-plus/bin/vp', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const cacheHit = /cache hit/;

test('Vite+ tracks real TypeScript inputs and does not cache failures', { timeout: 90_000 }, async (t) => {
  const fixture = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'guardian-viteplus-cache-'));
  const source = join(fixture, 'src');
  mkdirSync(source);
  const config = { compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [], target: 'ES2022' }, include: ['src'] };
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({
    name: 'guardian-viteplus-cache-fixture',
    private: true,
    scripts: { typecheck: `node ${JSON.stringify(compiler)} --noEmit` },
  }));
  writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify(config));
  writeFileSync(join(source, 'value.ts'), 'export const value = 1;\n');
  writeFileSync(join(source, 'index.ts'), "import { value } from './value';\nexport const checked: number = value;\n");

  function run() {
    const result = spawnSync(process.execPath, [cli, 'run', '--cache', 'typecheck'], {
      cwd: fixture,
      env: process.env,
      encoding: 'utf8',
      timeout: 25_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  }
  function succeeds(result, hit) {
    assert.equal(result.status, 0, result.output);
    assert.equal(cacheHit.test(result.output), hit, result.output);
  }
  function fails(result, diagnostic) {
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, diagnostic);
    assert.doesNotMatch(result.output, cacheHit);
  }

  try {
    await t.test('first run executes the compiler', () => succeeds(run(), false));
    await t.test('unchanged inputs replay the successful check', () => succeeds(run(), true));
    await t.test('a changed imported source invalidates a successful result', () => {
      writeFileSync(join(source, 'value.ts'), 'export const value = "intentional type error";\n');
      fails(run(), /TS2322/);
    });
    await t.test('the same failure executes again instead of being cached', () => fails(run(), /TS2322/));
    await t.test('restoring the original inputs can reuse their successful result', () => {
      writeFileSync(join(source, 'value.ts'), 'export const value = 1;\n');
      succeeds(run(), true);
    });
    await t.test('a newly included source cannot hide behind a prior cache hit', () => {
      writeFileSync(join(source, 'new-file.ts'), 'export const invalid: number = "intentional type error";\n');
      fails(run(), /TS2322/);
      rmSync(join(source, 'new-file.ts'));
    });
    await t.test('compiler configuration changes invalidate the result', () => {
      writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify({
        ...config, compilerOptions: { ...config.compilerOptions, types: ['__guardian_intentionally_missing_type__'] },
      }));
      fails(run(), /TS2688/);
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
