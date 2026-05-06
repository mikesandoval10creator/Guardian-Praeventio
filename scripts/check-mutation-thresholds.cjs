#!/usr/bin/env node
/**
 * Per-file mutation threshold checker (post-hoc).
 *
 * Sprint 34: Stryker 9.6.1 schema does not support per-file thresholds (the
 * `mutate` array accepts strings only; `thresholds` is global). We need
 * per-file ratcheting because:
 *
 *  - Files at ≥80% mutation coverage should not regress (ratchet rule).
 *  - Critical security/billing/emergency files target 75%+.
 *  - Stub/placeholder files (e.g. vertexTrainer) are excluded — would
 *    inflate "low-score" noise and the code path is not yet exercised.
 *
 * This script:
 *  1. Parses `reports/mutation/report.json` (Stryker JSON reporter output).
 *  2. Walks each file, computes its mutation score.
 *  3. Compares against the rules below.
 *  4. Exits 0 (pass) / 1 (fail) accordingly. Logs each file's status.
 *
 * Sprint 34 invocation: ran with `|| true` in CI (informational). Sprint 35:
 * drop the `|| true` to make this a hard gate.
 *
 * The first CI run will populate the RATCHET map by snapshotting whichever
 * files report ≥80%. Until then, the script reports but does not fail on
 * ratchet drops (only on critical-file floors).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_PATH = path.join(
  process.cwd(),
  'reports',
  'mutation',
  'report.json',
);

// ────────────────────────────────────────────────────────────────────
// Thresholds policy (Sprint 34 baseline)
// ────────────────────────────────────────────────────────────────────

// Files with mutation score ≥80% on first run get baselined here. Any
// regression below the ratchet floor fails this script in Sprint 35+.
//
// Sprint 38 I4 — initial ratchet seed. Source: Run #5 cumulative-14 table
// in docs/testing/MUTATION_BASELINE.md (14-module baseline 2026-05-04, the
// last full multi-module run with documented per-file scores).
//
// Sprint 37 CI #74 confirmed Stryker passes green on Linux runner for the
// first time, but the per-file CI numbers are not yet machine-extractable
// from this host (no `gh` CLI). The seed below uses the documented Run #5
// scores minus a ~5pp safety margin (the explicit "do not increase break
// above lowest module's score − 5" rule the baseline doc states). Each
// entry locks a floor; future PRs can RAISE but never lower a value.
//
// Files NOT in RATCHET intentionally: orchestrator (43.59%), webpayAdapter
// (58.26% — covered by CRITICAL_FLOORS), offlineQueue (60.44%), limiters
// (3.05% — covered by CRITICAL_FLOORS ramp), verifyAuth (76.19% — covered
// by CRITICAL_FLOORS at 75% which is the higher floor). Let those grow
// organically; promote into RATCHET once a CI run shows them ≥80%.
//
// Sprint 39+: after 2 consecutive green CI mutation runs, re-seed from
// machine-extracted report.json and bump entries upward where stable.
const RATCHET = {
  'src/services/ergonomics/rula.ts': 89,
  'src/services/protocols/iper.ts': 80,
  'src/services/safety/ergonomicAssessments.ts': 80,
  'src/services/safety/iperAssessments.ts': 80,
  'src/services/protocols/tmert.ts': 80,
  'src/services/observability/sentryInstrumentation.ts': 80,
  'src/services/protocols/prexor.ts': 76,
  'src/services/slm/reconciliation.ts': 76,
  'src/services/ergonomics/reba.ts': 70,
};

// Sprint 38 I4 onward: append `{ sprint, file, from, to, source }` whenever
// a RATCHET entry is bumped. Lets us track the ratchet's monotonic climb.
const RATCHET_BUMP_LOG = [
  // Example: { sprint: 39, file: 'src/services/slm/orchestrator.ts',
  //            from: null, to: 70, source: 'CI #82 mutation run' },
];

// Critical files: must hit a hard floor regardless of ratchet.
// Mapped from audit P1: auth, billing webhooks, emergency, compliance.
const CRITICAL_FLOORS = {
  'src/server/middleware/verifyAuth.ts': 75,
  'src/server/middleware/limiters.ts': 60, // freshly re-enabled; ramp to 75 in Sprint 36
  'src/services/billing/webpayAdapter.ts': 75,
  'src/services/safety/ergonomicAssessments.ts': 75,
  'src/services/safety/iperAssessments.ts': 75,
};

// Files with stubs/placeholders — excluded from any per-file gate.
const EXCLUDED = new Set([
  // 'src/services/vertexTrainer.ts',
]);

// ────────────────────────────────────────────────────────────────────

function loadReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(
      `[mutation-thresholds] Report not found at ${REPORT_PATH}. ` +
        'Did Stryker actually run?',
    );
    process.exit(2);
  }
  const raw = fs.readFileSync(REPORT_PATH, 'utf8');
  return JSON.parse(raw);
}

function fileScore(fileResult) {
  // Stryker JSON shape: { mutants: [{ status }, ...] }
  // status ∈ {Killed, Survived, NoCoverage, Timeout, RuntimeError, CompileError, Ignored}
  const mutants = fileResult.mutants || [];
  let killed = 0;
  let survived = 0;
  let noCov = 0;
  let timeout = 0;
  for (const m of mutants) {
    switch (m.status) {
      case 'Killed':
        killed++;
        break;
      case 'Survived':
        survived++;
        break;
      case 'NoCoverage':
        noCov++;
        break;
      case 'Timeout':
        timeout++;
        break;
      default:
        // Ignored / RuntimeError / CompileError do not contribute to score.
        break;
    }
  }
  const denom = killed + survived + noCov + timeout;
  if (denom === 0) return null;
  return (killed / denom) * 100;
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function main() {
  const report = loadReport();
  const files = report.files || {};

  let failures = 0;
  let warnings = 0;
  const lines = [];

  for (const [filePath, fileResult] of Object.entries(files)) {
    const norm = normalizePath(filePath);
    if (EXCLUDED.has(norm)) {
      lines.push(`  EXCLUDED  ${norm}`);
      continue;
    }
    const score = fileScore(fileResult);
    if (score === null) {
      lines.push(`  NO_DATA   ${norm}`);
      continue;
    }

    const tag = score.toFixed(2).padStart(6);
    let status = 'OK       ';
    let detail = '';

    const critical = CRITICAL_FLOORS[norm];
    const ratchet = RATCHET[norm];

    if (typeof critical === 'number' && score < critical) {
      status = 'FAIL CRIT';
      detail = ` (critical floor ${critical}%)`;
      failures++;
    } else if (typeof ratchet === 'number' && score < ratchet) {
      status = 'FAIL RATC';
      detail = ` (ratchet ${ratchet}%)`;
      failures++;
    } else if (score >= 80 && typeof ratchet !== 'number') {
      status = 'WARN BASE';
      detail = ' (eligible for ratchet — add to RATCHET map)';
      warnings++;
    }

    lines.push(`  ${status} ${tag}%  ${norm}${detail}`);
  }

  console.log('Per-file mutation thresholds (Sprint 34 baseline):');
  console.log(lines.sort().join('\n'));
  console.log('');
  console.log(`Failures: ${failures}, ratchet candidates (warn): ${warnings}`);

  if (failures > 0) {
    console.error(
      '[mutation-thresholds] FAIL: at least one critical floor or ratchet was violated.',
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
