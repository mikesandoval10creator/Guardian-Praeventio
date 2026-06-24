#!/usr/bin/env node
// scripts/check-render-ratchet.cjs
//
// Render ratchet (anti-phantom-mount, CLAUDE.md #23). A component that is
// "mounted" MUST actually be RENDERED — its `<ComponentName` JSX tag must
// appear in the JSX of at least one non-test src/ file. The connectivity
// ratchet (#21) only checks textual symbol presence (an import, a comment,
// even a string counts), so it does NOT catch a "phantom mount": a PR that
// imports a component but whose JSX wiring was later clobbered by a
// conflicting merge. Canonical examples: SafetyMetricsDashboard / SpiDashboard
// / OperationalPressureGauge (PRs #1034/#1038/#1039 — all "mounted" in title
// but absent as <Tag in Dashboard.tsx after merge).
//
// Detection heuristic: for every candidate file (src/components/, src/pages/)
// that exports ≥1 PascalCase symbol, check whether `<Symbol` (JSX open tag)
// appears in ANY other non-test src/ file. A candidate is "phantom" when its
// exported symbols are referenced as identifiers (satisfying the connectivity
// ratchet) but NONE of them appears as a JSX open tag in any other file.
//
// Baseline semantics: the SET of phantom files may only SHRINK — a NEW
// phantom component (added without a JSX render site) fails the gate.
// Resolving a phantom (adding the <Tag render) without regenerating also
// fails (forcing the count down).
//
//   node scripts/check-render-ratchet.cjs            # check against baseline
//   node scripts/check-render-ratchet.cjs --write    # regenerate baseline
//
// Report-only when the baseline file is absent (so it can be seeded first).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'render-ratchet-baseline.json');

// Only components and pages are expected to be JSX-rendered.
// Hooks are explicitly excluded: they are never used as <Tag, only called.
const CANDIDATE_PREFIXES = ['src/components/', 'src/pages/'];

/** Recurse src/, skipping test files and __tests__ dirs. */
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

/**
 * Exported PascalCase component symbols. Hooks (use*) and UPPER_SNAKE consts
 * are excluded — hooks are never JSX-rendered, consts are not components.
 */
function componentExportsOf(src) {
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
  // PascalCase component: starts uppercase AND contains a lowercase letter
  // (so UPPER_SNAKE consts don't qualify), AND does NOT start with "use"
  // (hooks never appear as <Tag).
  return [...names].filter(
    (n) => /^[A-Z]/.test(n) && /[a-z]/.test(n) && !/^use[A-Z]/.test(n),
  );
}

/**
 * Sorted list of "phantom" candidate keys. A candidate is phantom when
 * it has >=1 PascalCase export but NONE of them appears as `<Symbol` (JSX
 * open tag or self-closing) in any OTHER non-test src/ file.
 */
function scan(files = listSrcFiles()) {
  const contents = files.map((f) => [fileKey(f), fs.readFileSync(f, 'utf8')]);

  // Build: symbol -> set of files that contain `<Symbol` (JSX open-tag usage).
  const jsxUsage = new Map(); // symbol -> Set<fileKey>
  for (const [key, src] of contents) {
    // Match `<Foo`, `<Foo.`, `<Foo<` — broad but still JSX-specific
    const re = /<([A-Z][A-Za-z0-9]*)/g;
    let mm;
    while ((mm = re.exec(src))) {
      const sym = mm[1];
      let set = jsxUsage.get(sym);
      if (!set) {
        set = new Set();
        jsxUsage.set(sym, set);
      }
      set.add(key);
    }
  }

  const phantoms = [];
  for (const [key, src] of contents) {
    if (!isCandidate(key)) continue;
    const syms = componentExportsOf(src);
    if (syms.length === 0) continue; // no component exports — skip

    // A candidate is phantom when NONE of its exported symbols appears as
    // a JSX tag in any OTHER file (the file itself can self-render, e.g.
    // Storybook-style previews, but the ratchet requires external render sites).
    const rendered = syms.some((s) => {
      const set = jsxUsage.get(s);
      return set && [...set].some((f) => f !== key);
    });
    if (!rendered) phantoms.push(key);
  }
  return phantoms.sort();
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[render-ratchet] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function writeBaseline(phantoms) {
  const doc = {
    _doc:
      'Ratchet baseline for scripts/check-render-ratchet.cjs (CLAUDE.md #23). ' +
      'List of component/page files whose exported PascalCase symbols are never ' +
      'rendered as a JSX <Tag in any other non-test src/ file — i.e. imported ' +
      '(satisfying the connectivity ratchet) but not actually rendered (phantom mount). ' +
      'The list may only SHRINK: a NEW phantom component fails the gate. When you ' +
      'add the <Tag render site, regenerate with ' +
      '`node scripts/check-render-ratchet.cjs --write` so the debt can never be ' +
      're-grown silently.',
    count: phantoms.length,
    phantoms,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
}

function main() {
  const live = scan();

  if (process.argv.includes('--write')) {
    writeBaseline(live);
    console.log(`[render-ratchet] baseline written: ${live.length} phantom component(s).`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('[render-ratchet] REPORT-ONLY (no baseline yet)\n');
    console.log(`${live.length} phantom component(s) (imported but not JSX-rendered).`);
    console.log('\nSeed with: node scripts/check-render-ratchet.cjs --write');
    process.exit(0);
  }

  const base = new Set(baseline.phantoms || []);
  const liveSet = new Set(live);
  let failures = 0;

  // -- HARD GATE: no NEW phantom component (imported but not rendered). ------
  const added = live.filter((f) => !base.has(f));
  if (added.length) {
    failures += added.length;
    console.error(
      '\n[render-ratchet] FAIL — new phantom component(s) (imported but not JSX-rendered):',
    );
    added.forEach((f) => console.error(`  ${f}`));
    console.error(
      '  => add a <ComponentName .../> render site in the appropriate page/layout, ' +
        'or justify + `node scripts/check-render-ratchet.cjs --write`.',
    );
  }

  // -- No stale entries: a resolved phantom must update the baseline. --------
  const resolved = [...base].filter((f) => !liveSet.has(f));
  if (resolved.length) {
    failures += resolved.length;
    console.error(
      '\n[render-ratchet] FAIL — these phantoms are now rendered; regenerate the ' +
        'baseline (`node scripts/check-render-ratchet.cjs --write`):',
    );
    resolved.forEach((f) => console.error(`  ${f}`));
  }

  console.log('');
  if (failures) {
    console.error(`[render-ratchet] FAIL: ${failures} issue(s).`);
    process.exit(1);
  }
  console.log(
    `[render-ratchet] PASS — ${live.length} phantom component(s) held (baseline ${baseline.count}).`,
  );
  process.exit(0);
}

module.exports = { scan, listSrcFiles, fileKey, isCandidate, componentExportsOf };

if (require.main === module) main();
