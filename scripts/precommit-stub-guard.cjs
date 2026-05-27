#!/usr/bin/env node
// scripts/precommit-stub-guard.cjs
// Enforces CLAUDE.md rules 13, 14, 15 by inspecting staged files.
// NOT wired into .husky/pre-commit yet (PR #514's job).

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY_PATH = path.join(REPO_ROOT, 'docs', 'stubs-inventory.md');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: REPO_ROOT, encoding: 'utf-8'
    });
    return out.split('\n').filter(Boolean);
  } catch {
    // Not in a git repo / no staged files — pass-through
    return [];
  }
}

function readInventory() {
  if (!fs.existsSync(INVENTORY_PATH)) return '';
  return fs.readFileSync(INVENTORY_PATH, 'utf-8');
}

function isProductionFile(file) {
  if (!file.startsWith('src/')) return false;
  if (file.includes('/__tests__/')) return false;
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return false;
  return true;
}

function isServerFile(file) {
  return file.startsWith('src/server/') && isProductionFile(file);
}

function checkRule13_StubInInventory(stagedFiles, inventory, baseDir = REPO_ROOT) {
  const failures = [];
  for (const file of stagedFiles) {
    if (!isProductionFile(file)) continue;
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (/NotImplementedError|currently returns a mock/.test(content)) {
      if (!inventory.includes(file)) {
        failures.push(`  ${file}: contains stub markers but missing from docs/stubs-inventory.md`);
      }
    }
  }
  return failures;
}

function checkRule14_VoidAuditServerEvent(stagedFiles, baseDir = REPO_ROOT) {
  const failures = [];
  for (const file of stagedFiles) {
    if (!isServerFile(file)) continue;
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (/void\s+auditServerEvent/.test(content)) {
      failures.push(`  ${file}: 'void auditServerEvent' violates rule 14 — use 'await' with try/catch + logger.error + Sentry`);
    }
  }
  return failures;
}

function checkRule15_MathRandomInServer(stagedFiles, baseDir = REPO_ROOT) {
  const failures = [];
  for (const file of stagedFiles) {
    if (!isServerFile(file)) continue;
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (/Math\.random\(\)/.test(content)) {
      failures.push(`  ${file}: 'Math.random()' in server code violates rule 15 — use randomId() from src/utils/randomId.ts`);
    }
  }
  return failures;
}

function main() {
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    process.exit(0); // Nothing to check
  }
  const inventory = readInventory();

  const allFailures = [
    ...checkRule13_StubInInventory(stagedFiles, inventory),
    ...checkRule14_VoidAuditServerEvent(stagedFiles),
    ...checkRule15_MathRandomInServer(stagedFiles),
  ];

  if (allFailures.length > 0) {
    console.error('\n[precommit-stub-guard] FAIL — CLAUDE.md rules 13/14/15 violations:');
    allFailures.forEach(f => console.error(f));
    console.error('\nFix the issues above OR add the stub to docs/stubs-inventory.md\n');
    process.exit(1);
  }
  process.exit(0);
}

// Exported for self-test (require('./precommit-stub-guard.cjs'))
module.exports = {
  isProductionFile,
  isServerFile,
  checkRule13_StubInInventory,
  checkRule14_VoidAuditServerEvent,
  checkRule15_MathRandomInServer,
};

// Only execute main() when invoked as CLI, not when required as a module
if (require.main === module) {
  main();
}
