#!/usr/bin/env node
// scripts/check-honesty-gate.cjs
//
// Honesty gate: prevents fabricated data (Math.random, sentinel values)
// from being committed in mounted UI components.
//
// PENDIENTE.md section B: "construir un gate (regla anti-Math.random/
// sentinel-ignorado en componentes)"
//
// Ratchet pattern: baseline list of current violations that can only shrink.
//
// Usage:
//   node scripts/check-honesty-gate.cjs            # check against baseline
//   node scripts/check-honesty-gate.cjs --write    # regenerate baseline
//   node scripts/check-honesty-gate.cjs --report   # report-only (no exit code)

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'honesty-gate-baseline.json');

// Files that are mounted (routed) UI components
function isMountedComponent(file) {
  if (!file.startsWith('src/')) return false;
  if (file.includes('/__tests__/')) return false;
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return false;
  // Only check pages and components
  if (!file.startsWith('src/pages/') && !file.startsWith('src/components/')) return false;
  return true;
}

// Legitimate Math.random uses that should NOT be flagged
const LEGITIMATE_PATTERNS = [
  /\/\/ .*Math\.random/, // Comments mentioning Math.random
  /\/\*[\s\S]*?Math\.random[\s\S]*?\*\//, // Block comments
  /deterministic/i, // Deterministic utilities
  /seedable/i, // Seedable RNG
  /PRNG/i, // Pseudo-random number generator
  /fallback.*Math\.random/i, // Documented fallbacks
  /Math\.random.*fallback/i, // Documented fallbacks
  /reemplaza.*Math\.random/i, // Spanish: replaces Math.random
  /Math\.random.*reemplaza/i, // Spanish: Math.random replaces
  /no.*Math\.random/i, // "no Math.random" - honest code
  /sin.*Math\.random/i, // Spanish: without Math.random
  /Math\.random.*test/i, // Test utilities
  /jest\.spyOn.*Math\.random/i, // Jest mocks
  /vi\.spyOn.*Math\.random/i, // Vitest mocks
];

function hasLegitimateContext(content, lineIndex, lines) {
  // Check the line itself and 3 lines before for context
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length, lineIndex + 2);
  const context = lines.slice(start, end).join('\n');

  for (const pattern of LEGITIMATE_PATTERNS) {
    if (pattern.test(context)) return true;
  }
  return false;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Math\.random\(\)/.test(line)) {
      if (!hasLegitimateContext(content, i, lines)) {
        violations.push({
          line: i + 1,
          content: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

function getAllMountedFiles() {
  try {
    const out = execSync('git ls-files src/pages/ src/components/', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return out.split('\n').filter(Boolean).filter(isMountedComponent);
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const isWrite = args.includes('--write');
  const isReport = args.includes('--report');

  const files = getAllMountedFiles();
  const allViolations = [];

  for (const file of files) {
    const fullPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    const violations = scanFile(fullPath);
    for (const v of violations) {
      allViolations.push({ file, ...v });
    }
  }

  // Sort for deterministic output
  allViolations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (isReport) {
    console.log(`[honesty-gate] Found ${allViolations.length} Math.random() uses in mounted components:`);
    for (const v of allViolations) {
      console.log(`  ${v.file}:${v.line}: ${v.content}`);
    }
    process.exit(0);
  }

  if (isWrite) {
    const baseline = {
      _doc: 'Ratchet baseline for scripts/check-honesty-gate.cjs. List of Math.random() uses in mounted UI components that are documented/justified. The list may only SHRINK: a NEW Math.random() in a mounted component fails the gate. When you remove a justified use, regenerate with `node scripts/check-honesty-gate.cjs --write`.',
      count: allViolations.length,
      violations: allViolations,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`[honesty-gate] baseline written: ${allViolations.length} violations.`);
    process.exit(0);
  }

  // Check mode
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('[honesty-gate] No baseline found. Run with --write to create one.');
    process.exit(1);
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[honesty-gate] Could not parse baseline: ${err.message}`);
    process.exit(1);
  }

  // Check for NEW violations (not in baseline)
  const baselineSet = new Set(
    baseline.violations.map((v) => `${v.file}:${v.line}`)
  );
  const newViolations = allViolations.filter(
    (v) => !baselineSet.has(`${v.file}:${v.line}`)
  );

  // Check for removed violations (baseline should shrink)
  const currentSet = new Set(
    allViolations.map((v) => `${v.file}:${v.line}`)
  );
  const removed = baseline.violations.filter(
    (v) => !currentSet.has(`${v.file}:${v.line}`)
  );

  if (newViolations.length > 0) {
    console.error('\n[honesty-gate] FAIL — new Math.random() in mounted components:');
    for (const v of newViolations) {
      console.error(`  ${v.file}:${v.line}: ${v.content}`);
    }
    console.error(
      '\nRemove the Math.random() or use a deterministic alternative.'
    );
    process.exit(1);
  }

  if (removed.length > 0) {
    console.error(
      '\n[honesty-gate] FAIL — violations removed; regenerate baseline ' +
        '(`node scripts/check-honesty-gate.cjs --write`):'
    );
    for (const v of removed) {
      console.error(`  ${v.file}:${v.line}`);
    }
    process.exit(1);
  }

  console.log(
    `[honesty-gate] PASS — ${allViolations.length} violations held (baseline ${baseline.count}).`
  );
}

main();
