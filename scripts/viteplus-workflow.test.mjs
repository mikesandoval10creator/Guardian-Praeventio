import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('fast typecheck caches the canonical script instead of replacing the compiler', () => {
  assert.equal(packageJson.scripts['typecheck:fast'], 'vp run --cache typecheck');
});

test('iteration always runs the complete, uncached lint gate', () => {
  assert.equal(packageJson.scripts['verify:fast'], 'npm run typecheck:fast && npm run lint');
  for (const guard of [
    'eslint .',
    'check-open-reads-ratchet.cjs',
    'check-user-facing-errors.cjs',
    'check-pgp-disclosure-ratchet.cjs',
    'check-honesty-gate.cjs',
  ]) {
    assert.ok(packageJson.scripts.lint.includes(guard), `lint must retain ${guard}`);
  }
});

test('pre-PR verification executes both canonical gates without Vite+ caching', () => {
  assert.equal(packageJson.scripts['verify:fresh'], 'npm run typecheck && npm run lint');
});

test('workflow contracts have a dependency-free Node test entry point', () => {
  assert.equal(packageJson.scripts['test:toolchain'], 'node --test scripts/viteplus-workflow.test.mjs');
});

test('real cache invalidation regressions are exposed and included in CI', () => {
  assert.equal(packageJson.scripts['test:toolchain:cache'], 'node --test scripts/viteplus-cache.test.mjs');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('run: npm run test:toolchain && npm run test:toolchain:cache'));
});

test('the local Vite+ version is exact and matches the npm lockfile', () => {
  const version = packageJson.devDependencies['vite-plus'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages[''].devDependencies['vite-plus'], version);
  assert.equal(lock.packages['node_modules/vite-plus'].version, version);
});

for (const [workflow, firstGate] of [['verify:fast', 'typecheck:fast'], ['verify:fresh', 'typecheck']]) {
  for (const failingGate of ['', firstGate, 'lint']) {
    test(`${workflow}: ${failingGate ? `${failingGate} failure is propagated` : 'runs both gates in order'}`, () => {
      const fixture = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'guardian-viteplus-workflow-'));
      try {
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({
          private: true,
          scripts: {
            [workflow]: packageJson.scripts[workflow],
            [firstGate]: `node gate.mjs ${firstGate}`,
            lint: 'node gate.mjs lint',
          },
        }));
        writeFileSync(join(fixture, 'gate.mjs'), [
          "import { appendFileSync } from 'node:fs';",
          'const name = process.argv[2];',
          "appendFileSync('calls.log', `${name}\\n`);",
          'process.exit(process.env.GUARDIAN_TEST_FAIL_GATE === name ? 19 : 0);',
        ].join('\n'));
        const result = spawnSync(`npm run ${workflow}`, {
          cwd: fixture,
          env: { ...process.env, GUARDIAN_TEST_FAIL_GATE: failingGate },
          shell: true,
          encoding: 'utf8',
          timeout: 30_000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, failingGate ? 19 : 0, result.stdout + result.stderr);
        const calls = readFileSync(join(fixture, 'calls.log'), 'utf8').trim().split('\n');
        assert.deepEqual(calls, failingGate === firstGate ? [firstGate] : [firstGate, 'lint']);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
}
