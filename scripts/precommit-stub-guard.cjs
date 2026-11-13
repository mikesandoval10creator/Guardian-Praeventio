#!/usr/bin/env node
// scripts/precommit-stub-guard.cjs
// The Husky hook checks staged production files; CI also runs --full-tree.
// Rule 13 inventories explicit placeholders without treating error-class imports as stubs.
/* eslint-disable @typescript-eslint/no-require-imports -- The Husky hook is deliberately CommonJS. */
/* global require, module, process, console, __dirname */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY_RELATIVE_PATH = 'docs/stubs-inventory.md';
const BASELINE_RELATIVE_PATH = 'docs/stubs-inventory-baseline.json';
const SCAN_ROOTS = ['src', 'packages', 'wasm', 'android', 'ios'];
const ROOT_SOURCE_FILES = ['server.ts'];
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs',
  '.java', '.kt', '.swift', '.rs', '.c', '.cc', '.cpp', '.cxx', '.h', '.m', '.mm',
]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '__tests__', 'test', 'tests', 'androidtest', 'fixtures', 'examples',
  'generated', 'target', 'build', 'dist', 'pods', '.gradle',
]);
const STUB_PATTERNS = [
  {
    name: 'not-implemented-throw',
    expression: /\bthrow\s+(?:new\s+)?(?:[A-Za-z_$][\w$]*NotImplementedError|NotImplementedError)\b/g,
    extensions: null,
    ignoreCommentOnlyLines: true,
  },
  {
    name: 'mock-response',
    expression: /currently\s+returns\s+a\s+mock/gi,
    extensions: null,
    ignoreCommentOnlyLines: false,
  },
  {
    name: 'rust-todo',
    expression: /\b(?:todo|unimplemented)!\s*\(/g,
    extensions: new Set(['.rs']),
    ignoreCommentOnlyLines: true,
  },
  {
    name: 'kotlin-todo',
    expression: /\bTODO\s*\(/g,
    extensions: new Set(['.kt']),
    ignoreCommentOnlyLines: true,
  },
  {
    name: 'swift-fatal-placeholder',
    expression: /\bfatalError\s*\(\s*["'][^"']*(?:not implemented|todo)/gi,
    extensions: new Set(['.swift']),
    ignoreCommentOnlyLines: true,
  },
];

function normalizeRepositoryPath(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isProductionFile(file) {
  const normalized = normalizeRepositoryPath(file);
  const isRootServer = ROOT_SOURCE_FILES.includes(normalized);
  const isUnderSourceRoot = SCAN_ROOTS.some((root) => normalized.startsWith(`${root}/`));
  if (!isRootServer && !isUnderSourceRoot) return false;

  const extension = path.posix.extname(normalized).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) return false;

  const segments = normalized.split('/').map((segment) => segment.toLowerCase());
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) return false;
  if (/\.(?:test|spec)\.[^.]+$/i.test(normalized)) return false;
  if (/(?:^|\/)(?:[^/]*tests?\.(?:kt|swift|java))$/i.test(normalized)) return false;
  return true;
}

function isCommentOnlyLine(line) {
  return /^\s*(?:\/\/|\/\*|\*|\*\/|#)/.test(line);
}

function countStubMarkers(content, file) {
  const extension = path.posix.extname(normalizeRepositoryPath(file)).toLowerCase();
  let count = 0;
  for (const line of String(content).split(/\r?\n/)) {
    for (const pattern of STUB_PATTERNS) {
      if (pattern.extensions && !pattern.extensions.has(extension)) continue;
      if (pattern.ignoreCommentOnlyLines && isCommentOnlyLine(line)) continue;
      const matches = line.match(new RegExp(pattern.expression.source, pattern.expression.flags));
      if (matches) count += matches.length;
    }
  }
  return count;
}

function getStagedFiles(baseDir = REPO_ROOT) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
      cwd: baseDir,
      encoding: 'utf-8',
    });
    return out.split(/\r?\n/).filter(Boolean).map(normalizeRepositoryPath);
  } catch {
    // The local hook remains a no-op outside a Git checkout.
    return [];
  }
}

function getTrackedProductionFiles(baseDir = REPO_ROOT) {
  const args = ['ls-files', '-z', '--', ...SCAN_ROOTS, ...ROOT_SOURCE_FILES];
  const output = execFileSync('git', args, { cwd: baseDir });
  return [...new Set(output.toString('utf-8').split('\0').filter(Boolean)
    .map(normalizeRepositoryPath).filter(isProductionFile))].sort();
}

function readInventory(baseDir = REPO_ROOT) {
  const inventoryPath = path.join(baseDir, INVENTORY_RELATIVE_PATH);
  if (!fs.existsSync(inventoryPath)) return '';
  return fs.readFileSync(inventoryPath, 'utf-8');
}

