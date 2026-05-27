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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  assert.equal(guard.isProductionFile('src/__tests__/server/foo.test.ts'), false);
  assert.equal(guard.isProductionFile('scripts/foo.cjs'), false);
  assert.equal(guard.isProductionFile('docs/foo.md'), false);
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
    const failures = guard.checkRule13_StubInInventory([stubFile], '# Empty inventory\n', repo);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /missing from docs\/stubs-inventory\.md/);
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
    const inventory = `# Stubs Inventory\n- File: \`${stubFile}\`\n`;
    const failures = guard.checkRule13_StubInInventory([stubFile], inventory, repo);
    assert.equal(failures.length, 0);
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
