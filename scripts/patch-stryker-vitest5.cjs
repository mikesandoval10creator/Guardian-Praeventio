#!/usr/bin/env node
'use strict';

// Backport the Apache-2.0 upstream Vitest 5 separator fix from PR #6214
// to the published Stryker Vitest runner 10.0.0. Vitest 5 uses " > " for
// nested test names; runner 10.0.0 filters mutants with space-joined names,
// so no covered test runs and every mutant survives. Keep this patch narrow,
// version-guarded, and fail-closed until npm ships the upstream fix (#6210).

const fs = require('node:fs');
const path = require('node:path');

function replaceExactly(root, relativePath, before, after) {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = source.split(before).length - 1;
  if (occurrences === 0) {
    if (source.includes(after)) return false;
    throw new Error(`[patch-stryker-vitest5] unexpected source in ${relativePath}`);
  }
  if (occurrences !== 1) {
    throw new Error(`[patch-stryker-vitest5] expected one patch anchor in ${relativePath}, found ${occurrences}`);
  }
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
  return true;
}

function patchStrykerRunner(root) {
  const packageFile = path.join(root, 'node_modules/@stryker-mutator/vitest-runner/package.json');
  if (!fs.existsSync(packageFile)) return { status: 'skipped-no-runner', patched: [] };

  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const runnerRoot = path.join(root, 'node_modules/@stryker-mutator/vitest-runner/dist/src');
  const files = {
    helpers: fs.readFileSync(path.join(runnerRoot, 'test-helpers.js'), 'utf8'),
    setup: fs.readFileSync(path.join(runnerRoot, 'stryker-setup.js'), 'utf8'),
    vitestHelpers: fs.readFileSync(path.join(runnerRoot, 'vitest-helpers.js'), 'utf8'),
    runner: fs.readFileSync(path.join(runnerRoot, 'vitest-test-runner.js'), 'utf8'),
  };
  const alreadyCompatible =
    files.helpers.includes("VITEST_5_TEST_NAME_SEPARATOR = ' > '") &&
    files.helpers.includes("LEGACY_TEST_NAME_SEPARATOR = ' '") &&
    files.helpers.includes('nameParts.join(separator)') &&
    files.setup.includes("inject('testNameSeparator')") &&
    files.setup.includes('toRawTestId(task, testNameSeparator)') &&
    files.setup.includes('nameParts.join(separator)') &&
    files.vitestHelpers.includes('toRawTestId(test, separator)') &&
    files.vitestHelpers.includes('collectTestName(test, separator)') &&
    files.runner.includes('VITEST_5_TEST_NAME_SEPARATOR') &&
    files.runner.includes("semver.satisfies(vitestWrapper.version, '>=5.0.0') ? VITEST_5_TEST_NAME_SEPARATOR : LEGACY_TEST_NAME_SEPARATOR") &&
    files.runner.includes("this.ctx.provide('testNameSeparator', this.#testNameSeparator);") &&
    files.runner.includes('convertTestToTestResult(test, this.#testNameSeparator)');
  if (alreadyCompatible) return { status: 'already-compatible', patched: [] };
  if (pkg.version !== '10.0.0') {
    throw new Error(`[patch-stryker-vitest5] runner ${pkg.version} is unrecognized and lacks the upstream fix; inspect before changing versions`);
  }

  const runnerFile = path.join(root, 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js');

  const patches = [
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/test-helpers.js',
      before: [
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
      after: [
        "export const VITEST_5_TEST_NAME_SEPARATOR = ' > ';",
        "export const LEGACY_TEST_NAME_SEPARATOR = ' ';",
        'export function collectTestName({ name, suite, }, separator = LEGACY_TEST_NAME_SEPARATOR) {',
        '    const nameParts = [name];',
        '    let currentSuite = suite;',
        '    while (currentSuite) {',
        '        nameParts.unshift(currentSuite.name);',
        '        currentSuite = currentSuite.suite;',
        '    }',
        '    return nameParts.join(separator).trim();',
        '}',
        'export function toRawTestId(test, separator = LEGACY_TEST_NAME_SEPARATOR) {',
        '    return `${test.file?.filepath ?? \'unknown.js\'}#${collectTestName(test, separator)}`;',
        '}',
      ].join('\n'),
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/stryker-setup.js',
      before: "const isGreaterThanVitest4Point1 = inject('isGreaterThanVitest4Point1');",
      after: "const isGreaterThanVitest4Point1 = inject('isGreaterThanVitest4Point1');\nconst testNameSeparator = inject('testNameSeparator');",
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/stryker-setup.js',
      before: 'ns.currentTestId = toRawTestId(task);',
      after: 'ns.currentTestId = toRawTestId(task, testNameSeparator);',
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/stryker-setup.js',
      before: [
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
      after: [
        'function collectTestName({ name, suite, }, separator) {',
        '    const nameParts = [name];',
        '    let currentSuite = suite;',
        '    while (currentSuite) {',
        '        nameParts.unshift(currentSuite.name);',
        '        currentSuite = currentSuite.suite;',
        '    }',
        '    return nameParts.join(separator).trim();',
        '}',
        'function toRawTestId(test, separator) {',
        '    return `${test.file?.filepath ?? \'unknown.js\'}#${collectTestName(test, separator)}`;',
        '}',
      ].join('\n'),
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-helpers.js',
      before: 'export function convertTestToTestResult(test) {',
      after: 'export function convertTestToTestResult(test, separator) {',
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-helpers.js',
      before: 'id: normalizeTestId(toRawTestId(test)),',
      after: 'id: normalizeTestId(toRawTestId(test, separator)),',
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-helpers.js',
      before: 'name: collectTestName(test),',
      after: 'name: collectTestName(test, separator),',
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js',
      before: "import { vitestWrapper } from './vitest-wrapper.js';",
      after: [
        "import { vitestWrapper } from './vitest-wrapper.js';",
        "import { LEGACY_TEST_NAME_SEPARATOR, VITEST_5_TEST_NAME_SEPARATOR } from './test-helpers.js';",
      ].join('\n'),
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js',
      before: [
        '    capabilities() {',
        '        return { reloadEnvironment: true };',
        '    }',
      ].join('\n'),
      after: [
        '    get #testNameSeparator() {',
        "        return semver.satisfies(vitestWrapper.version, '>=5.0.0') ? VITEST_5_TEST_NAME_SEPARATOR : LEGACY_TEST_NAME_SEPARATOR;",
        '    }',
        '    capabilities() {',
        '        return { reloadEnvironment: true };',
        '    }',
      ].join('\n'),
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js',
      before: "        this.ctx.provide('isGreaterThanVitest4Point1', semver.satisfies(vitestWrapper.version, '>=4.1.0'));",
      after: "        this.ctx.provide('isGreaterThanVitest4Point1', semver.satisfies(vitestWrapper.version, '>=4.1.0'));\n        this.ctx.provide('testNameSeparator', this.#testNameSeparator);",
    },
    {
      file: 'node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js',
      before: 'const testResult = convertTestToTestResult(test);',
      after: 'const testResult = convertTestToTestResult(test, this.#testNameSeparator);',
    },
  ];

  const patched = [];
  for (const patch of patches) {
    if (replaceExactly(root, patch.file, patch.before, patch.after)) patched.push(patch.file);
  }
  const verify = fs.readFileSync(runnerFile, 'utf8');
  if (!verify.includes('VITEST_5_TEST_NAME_SEPARATOR') || !verify.includes('testNameSeparator')) {
    throw new Error('[patch-stryker-vitest5] post-patch verification failed');
  }
  return { status: patched.length ? 'patched' : 'already-patched', patched: [...new Set(patched)] };
}

module.exports = { patchStrykerRunner };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = patchStrykerRunner(root);
  console.log(`[patch-stryker-vitest5] ${result.status}${result.patched.length ? ` (${result.patched.length} runtime files)` : ''}`);
}
