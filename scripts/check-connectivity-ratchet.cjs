#!/usr/bin/env node
// scripts/check-connectivity-ratchet.cjs
//
// Connectivity ratchet: caps the number of ORPHAN UI features (components /
// hooks / pages whose exported PascalCase or `use*` symbol is never referenced
// by any non-test app file under src/ — i.e. built but never mounted/routed).
//
// Mirrors check-any-ratchet.cjs: a baseline LIST of the currently-orphan files
// that may only SHRINK. A NEW orphan (a file you added/exported but did not
// wire into any page) fails the gate — enforcing the project rule that
// everything built must be connected and real. When you CONNECT a baselined
// orphan, the gate tells you to regenerate the baseline so the debt can only
// be paid down, never re-grown.
//
//   node scripts/check-connectivity-ratchet.cjs            # check against baseline
//   node scripts/check-connectivity-ratchet.cjs --write    # regenerate baseline
//
// Heuristic (no TS resolver): a candidate is orphan when NONE of its exported
// component/hook symbols appears as an identifier in any OTHER non-test src
// file. This intentionally tolerates a stable set of false positives (lazy
// route strings, barrels, util modules) by keeping them in the baseline — the
// gate only cares that the set does not GROW.
//
// Report-only when the baseline file is absent (so it can be seeded first).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'connectivity-ratchet-baseline.json');
const CANDIDATE_PREFIXES = ['src/components/', 'src/hooks/', 'src/pages/'];
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Recurse src/, skipping test files + __tests__ dirs. */
function listSrcFiles(dir = SRC_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      listSrcFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(ent.name)) continue;
    out.push(full);
  }
  return out;
}

/** repo-relative posix path, e.g. `src/components/foo/Bar.tsx`. */
function fileKey(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

function isCandidate(key) {
  return CANDIDATE_PREFIXES.some((p) => key.startsWith(p));
}

/** Exported component/hook symbol names (PascalCase or use*). */
function exportsOf(src) {
  const names = new Set();
  let m;
  const re1 = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;
  while ((m = re1.exec(src))) names.add(m[1]);
  const re2 = /export\s+default\s+function\s+([A-Za-z0-9_]+)/g;
  while ((m = re2.exec(src))) names.add(m[1]);
  const re3 = /export\s*\{([^}]+)\}/g;
  while ((m = re3.exec(src))) {
    m[1].split(',').forEach((s) => {
      const n = s.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    });
  }
  // Feature export = PascalCase component (starts uppercase AND has a lowercase
  // letter, so MOCStatusPanel/ROICalculatorWidget qualify) OR a use* hook.
  // Excludes UPPER_SNAKE constants (SCHEMATIC_DIMS, DOMAIN_PROMPTS) so a util
  // module whose only "capitalized" export is a const is NOT treated as a
  // mountable feature.
  return [...names].filter((n) => (/^[A-Z]/.test(n) && /[a-z]/.test(n)) || /^use[A-Z]/.test(n));
}

/**
 * Return the sorted list of orphan candidate keys. A candidate (component/hook/
 * page with ≥1 named component/hook export) is orphan when none of its exported
 * symbols appears as an identifier in any OTHER non-test src file. One pass over
 * all files builds symbol→{files}, so this stays fast enough for pre-commit/CI.
 */
function scan(files = listSrcFiles()) {
  const contents = files.map((f) => [fileKey(f), fs.readFileSync(f, 'utf8')]);
  const candSyms = new Map(); // key -> [symbols]
  const allCandSyms = new Set();
  for (const [key, src] of contents) {
    if (!isCandidate(key)) continue;
    const syms = exportsOf(src);
    if (syms.length === 0) continue; // anonymous / default-only — cannot assess
    candSyms.set(key, syms);
    syms.forEach((s) => allCandSyms.add(s));
  }
  // symbol -> set of files that contain it (single pass over every file)
  const symFiles = new Map();
  for (const [key, src] of contents) {
    const ids = src.match(IDENT_RE);
    if (!ids) continue;
    const seen = new Set(ids);
    for (const id of seen) {
      if (!allCandSyms.has(id)) continue;
      let set = symFiles.get(id);
      if (!set) {
        set = new Set();
        symFiles.set(id, set);
      }
      set.add(key);
    }
  }
  const orphans = [];
  for (const [key, syms] of candSyms) {
    const referenced = syms.some((s) => {
      const set = symFiles.get(s);
      return set && [...set].some((f) => f !== key);
    });
    if (!referenced) orphans.push(key);
  }
  return orphans.sort();
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[connectivity-ratchet] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function writeBaseline(orphans) {
  const doc = {
    _doc:
      'Ratchet baseline for scripts/check-connectivity-ratchet.cjs. List of ' +
      'currently-orphan UI features (component/hook/page exports not referenced ' +
      'by any non-test src file = built but not mounted). The list may only ' +
      'SHRINK: a NEW orphan fails the gate (wire it into a page, or justify + ' +
      'regenerate with `node scripts/check-connectivity-ratchet.cjs --write`). ' +
      'When you connect a baselined orphan, regenerate so it can never be ' +
      're-orphaned silently. Includes a stable set of heuristic false positives ' +
      '(lazy routes / barrels / util modules) — acceptable because the gate ' +
      'only blocks GROWTH.',
    count: orphans.length,
    orphans,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
}

function main() {
  const live = scan();

  if (process.argv.includes('--write')) {
    writeBaseline(live);
    console.log(`[connectivity-ratchet] baseline written: ${live.length} orphan features.`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('[connectivity-ratchet] REPORT-ONLY (no baseline yet)\n');
    console.log(`${live.length} orphan features (built but not mounted).`);
    console.log('\nSeed with: node scripts/check-connectivity-ratchet.cjs --write');
    process.exit(0);
  }

  const base = new Set(baseline.orphans || []);
  const liveSet = new Set(live);
  let failures = 0;

  // ── HARD GATE: no NEW orphan (built-but-unmounted feature) may appear. ──
  const added = live.filter((f) => !base.has(f));
  if (added.length) {
    failures += added.length;
    console.error(
      '\n[connectivity-ratchet] FAIL — new orphan feature(s) (built but not mounted):',
    );
    added.forEach((f) => console.error(`  ${f}`));
    console.error(
      '  → mount it in a page/route (everything built must be connected), or ' +
        'justify + `node scripts/check-connectivity-ratchet.cjs --write`.',
    );
  }

  // ── No stale entries: a connected file must update the baseline. ────────
  const resolved = [...base].filter((f) => !liveSet.has(f));
  if (resolved.length) {
    failures += resolved.length;
    console.error(
      '\n[connectivity-ratchet] FAIL — these orphans are now connected; ' +
        'regenerate the baseline (`node scripts/check-connectivity-ratchet.cjs --write`):',
    );
    resolved.forEach((f) => console.error(`  ${f}`));
  }

  console.log('');
  if (failures) {
    console.error(`[connectivity-ratchet] FAIL: ${failures} issue(s).`);
    process.exit(1);
  }
  console.log(`[connectivity-ratchet] PASS — ${live.length} orphan features held (baseline ${baseline.count}).`);
  process.exit(0);
}

module.exports = { scan, listSrcFiles, fileKey, exportsOf, isCandidate };

if (require.main === module) main();
