#!/usr/bin/env node
// scripts/check-convention-guard.cjs
//
// Enforces two CLAUDE.md hard conventions across `src/server/routes/*`:
//   • Rule #3  — every state-changing op MUST write to `audit_logs`
//                (via `auditServerEvent` or a direct `audit_logs` write).
//   • Rule #19 — a read-modify-write on the same doc MUST use `runTransaction`.
//
// Ratchet philosophy (mirrors `check-coverage-ratchet.cjs`): the set of KNOWN
// violations lives in `scripts/convention-guard-baseline.json` and can only
// SHRINK. A NEW mutating route without audit fails the gate — that is the
// anti-regression seal. As each route is fixed it drops out of the live scan;
// remove it from the baseline so it can never silently regress.
//
// Scope of confidence:
//   • Rule #3 is a HARD GATE — "does the file mutate Firestore and never
//     reference an audit write?" is a reliable file-level signal.
//   • Rule #19 is a TRACKED CHECKLIST, not an auto-detector — proving a
//     same-doc read-modify-write needs dataflow/AST analysis, not regex. The
//     baseline carries the human-verified pending list; the guard confirms
//     each one once it gains `runTransaction` and nudges you to clear it.
//     (Future: AST-based #19 detection.)
//
// Report-only when the baseline file is absent (so it can be seeded first),
// exactly like the coverage ratchet.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'server', 'routes');
const BASELINE_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'convention-guard-baseline.json',
);

// A route "mutates" persistent state if it writes Firestore directly or drives
// a persistence adapter. Coarse on purpose — false positives are absorbed by
// the baseline's `rule3_exempt`; the goal is to never MISS a real new writer.
const MUTATE_RE =
  /\.(set|update|add|delete|create|save|commit)\s*\(|new\s+\w*Adapter\s*\(/;
// A route "audits" if it calls the helper OR writes the canonical collection.
const AUDIT_RE = /auditServerEvent|['"]audit_logs['"]/;
const TXN_RE = /runTransaction/;

function listRouteFiles(dir = ROUTES_DIR) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listRouteFiles(full));
      continue;
    }
    if (!ent.name.endsWith('.ts')) continue;
    if (ent.name.endsWith('.test.ts') || ent.name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/** repo-relative route id without extension, e.g. `b2d/suite`, `visitors`. */
function routeName(file) {
  return path
    .relative(ROUTES_DIR, file)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '');
}

/** Scan all route files; return the live violation sets. */
function scan(files = listRouteFiles()) {
  const rule3 = []; // mutates && !audits
  const rule19Tracked = []; // routes that still have NO runTransaction at all
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    const name = routeName(f);
    if (MUTATE_RE.test(c) && !AUDIT_RE.test(c)) rule3.push(name);
    if (!TXN_RE.test(c)) rule19Tracked.push(name);
  }
  return { rule3: rule3.sort(), rule19Tracked };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[convention-guard] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function main() {
  const { rule3, rule19Tracked } = scan();
  const rule19Set = new Set(rule19Tracked);
  const baseline = loadBaseline();

  if (!baseline) {
    console.log('[convention-guard] REPORT-ONLY (no baseline yet)\n');
    console.log(`rule #3 — mutating routes WITHOUT audit_logs (${rule3.length}):`);
    rule3.forEach((r) => console.log('  ' + r));
    console.log(
      '\nSeed scripts/convention-guard-baseline.json (rule3_pending / rule3_exempt /' +
        ' rule19_pending) to activate the gate.',
    );
    process.exit(0);
  }

  const exempt3 = new Set(Object.keys(baseline.rule3_exempt || {}));
  const pending3 = new Set(Object.keys(baseline.rule3_pending || {}));
  const allowed3 = new Set([...exempt3, ...pending3]);
  const pending19 = Object.keys(baseline.rule19_pending || {});

  let failures = 0;

  // ── HARD GATE: rule #3 new violations ──────────────────────────────────
  const new3 = rule3.filter((r) => !allowed3.has(r));
  if (new3.length) {
    failures += new3.length;
    console.error(
      '\n[convention-guard] FAIL rule #3 — new mutating route(s) without audit_logs:',
    );
    new3.forEach((r) =>
      console.error(
        `  ${r}  → await auditServerEvent(...) after the write (CLAUDE.md #3),` +
          ' or add to baseline.rule3_exempt with a reason',
      ),
    );
  }

  // ── Ratchet cleanup notices (non-fatal) ────────────────────────────────
  const fixed3 = [...pending3].filter((r) => !rule3.includes(r));
  if (fixed3.length) {
    console.log(
      '\n[convention-guard] ✅ rule #3 now audited — remove from baseline.rule3_pending:',
    );
    fixed3.forEach((r) => console.log('  ' + r));
  }

  // ── Rule #19 tracker: confirm each pending route gained a transaction ──
  const fixed19 = pending19.filter((r) => !rule19Set.has(r));
  if (fixed19.length) {
    console.log(
      '\n[convention-guard] ✅ rule #19 now uses runTransaction — verify the' +
        ' read-modify-write is wrapped, then remove from baseline.rule19_pending:',
    );
    fixed19.forEach((r) => console.log('  ' + r));
  }

  console.log('');
  if (failures) {
    console.error(`[convention-guard] FAIL: ${failures} new violation(s).`);
    process.exit(1);
  }
  console.log(
    `[convention-guard] PASS — rule #3 gate held (${pending3.size} pending, ` +
      `${exempt3.size} exempt); rule #19 pending: ${pending19.length}.`,
  );
  process.exit(0);
}

module.exports = {
  listRouteFiles,
  routeName,
  scan,
  MUTATE_RE,
  AUDIT_RE,
  TXN_RE,
};

if (require.main === module) main();
