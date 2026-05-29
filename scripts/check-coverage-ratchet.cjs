#!/usr/bin/env node
/**
 * Coverage ratchet checker (post-hoc) — Plan v3 Fase 1.2 (2026-05-29).
 *
 * Companion to `check-mutation-thresholds.cjs`. Mutation testing guards the
 * QUALITY of tests on the pure calc engines; this guards the BREADTH of
 * line/branch coverage across the whole app, with the same monotonic-ratchet
 * philosophy: a number can be RAISED but never lowered without an explicit,
 * logged decision. The user's directive (2026-05-29) is "tests of what the
 * app already has → 90%", measured honestly.
 *
 * This script:
 *  1. Parses `coverage/coverage-summary.json` (vitest v8 json-summary output).
 *  2. Compares the global totals + per-critical-file pct against the floors
 *     in `scripts/coverage-floors.json`.
 *  3. Exits 0 (pass) / 1 (fail).
 *
 * Until the baseline is measured and `coverage-floors.json` is seeded, this
 * runs in REPORT-ONLY mode (prints the current numbers, exits 0). That keeps
 * the gate from blocking CI before we even know the starting point.
 *
 * Seeding: run `npm run test:coverage`, then copy the measured pcts into
 * `coverage-floors.json` (global slightly below measured to absorb float
 * noise; per-file at the measured value for the critical paths we care
 * about). Each subsequent green run can raise floors; never lower them
 * silently — log the why if you ever do.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUMMARY_PATH = path.join(
  process.cwd(),
  'coverage',
  'coverage-summary.json',
);
const FLOORS_PATH = path.join(process.cwd(), 'scripts', 'coverage-floors.json');

// Float noise tolerance: v8 pct can wobble ±0.05 between runs (line counting
// of template literals / decorators). Don't fail on sub-epsilon drift.
const EPSILON = 0.1;

function loadJson(p, label) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[coverage-ratchet] Could not parse ${label} at ${p}: ${err.message}`);
    process.exit(2);
  }
  return null;
}

function normalizePath(p) {
  // coverage-summary keys are absolute; reduce to repo-relative POSIX so the
  // floors file is portable across machines/CI.
  const rel = path.relative(process.cwd(), p).replace(/\\/g, '/');
  return rel;
}

function pct(metricObj) {
  return typeof metricObj?.pct === 'number' ? metricObj.pct : null;
}

function main() {
  const summary = loadJson(SUMMARY_PATH, 'coverage summary');
  if (!summary) {
    console.error(
      `[coverage-ratchet] No coverage at ${SUMMARY_PATH}. Run \`npm run test:coverage\` first.`,
    );
    process.exit(2);
  }

  const total = summary.total || {};
  const globalNow = {
    lines: pct(total.lines),
    statements: pct(total.statements),
    functions: pct(total.functions),
    branches: pct(total.branches),
  };

  console.log('Coverage (global):');
  for (const [k, v] of Object.entries(globalNow)) {
    console.log(`  ${k.padEnd(11)} ${v == null ? 'n/a' : v.toFixed(2) + '%'}`);
  }

  const floors = loadJson(FLOORS_PATH, 'coverage floors');
  if (!floors) {
    console.log('');
    console.log(
      '[coverage-ratchet] REPORT-ONLY: scripts/coverage-floors.json not found.',
    );
    console.log('  Seed it from the numbers above to activate the gate.');
    process.exit(0);
  }

  let failures = 0;

  // Global floors
  const gFloor = floors.global || {};
  for (const [metric, floorVal] of Object.entries(gFloor)) {
    const now = globalNow[metric];
    if (now == null) continue;
    if (now + EPSILON < floorVal) {
      console.error(
        `  FAIL global ${metric}: ${now.toFixed(2)}% < floor ${floorVal}%`,
      );
      failures++;
    }
  }

  // Per-critical-file floors (line pct)
  const fileFloors = floors.files || {};
  if (Object.keys(fileFloors).length > 0) {
    const byRel = {};
    for (const [abs, data] of Object.entries(summary)) {
      if (abs === 'total') continue;
      byRel[normalizePath(abs)] = data;
    }
    for (const [rel, floorVal] of Object.entries(fileFloors)) {
      const data = byRel[rel];
      if (!data) {
        console.error(`  FAIL ${rel}: not present in coverage report (deleted/renamed?)`);
        failures++;
        continue;
      }
      const now = pct(data.lines);
      if (now == null) continue;
      if (now + EPSILON < floorVal) {
        console.error(`  FAIL ${rel} lines: ${now.toFixed(2)}% < floor ${floorVal}%`);
        failures++;
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`[coverage-ratchet] FAIL: ${failures} floor(s) violated.`);
    process.exit(1);
  }
  console.log('[coverage-ratchet] PASS: all floors held.');
  process.exit(0);
}

main();
