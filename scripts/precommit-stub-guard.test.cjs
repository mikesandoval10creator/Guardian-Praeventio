#!/usr/bin/env node
/**
 * precommit-stub-guard.test.cjs — Self-test for the stub guard script.
 *
 * Run: node scripts/precommit-stub-guard.test.cjs
 *
 * Uses node:test (built-in, Node 18+) — no extra deps required, mirroring
 * the pattern in scripts/download-mediapipe-models.test.cjs.
 *
 * Strategy: load the guard module via require (which only registers helpers
 * because of the `require.main === module` gate) and exercise each rule
 * checker directly against fixture files in a tmpdir.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node test fixture intentionally exercises the CommonJS hook. */
/* global require */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const guard = require('./precommit-stub-guard.cjs');

function makeFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-guard-test-'));
  fs.mkdirSync(path.join(root, 'src', 'server', 'routes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'services'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', '__tests__', 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  return root;
}

test('isProductionFile classifies paths correctly', () => {
  assert.equal(guard.isProductionFile('src/server/routes/foo.ts'), true);
  assert.equal(guard.isProductionFile('src/services/bar.ts'), true);

  assert.equal(guard.isProductionFile('src/services/bar.test.ts'), false);
  assert.equal(guard.isProductionFile('src/server/routes/foo.test.ts'), false);
  assert.equal(guard.isProductionFile('src/__tests__/server/foo.test.ts'), false);
  assert.equal(guard.isProductionFile('packages/capacitor-mesh/src/index.ts'), true);
  assert.equal(guard.isProductionFile('wasm/force-graph-layout/src/lib.rs'), true);
  assert.equal(guard.isProductionFile('android/app/src/main/java/Example.kt'), true);
  assert.equal(guard.isProductionFile('ios/App/Example.swift'), true);
  assert.equal(guard.isProductionFile('packages/capacitor-mesh/src/index.test.ts'), false);
  assert.equal(guard.isProductionFile('scripts/foo.cjs'), false);
  assert.equal(guard.isProductionFile('docs/foo.md'), false);
});

test('countStubMarkers ignores type references/comments and recognizes source-language stubs', () => {
  const ts = [
    "import { NotImplementedError } from './errors';",
    '// throw new NotImplementedError() is only documentation',
    "throw new AdapterNotImplementedError('AU', 'pending');",
    "const message = 'currently returns a mock';",
  ].join('\n');
  assert.equal(guard.countStubMarkers(ts, 'src/services/adapter.ts'), 2);

  const rust = '// todo!() in a comment\nlet result = todo!(); unimplemented!();';
  assert.equal(guard.countStubMarkers(rust, 'wasm/engine/src/lib.rs'), 2);
  assert.equal(guard.countStubMarkers('fun load() = TODO("pending")', 'packages/plugin/src/Plugin.kt'), 1);
  assert.equal(guard.countStubMarkers('fatalError("Not implemented")', 'ios/App/Plugin.swift'), 1);
});

test('isServerFile only matches src/server/* production code', () => {
  assert.equal(guard.isServerFile('src/server/routes/foo.ts'), true);
  assert.equal(guard.isServerFile('src/server/middleware/auth.ts'), true);

  assert.equal(guard.isServerFile('src/services/foo.ts'), false);
  assert.equal(guard.isServerFile('src/server/routes/foo.test.ts'), false);
});

test('checkRule13: stub-marker file missing from inventory → fail', () => {
  const repo = makeFixtureRepo();
  try {
    const stubFile = 'src/services/mystery.ts';
    fs.writeFileSync(path.join(repo, stubFile),
      'export function thing() { throw new NotImplementedError(); }');
    const baseline = {};
    const failures = guard.checkRule13_StubInInventory([stubFile], '# Empty inventory\n', repo, baseline);
    assert.ok(failures.some((failure) => /missing from docs\/stubs-inventory\.md/.test(failure)));
    assert.ok(failures.some((failure) => /baseline/.test(failure)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule13: stub-marker file LISTED in inventory → pass', () => {
  const repo = makeFixtureRepo();
  try {
    const stubFile = 'src/services/mystery.ts';
    fs.writeFileSync(path.join(repo, stubFile),
      'export function thing() { throw new NotImplementedError(); }');
    const inventory = [
      '# Stubs Inventory',
      '## Mystery adapter',
      '- **File**: `' + stubFile + '`',
      '- **Owner**: Guardian implementation',
      '- **Sprint target**: Blocked until adapter contract is approved',
      '- **User-visible?**: No success-shaped output; errors fail closed.',
    ].join('\n');
    const failures = guard.checkRule13_StubInInventory([stubFile], inventory, repo, { [stubFile]: 1 });
    assert.equal(failures.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule13 rejects an inventoried stub with no owner or visibility gate', () => {
  const repo = makeFixtureRepo();
  try {
    const stubFile = 'src/services/mystery.ts';
    fs.writeFileSync(path.join(repo, stubFile), 'throw new NotImplementedError();');
    const inventory = [
      '# Stubs Inventory',
      '## Mystery adapter',
      '- **File**: `' + stubFile + '`',
      '- **Sprint target**: Blocked',
    ].join('\n');
    const failures = guard.checkRule13_StubInInventory([stubFile], inventory, repo, { [stubFile]: 1 });
    assert.ok(failures.some((failure) => /Owner/.test(failure)));
    assert.ok(failures.some((failure) => /User-visible/.test(failure)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule13 rejects an increased marker count in an already inventoried file', () => {
  const repo = makeFixtureRepo();
  try {
    const stubFile = 'packages/example/src/adapter.ts';
    fs.mkdirSync(path.dirname(path.join(repo, stubFile)), { recursive: true });
    fs.writeFileSync(path.join(repo, stubFile), [
      'throw new FirstNotImplementedError();',
      'throw new SecondNotImplementedError();',
    ].join('\n'));
    const inventory = [
      '# Stubs Inventory',
      '## Example adapter',
      '- **File**: `' + stubFile + '`',
      '- **Owner**: Guardian implementation',
      '- **Sprint target**: Blocked until adapter contract is approved',
      '- **User-visible?**: No success-shaped output; errors fail closed.',
    ].join('\n');
    const failures = guard.checkRule13_StubInInventory([stubFile], inventory, repo, { [stubFile]: 1 });
    assert.ok(failures.some((failure) => /2.*baseline.*1|baseline.*1.*2/.test(failure)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('full-tree scan catches a tracked but unstaged stub under packages/', () => {
  const repo = makeFixtureRepo();
  try {
    const stubFile = 'packages/example/src/adapter.ts';
    fs.mkdirSync(path.dirname(path.join(repo, stubFile)), { recursive: true });
    fs.writeFileSync(path.join(repo, stubFile), 'export const adapter = true;');
    fs.writeFileSync(path.join(repo, 'docs', 'stubs-inventory.md'), '# Stubs Inventory');
    fs.writeFileSync(path.join(repo, 'docs', 'stubs-inventory-baseline.json'), JSON.stringify({ schemaVersion: 1, markerCounts: {} }));
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Stub Guard Test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'stub-guard@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['add', 'packages/example/src/adapter.ts', 'docs/stubs-inventory.md', 'docs/stubs-inventory-baseline.json'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture baseline'], { cwd: repo, stdio: 'ignore' });

    fs.writeFileSync(path.join(repo, stubFile), 'export const adapter = () => { throw new NotImplementedError(); };');
    const files = guard.getTrackedProductionFiles(repo);
    assert.ok(files.includes(stubFile));
    const result = guard.checkFullTree(repo);
    assert.ok(result.failures.some((failure) => failure.includes(stubFile)));
    assert.ok(result.failures.some((failure) => /baseline/.test(failure)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule14: void auditServerEvent in server → fail', () => {
  const repo = makeFixtureRepo();
  try {
    const badFile = 'src/server/routes/bad.ts';
    fs.writeFileSync(path.join(repo, badFile),
      'export async function handler() { void auditServerEvent("foo", {}); }');
    const failures = guard.checkRule14_VoidAuditServerEvent([badFile], repo);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /void auditServerEvent/);
    assert.match(failures[0], /rule 14/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule14: awaited auditServerEvent → pass', () => {
  const repo = makeFixtureRepo();
  try {
    const goodFile = 'src/server/routes/good.ts';
    fs.writeFileSync(path.join(repo, goodFile),
      'export async function h() { try { await auditServerEvent("x", {}); } catch (e) { logger.error(e); } }');
    const failures = guard.checkRule14_VoidAuditServerEvent([goodFile], repo);
    assert.equal(failures.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule15: Math.random() in server → fail', () => {
  const repo = makeFixtureRepo();
  try {
    const badFile = 'src/server/routes/random-id.ts';
    fs.writeFileSync(path.join(repo, badFile),
      'export const id = "x-" + Math.random().toString(36);');
    const failures = guard.checkRule15_MathRandomInServer([badFile], repo);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /Math\.random/);
    assert.match(failures[0], /rule 15/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkRule15: Math.random in non-server file → pass (out of scope)', () => {
  const repo = makeFixtureRepo();
  try {
    const clientFile = 'src/services/clientUtils.ts';
    fs.writeFileSync(path.join(repo, clientFile),
      'export const jitter = () => Math.random();');
    const failures = guard.checkRule15_MathRandomInServer([clientFile], repo);
    assert.equal(failures.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
