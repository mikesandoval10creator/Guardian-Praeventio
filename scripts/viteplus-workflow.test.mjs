import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const STUB_GATES = ['test:stub-guard', 'lint:stub-guard'];

for (const [workflow, firstGate] of [['verify:fast', 'typecheck:fast'], ['verify:fresh', 'typecheck']]) {
  const expected = `npm run ${firstGate} && npm run lint && npm run test:stub-guard && npm run lint:stub-guard`;
  test(`${workflow} runs typecheck, lint, and full-tree stub gates in order`, () => {
    assert.equal(packageJson.scripts[workflow], expected);
  });
}

test('fast typecheck caches the canonical script instead of replacing the compiler', () => {
  assert.equal(packageJson.scripts['typecheck:fast'], 'vp run --cache typecheck');
});

test('iteration always runs the complete, uncached lint gate', () => {
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

test('stub-guard scripts expose local verification', () => {
  assert.equal(packageJson.scripts['test:stub-guard'], 'node scripts/precommit-stub-guard.test.cjs');
  assert.equal(packageJson.scripts['lint:stub-guard'], 'eslint --no-ignore scripts/precommit-stub-guard.cjs scripts/precommit-stub-guard.test.cjs scripts/viteplus-workflow.test.mjs && node scripts/precommit-stub-guard.cjs --full-tree');
});

test('workflow contracts have a dependency-free Node test entry point', () => {
  assert.equal(packageJson.scripts['test:toolchain'], 'node --test scripts/viteplus-workflow.test.mjs');
});

test('toolchain and stub-guard checks are explicit CI gates', () => {
  assert.equal(packageJson.scripts['test:toolchain:cache'], 'node --test scripts/viteplus-cache.test.mjs');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('run: npm run test:toolchain && npm run test:toolchain:cache'));
  assert.ok(ci.includes('run: npm run test:stub-guard'));
  assert.ok(ci.includes('run: npm run lint:stub-guard'));
});

test('the local Vite+ version is exact and matches the npm lockfile', () => {
  const version = packageJson.devDependencies['vite-plus'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages[''].devDependencies['vite-plus'], version);
  assert.equal(lock.packages['node_modules/vite-plus'].version, version);
});

for (const [workflow, firstGate] of [['verify:fast', 'typecheck:fast'], ['verify:fresh', 'typecheck']]) {
  const gates = [firstGate, 'lint', ...STUB_GATES];
  for (const failingGate of ['', ...gates]) {
    test(`${workflow}: ${failingGate ? `${failingGate} failure is propagated` : 'runs every gate in order'}`, () => {
      const fixture = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'guardian-viteplus-workflow-'));
      try {
        const scripts = {
          [workflow]: packageJson.scripts[workflow],
          ...Object.fromEntries(gates.map((gate) => [gate, `node gate.mjs ${gate}`])),
        };
        writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts }));
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
        const failedIndex = gates.indexOf(failingGate);
        const expectedCalls = failingGate ? gates.slice(0, failedIndex + 1) : gates;
        assert.deepEqual(calls, expectedCalls);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
}