function readStubBaseline(baseDir = REPO_ROOT) {
  const baselinePath = path.join(baseDir, BASELINE_RELATIVE_PATH);
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`${BASELINE_RELATIVE_PATH} is missing; full-tree stub scanning must fail closed`);
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  } catch (error) {
    throw new Error(`${BASELINE_RELATIVE_PATH} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (baseline.schemaVersion !== 1 || !baseline.markerCounts || typeof baseline.markerCounts !== 'object' || Array.isArray(baseline.markerCounts)) {
    throw new Error(`${BASELINE_RELATIVE_PATH} must contain schemaVersion 1 and a markerCounts object`);
  }
  for (const [file, count] of Object.entries(baseline.markerCounts)) {
    if (!isProductionFile(file) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error(`${BASELINE_RELATIVE_PATH} has an invalid entry for ${file}`);
    }
  }
  return baseline.markerCounts;
}

function normalizeInventoryPath(reference) {
  return normalizeRepositoryPath(reference.trim()).replace(/:\d+(?:\s*,\s*\d+)*$/, '');
}

function findInventorySection(file, inventory) {
  const sections = inventory.split(/^##\s+[^\r\n]*$/m).slice(1);
  for (const section of sections) {
    const fileLines = section.split(/\r?\n/).filter((line) => /^\s*-\s*\*\*Files?(?:\(s\))?\*\*:/i.test(line));
    const listedFiles = fileLines.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => normalizeInventoryPath(match[1])));
    if (listedFiles.includes(normalizeRepositoryPath(file))) return section;
  }
  return null;
}

function inventoryField(section, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = section.match(new RegExp(`^\\s*-\\s*\\*\\*${escapedField}\\*\\*\\s*:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function checkRule13_StubInInventory(files, inventory, baseDir = REPO_ROOT, baseline = readStubBaseline(baseDir)) {
  const failures = [];
  for (const rawFile of files) {
    const file = normalizeRepositoryPath(rawFile);
    if (!isProductionFile(file)) continue;
    const fullPath = path.join(baseDir, file);
    if (!fs.existsSync(fullPath)) continue;

    const markerCount = countStubMarkers(fs.readFileSync(fullPath, 'utf-8'), file);
    if (markerCount === 0) continue;

    const baselineCount = baseline[file];
    if (!Number.isSafeInteger(baselineCount)) {
      failures.push(`  ${file}: ${markerCount} stub marker(s) are not in ${BASELINE_RELATIVE_PATH}; baseline additions require inventory/owner review`);
    } else if (markerCount > baselineCount) {
      failures.push(`  ${file}: ${markerCount} stub marker(s) exceed baseline ${baselineCount}; review and update the baseline explicitly`);
    }

    const section = findInventorySection(file, inventory);
    if (!section) {
      failures.push(`  ${file}: contains stub markers but is missing from ${INVENTORY_RELATIVE_PATH}`);
      continue;
    }

    const owner = inventoryField(section, 'Owner');
    if (!owner || /^(?:TBD|TODO|UNASSIGNED)\b/i.test(owner)) {
      failures.push(`  ${file}: inventory entry needs an accountable Owner (TBD/TODO/UNASSIGNED is not accepted)`);
    }
    if (!inventoryField(section, 'Sprint target')) {
      failures.push(`  ${file}: inventory entry is missing Sprint target`);
    }
    if (!inventoryField(section, 'User-visible?')) {
      failures.push(`  ${file}: inventory entry is missing the User-visible? gate`);
    }
  }
  return failures;
}

function checkFullTree(baseDir = REPO_ROOT) {
  const files = getTrackedProductionFiles(baseDir);
  if (files.length === 0) throw new Error('No tracked production source files were found; refusing to pass an empty scan');
  const inventory = readInventory(baseDir);
  const baseline = readStubBaseline(baseDir);
  const failures = checkRule13_StubInInventory(files, inventory, baseDir, baseline);
  const markerFiles = files.filter((file) => {
    const fullPath = path.join(baseDir, file);
    return fs.existsSync(fullPath) && countStubMarkers(fs.readFileSync(fullPath, 'utf-8'), file) > 0;
  }).length;
  return { filesScanned: files.length, markerFiles, failures };
}

function isServerFile(file) {
  return normalizeRepositoryPath(file).startsWith('src/server/') && isProductionFile(file);
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

function main(args = process.argv.slice(2)) {
  if (args.includes('--full-tree')) {
    let result;
    try {
      result = checkFullTree(REPO_ROOT);
    } catch (error) {
      console.error(`\n[precommit-stub-guard] FAIL — full-tree scan could not run: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (result.failures.length > 0) {
      console.error('\n[precommit-stub-guard] FAIL — full-tree baseline/inventory violations:');
      result.failures.forEach((failure) => console.error(failure));
      process.exitCode = 1;
      return;
    }
    console.log(`[precommit-stub-guard] full-tree PASS — ${result.filesScanned} tracked production source files scanned; ${result.markerFiles} documented stub-bearing files remain within baseline.`);
    return;
  }

  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) return;
  let baseline;
  try {
    baseline = readStubBaseline(REPO_ROOT);
  } catch (error) {
    console.error(`\n[precommit-stub-guard] FAIL — ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const inventory = readInventory(REPO_ROOT);
  const allFailures = [
    ...checkRule13_StubInInventory(stagedFiles, inventory, REPO_ROOT, baseline),
    ...checkRule14_VoidAuditServerEvent(stagedFiles),
    ...checkRule15_MathRandomInServer(stagedFiles),
  ];

  if (allFailures.length > 0) {
    console.error('\n[precommit-stub-guard] FAIL — CLAUDE.md rules 13/14/15 violations:');
    allFailures.forEach((failure) => console.error(failure));
    console.error(`\nFix the issues above or add the stub to ${INVENTORY_RELATIVE_PATH} and the reviewed marker-count baseline.\n`);
    process.exitCode = 1;
  }
}

// Exported for self-test (require('./precommit-stub-guard.cjs'))
module.exports = {
  countStubMarkers,
  getTrackedProductionFiles,
  isProductionFile,
  isServerFile,
  checkFullTree,
  checkRule13_StubInInventory,
  checkRule14_VoidAuditServerEvent,
  checkRule15_MathRandomInServer,
};

// Only execute main() when invoked as CLI, not when required as a module
if (require.main === module) {
  main();
}
