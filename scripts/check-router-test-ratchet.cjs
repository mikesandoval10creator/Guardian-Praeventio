#!/usr/bin/env node
// scripts/check-router-test-ratchet.cjs
//
// Behavioral-coverage ratchet for Express routers. A REAL router under
// src/server/routes (a file that defines HTTP routes) is "verified" when some
// test IMPORTS that exact router file AND uses supertest `request(...)` — a
// behavioral test on the real code. A router with NO such test is UNCOVERED:
// a live endpoint whose behavior is unverified.
//
// Mirrors check-connectivity-ratchet.cjs: a baseline LIST of currently-uncovered
// routers that may only SHRINK. A NEW router without a real-router supertest
// fails the gate (CLAUDE.md already requires 401/200/400 coverage for a new
// route); connecting coverage to a baselined router and not regenerating also
// fails (so the debt can only be paid down). This is the measured "verified
// working (server)" inventory + the gate for the test-honesty dimension.
//
//   node scripts/check-router-test-ratchet.cjs            # check against baseline
//   node scripts/check-router-test-ratchet.cjs --write    # regenerate baseline
//
// Heuristic (no coverage instrumentation): import-of-the-real-router + request()
// is a strong proxy for a behavioral test. It does NOT detect a hollow test
// that imports + requests but asserts nothing — that is a separate concern.
// Report-only when the baseline is absent.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'src');
const ROUTES_DIR = path.join(SRC, 'server', 'routes');
// Router behavioral tests live under src/__tests__ (convention) or co-located
// in src/server — NOT among the thousands of component tests, so scope here.
const TEST_DIRS = [path.join(SRC, '__tests__'), path.join(SRC, 'server')];
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'router-test-ratchet-baseline.json');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(ent.name)) out.push(full);
  }
  return out;
}
const fileKey = (f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All static `from '...'` / `require('...')` specifiers in a source string. */
function importSpecs(content) {
  const re = /from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) out.push(m[1] || m[2]);
  return out;
}

/** Real routers = route files (non-test) that define HTTP routes. */
function listRouters() {
  return walk(ROUTES_DIR)
    .filter((f) => !/\.test\.ts$/.test(f))
    .filter((f) => {
      const c = fs.readFileSync(f, 'utf8');
      return /Router\(\)/.test(c) || /\b(router|app)\.(get|post|put|delete|patch)\s*\(/.test(c);
    });
}

/**
 * Every supertest-using test under TEST_DIRS as `{ file, content }`. The file
 * path is required so `scan` can resolve a test's RELATIVE import specifiers
 * (e.g. a co-located `./loto`) against the test's own directory — without it,
 * co-located router tests were false-negatives (counted as "uncovered").
 */
function listSupertestFiles() {
  const seen = new Set();
  const out = [];
  for (const d of TEST_DIRS) {
    for (const f of walk(d)) {
      if (!/\.test\.(ts|tsx)$/.test(f)) continue;
      if (seen.has(f)) continue;
      seen.add(f);
      const c = fs.readFileSync(f, 'utf8');
      if (/\brequest\s*\(/.test(c)) out.push({ file: f, content: c });
    }
  }
  return out;
}

/** Sorted list of UNCOVERED router keys (no real-router supertest imports it). */
function scan(routers = listRouters(), supertestFiles = listSupertestFiles()) {
  const uncovered = [];
  for (const r of routers) {
    const routerKeyNoExt = fileKey(r).replace(/\.ts$/, '');                 // src/server/routes/x
    const suffix = routerKeyNoExt.replace(/^src\//, '');                     // server/routes/x
    const importRe = new RegExp("['\"][^'\"]*" + esc(suffix) + "(\\.js)?['\"]");
    const verified = supertestFiles.some(({ file, content }) => {
      // (a) path-style import, e.g. `../../server/routes/x` (tests under __tests__).
      if (importRe.test(content)) return true;
      // (b) co-located / relative import, e.g. `./x` next to the router — resolve
      //     each specifier against the test file's directory and compare keys.
      return importSpecs(content).some((spec) => {
        if (!spec.startsWith('.')) return false;
        const resolved = fileKey(path.resolve(path.dirname(file), spec)).replace(/\.(ts|js)$/, '');
        return resolved === routerKeyNoExt;
      });
    });
    if (!verified) uncovered.push(fileKey(r));
  }
  return uncovered.sort();
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[router-test-ratchet] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function writeBaseline(uncovered, total) {
  const doc = {
    _doc:
      'Ratchet baseline for scripts/check-router-test-ratchet.cjs. List of Express ' +
      'routers (src/server/routes) with NO real-router supertest (behavior unverified). ' +
      'May only SHRINK: a NEW uncovered router fails the gate (add a *.router.test.ts ' +
      'that imports the real router + uses request()); covering a baselined router and ' +
      'not regenerating also fails. Verified routers = total - uncovered = the measured ' +
      '"verified working (server)" inventory.',
    total_routers: total,
    verified: total - uncovered.length,
    uncovered_count: uncovered.length,
    uncovered,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
}

function main() {
  const routers = listRouters();
  const live = scan(routers);

  if (process.argv.includes('--write')) {
    writeBaseline(live, routers.length);
    console.log(
      `[router-test-ratchet] baseline written: ${live.length} uncovered / ${routers.length} routers ` +
        `(${routers.length - live.length} verified).`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('[router-test-ratchet] REPORT-ONLY (no baseline yet)\n');
    console.log(`${live.length} uncovered / ${routers.length} routers.`);
    console.log('\nSeed with: node scripts/check-router-test-ratchet.cjs --write');
    process.exit(0);
  }

  const base = new Set(baseline.uncovered || []);
  const liveSet = new Set(live);
  let failures = 0;

  const added = live.filter((f) => !base.has(f));
  if (added.length) {
    failures += added.length;
    console.error('\n[router-test-ratchet] FAIL — new router(s) with no behavioral test:');
    added.forEach((f) => console.error(`  ${f}`));
    console.error(
      '  → add a *.router.test.ts that imports the real router + uses supertest ' +
        'request() (401 / 200 / 400 minimum), or justify + --write.',
    );
  }

  const resolved = [...base].filter((f) => !liveSet.has(f));
  if (resolved.length) {
    failures += resolved.length;
    console.error(
      '\n[router-test-ratchet] FAIL — these routers are now tested; regenerate the ' +
        'baseline (`node scripts/check-router-test-ratchet.cjs --write`):',
    );
    resolved.forEach((f) => console.error(`  ${f}`));
  }

  console.log('');
  if (failures) {
    console.error(`[router-test-ratchet] FAIL: ${failures} issue(s).`);
    process.exit(1);
  }
  console.log(
    `[router-test-ratchet] PASS — ${live.length} uncovered routers held ` +
      `(baseline ${baseline.uncovered_count}; ${routers.length - live.length} verified).`,
  );
  process.exit(0);
}

module.exports = { scan, listRouters, listSupertestFiles, fileKey };

if (require.main === module) main();
