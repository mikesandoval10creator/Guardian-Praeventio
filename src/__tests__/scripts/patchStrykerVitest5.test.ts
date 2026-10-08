import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type PatchResult = { status: string; patched: string[] };
const { patchStrykerRunner } = require(
  '../../../scripts/patch-stryker-vitest5.cjs',
) as { patchStrykerRunner: (root: string) => PatchResult };

const tempRoots: string[] = [];

function createRunnerFixture(version = '10.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'guardian-stryker-v5-patch-'));
  tempRoots.push(root);
  const packageDir = join(root, 'node_modules/@stryker-mutator/vitest-runner');
  const distDir = join(packageDir, 'dist/src');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version }));
  const files = {
    'test-helpers.js': [
      'export function collectTestName({ name, suite, }) {',
      '    const nameParts = [name];',
      '    let currentSuite = suite;',
      '    while (currentSuite) {',
      '        nameParts.unshift(currentSuite.name);',
      '        currentSuite = currentSuite.suite;',
      '    }',
      "    return nameParts.join(' ').trim();",
      '}',
      'export function toRawTestId(test) {',
      "    return `${test.file?.filepath ?? 'unknown.js'}#${collectTestName(test)}`;",
      '}',
    ].join('\n'),
    'stryker-setup.js': [
      "const isGreaterThanVitest4Point1 = inject('isGreaterThanVitest4Point1');",
      'ns.currentTestId = toRawTestId(task);',
      'function collectTestName({ name, suite, }) {',
      '    const nameParts = [name];',
      '    let currentSuite = suite;',
      '    while (currentSuite) {',
      '        nameParts.unshift(currentSuite.name);',
      '        currentSuite = currentSuite.suite;',
      '    }',
      "    return nameParts.join(' ').trim();",
      '}',
      'function toRawTestId(test) {',
      "    return `${test.file?.filepath ?? 'unknown.js'}#${collectTestName(test)}`;",
      '}',
    ].join('\n'),
    'vitest-helpers.js': [
      'export function convertTestToTestResult(test) {',
      '    id: normalizeTestId(toRawTestId(test)),',
      '    name: collectTestName(test),',
    ].join('\n'),
    'vitest-test-runner.js': [
      "import { vitestWrapper } from './vitest-wrapper.js';",
      '    capabilities() {',
      '        return { reloadEnvironment: true };',
      '    }',
      "        this.ctx.provide('isGreaterThanVitest4Point1', semver.satisfies(vitestWrapper.version, '>=4.1.0'));",
      'const testResult = convertTestToTestResult(test);',
    ].join('\n'),
  };
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(distDir, name), source);
  }
  return { root, distDir };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('patch-stryker-vitest5', () => {
  it('backports the separator fix once and remains idempotent', () => {
    const { root, distDir } = createRunnerFixture();
    const first = patchStrykerRunner(root);
    expect(first.status).toBe('patched');
    expect(new Set(first.patched).size).toBe(4);

    const helpers = readFileSync(join(distDir, 'test-helpers.js'), 'utf8');
    const setup = readFileSync(join(distDir, 'stryker-setup.js'), 'utf8');
    const runner = readFileSync(join(distDir, 'vitest-test-runner.js'), 'utf8');
    expect(helpers).toContain("VITEST_5_TEST_NAME_SEPARATOR = ' > '");
    expect(helpers).toContain('nameParts.join(separator)');
    expect(setup).toContain("inject('testNameSeparator')");
    expect(setup).toContain('toRawTestId(task, testNameSeparator)');
    expect(runner).toContain("semver.satisfies(vitestWrapper.version, '>=5.0.0')");
    expect(runner).toContain('? VITEST_5_TEST_NAME_SEPARATOR : LEGACY_TEST_NAME_SEPARATOR;');
    expect(runner).toContain('convertTestToTestResult(test, this.#testNameSeparator)');

    expect(patchStrykerRunner(root)).toEqual({
      status: 'already-compatible',
      patched: [],
    });
  });

  it('repairs an interrupted patch instead of accepting incomplete runner markers', () => {
    const { root, distDir } = createRunnerFixture();
    patchStrykerRunner(root);
    const runnerPath = join(distDir, 'vitest-test-runner.js');
    const partial = readFileSync(runnerPath, 'utf8').replace(
      "        this.ctx.provide('testNameSeparator', this.#testNameSeparator);\n",
      '',
    );
    writeFileSync(runnerPath, partial);

    const repaired = patchStrykerRunner(root);
    expect(repaired.status).toBe('patched');
    expect(repaired.patched).toContain(
      'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js',
    );
    expect(readFileSync(runnerPath, 'utf8')).toContain(
      "this.ctx.provide('testNameSeparator', this.#testNameSeparator);",
    );
  });

  it('skips production installs where the dev-only runner is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'guardian-stryker-v5-no-runner-'));
    tempRoots.push(root);
    expect(patchStrykerRunner(root)).toEqual({
      status: 'skipped-no-runner',
      patched: [],
    });
  });

  it('fails closed when an unrecognized runner version lacks the fix', () => {
    const { root } = createRunnerFixture('10.1.0');
    expect(() => patchStrykerRunner(root)).toThrow(/unrecognized/);
  });
});
