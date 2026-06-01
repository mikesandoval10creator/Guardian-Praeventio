#!/usr/bin/env node
// scripts/check-any-ratchet.cjs
//
// Type-safety ratchet for the `as any` escape hatch in PRODUCTION code under
// src/ (tests excluded — `as any` in mocks is acceptable). Mirrors the
// convention-guard / i18n-parity ratchets: a per-file baseline of the current
// `as any` counts that may only SHRINK. A file whose count INCREASES (or a new
// file that introduces `as any` without being baselined) fails the gate — so
// the 246-occurrence debt can only be paid down, never grown.
//
//   node scripts/check-any-ratchet.cjs            # check against baseline
//   node scripts/check-any-ratchet.cjs --write    # regenerate the baseline
//                                                  # (run after removing casts)
//
// Report-only when the baseline file is absent (so it can be seeded first).
//
// Scope note: we count the literal `as any` cast — the highest-signal,
// most-common explicit-any form — not every `: any` annotation. eslint's
// no-explicit-any remains the broad lint; this ratchet specifically caps the
// cast that silently erases a known type.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'any-ratchet-baseline.json');

const AS_ANY_RE = /\bas any\b/g;

/** Recurse src/, skipping test files + __tests__ dirs. */
function listSrcFiles(dir = SRC_DIR) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      out.push(...listSrcFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(ent.name)) continue;
    out.push(full);
  }
  return out;
}

/** repo-relative posix path, e.g. `src/server/routes/wisdomCapsule.ts`. */
function fileKey(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

/** `{ 'src/...': count }` for every file with ≥1 `as any`. */
function scan(files = listSrcFiles()) {
  const counts = {};
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    const m = c.match(AS_ANY_RE);
    if (m && m.length > 0) counts[fileKey(f)] = m.length;
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[any-ratchet] Could not parse baseline: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function writeBaseline(counts) {
  const sorted = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  const doc = {
    _doc:
      'Ratchet baseline for scripts/check-any-ratchet.cjs. Per-file `as any` ' +
      'counts (production src, tests excluded). A file may only SHRINK: remove ' +
      'a cast -> regenerate with `node scripts/check-any-ratchet.cjs --write`. ' +
      'A file whose count GROWS (or a new file with `as any` absent here) fails ' +
      'the gate.',
    total: total(sorted),
    counts: sorted,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
}

function main() {
  const live = scan();

  if (process.argv.includes('--write')) {
    writeBaseline(live);
    console.log(
      `[any-ratchet] baseline written: ${total(live)} \`as any\` across ` +
        `${Object.keys(live).length} files.`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('[any-ratchet] REPORT-ONLY (no baseline yet)\n');
    console.log(
      `${total(live)} \`as any\` across ${Object.keys(live).length} files.`,
    );
    console.log('\nSeed with: node scripts/check-any-ratchet.cjs --write');
    process.exit(0);
  }

  const base = baseline.counts || {};
  let failures = 0;

  // ── HARD GATE: no file may exceed its baselined count. ──────────────────
  const increases = [];
  for (const [f, n] of Object.entries(live)) {
    const allowed = base[f] ?? 0;
    if (n > allowed) increases.push(`${f}: ${allowed} → ${n}`);
  }
  if (increases.length) {
    failures += increases.length;
    console.error(
      '\n[any-ratchet] FAIL — `as any` increased (type-safety regression):',
    );
    increases.forEach((s) => console.error(`  ${s}`));
    console.error(
      '  → give the value a real type instead of `as any`, or justify it.',
    );
  }

  // ── No stale entries: a file that improved must update the baseline. ────
  const stale = [];
  for (const [f, n] of Object.entries(base)) {
    const liveN = live[f] ?? 0;
    if (liveN < n) stale.push(`${f}: ${n} → ${liveN}`);
  }
  if (stale.length) {
    failures += stale.length;
    console.error(
      '\n[any-ratchet] FAIL — these files improved; regenerate the baseline ' +
        '(`node scripts/check-any-ratchet.cjs --write`):',
    );
    stale.forEach((s) => console.error(`  ${s}`));
  }

  console.log('');
  if (failures) {
    console.error(`[any-ratchet] FAIL: ${failures} issue(s).`);
    process.exit(1);
  }
  console.log(
    `[any-ratchet] PASS — ${total(live)} \`as any\` held ` +
      `(baseline ${baseline.total}).`,
  );
  process.exit(0);
}

module.exports = { scan, listSrcFiles, fileKey, total, AS_ANY_RE };

if (require.main === module) main();
