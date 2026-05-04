# Mutation Testing (Stryker)

## Latest baseline (2026-05-04, 19th wave — Run #5 — 14/14 baseline COMPLETE)

**All 14 modules in `stryker.config.json` now have an initial mutation score.** This run closes the baseline coverage from 11 → 14 by adding the final 3: PREXOR thermal/noise calculator and the canonical RULA + REBA ergonomics scorers (the latter two with `excludedMutations: ["ArrayDeclaration"]` honoring McAtamney 1993 / Hignett 2000 tables).

- `src/services/protocols/prexor.ts` — **81.71 %** (82 mutants, 67 killed, 15 survived, 0 no-cov, 15 s) — first run.
- `src/services/ergonomics/reba.ts` — **77.74 %** (310 mutants, 241 killed, 61 survived, 8 no-cov, 1 m 29 s) — first run.
- `src/services/ergonomics/rula.ts` — **94.22 %** (225 mutants, 212 killed, 13 survived, 0 no-cov, 1 m 18 s) — first run; **strongest module in single-run history** (eclipses iper.ts 89.36 % from Run #4).

Run #5 subtotal: 617 mutants, 520 killed → **84.28 %** (total) / 85.39 % (covered). Wall-clock 3 m 2 s on Windows host at concurrency=1.

Cumulative across all 14 baselined modules (Runs #2 + #3 + #4 + #5): **72.37 %** (1759 mutants, 1273 killed) — a **+6.43 pp** uplift vs Run #4's cumulative-11 of 65.94 %. `limiters.ts` (3.05 %) remains the single dominant pull-down; removing it from the average pushes cumulative-14 to ~77.5 %.

Top-3 surviving mutants per module, threshold ratchet recommendation (**no change** — `limiters.ts` at 3.05 % is still the floor; safe upper bound is module-min − 5 = -1.95 %), and the next-wave priorities (CI cron weekly run, limiters spine, boundary `EqualityOperator` cluster across REBA + RULA + PREXOR) are documented in the **Run #5** section of [`MUTATION_BASELINE.md`](./MUTATION_BASELINE.md).

### Previous baseline (Run #4, 18th wave Bucket B)

Extension of baseline coverage from 7 → 11 of the 14 modules in `stryker.config.json`. Baselined two safety wrappers + two protocol calculators for the first time:

- `src/services/safety/ergonomicAssessments.ts` — **88.08 %** (151 mutants, 133 killed, 17 survived, 1 no-cov, 21 s).
- `src/services/safety/iperAssessments.ts` — **88.05 %** (159 mutants, 140 killed, 18 survived, 1 no-cov, 21 s).
- `src/services/protocols/tmert.ts` — **85.07 %** (67 mutants, 57 killed, 10 survived, 0 no-cov, 10 s).
- `src/services/protocols/iper.ts` — **89.36 %** (47 mutants, 42 killed, 5 survived, 0 no-cov, 8 s).

Run #4 subtotal: 424 mutants, 372 killed → **87.74 %** (total) / 88.15 % (covered). Wall-clock 1 m 0 s on Windows host at concurrency=1. Cumulative across all 11 baselined modules at the time: **65.94 %**. Full breakdown in [`MUTATION_BASELINE.md`](./MUTATION_BASELINE.md) "Run #4" section.

### Previous baseline (Run #3, 17th wave Bucket B)

Extension of baseline coverage from 3 → 7 of the 14 modules in `stryker.config.json`. This run baselined four security + business-critical modules for the first time:

- `src/services/billing/webpayAdapter.ts` — **58.26 %** (218 mutants, 127 killed, 69 survived, 22 no-cov, 40 s) — first run.
- `src/server/middleware/limiters.ts` — **3.05 %** (131 mutants, 4 killed, 94 survived, 33 no-cov, 45 s) — first run; largest test-gap uncovered to date.
- `src/services/slm/offlineQueue.ts` — **60.44 %** (91 mutants, 55 killed, 33 survived, 3 no-cov, 58 s) — first run.
- `src/services/slm/reconciliation.ts` — **81.48 %** (54 mutants, 44 killed, 10 survived, 0 no-cov, 14 s) — first run; strongest module on first-pass at the time.

Run #3 subtotal: 494 mutants, 230 killed → **46.56 %** (total) / 52.75 % (covered). Wall-clock 2 m 37 s on Windows host at concurrency=1.

### Previous baseline (Run #2, 16th wave Bucket A)

Re-run after 15th-wave tests on the original 3 modules: verifyAuth 76.19 %, orchestrator 43.59 %, sentryInstrumentation 85.48 %, cumulative-3 67.86 %. Wall-clock 1 m 11 s. Full breakdown in [`MUTATION_BASELINE.md`](./MUTATION_BASELINE.md) "Run #2" section.

### Earlier baseline (Run #1, 14th wave Bucket D)

For historical comparison: verifyAuth 64.29 %, orchestrator 7.69 %, sentryInstrumentation 72.58 %, cumulative-3 46.88 %. Wall-clock 1 m 29 s. Full breakdown in [`MUTATION_BASELINE.md`](./MUTATION_BASELINE.md) "Run metadata" / "Per-module results" sections.

## Consolidation note (2026-05-04, 9th wave)

Praeventio previously maintained **two** Stryker config files:

- `stryker.conf.json` — older R20 ratchet (ergonomics + safety + protocols, with
  `excludedMutations: ["ArrayDeclaration"]` for the canonical RULA/REBA tables).
- `stryker.config.json` — 8th-wave addition (security + business modules with
  fresh JSON reporter wired for CI dashboards).

The 9th wave consolidated both into a single canonical
**`stryker.config.json`** so the repo has one source of truth. The 14
target files now live in one `mutate` list, surgical npm scripts gate the
common per-domain runs, and `stryker.conf.json` was deleted via `git rm`.
No source/test code changed during consolidation; the test suite stays at
2028 pass / 0 fail / 88 skipped.

## What it is

Mutation testing intentionally breaks the production code in small, controlled ways
("mutants") and re-runs the test suite. If a test fails, the mutant is *killed* —
that line is well covered. If every test still passes, the mutant *survived* — the
test suite missed something the line of code does.

In other words: **line/branch coverage tells you the code ran during a test;
mutation score tells you the test would have noticed if the code were wrong.**

## Why we use Stryker

Coverage metrics in Praeventio are already high, but coverage alone misses common
classes of bugs that mutation testing catches:

- Boolean operator flips (`&&` → `||`, `===` → `!==`).
- Off-by-one and boundary mistakes (`<` → `<=`, `>=` → `>`).
- Removed conditionals (`if (x)` → `if (true)`).
- Swallowed return values, blanked function bodies, dropped throws.

Stryker is the de-facto JavaScript/TypeScript runner — it integrates with our
existing Vitest suite without re-architecting tests.

## Targeted modules and rationale

We do **not** run mutation testing across the whole repo. The runtime cost is
prohibitive. Instead, we target a fixed list of high-value files where a missed
bug has outsized blast radius. The list now spans four domains:

| File | Category | Why |
|------|----------|-----|
| `src/server/middleware/verifyAuth.ts` | Security-critical | Auth bypass = catastrophic. Boolean inversions on token validation must be caught. |
| `src/server/middleware/limiters.ts` | Security-critical | Rate-limiter logic protects abuse vectors; off-by-one mutations can silently disable throttling. |
| `src/services/slm/orchestrator.ts` | Offline path | Decision tree for selecting on-device vs. cloud inference. |
| `src/services/slm/offlineQueue.ts` | Offline path | Queue ordering, retry backoff, and idempotency. |
| `src/services/slm/reconciliation.ts` | Offline path | Merge logic when local and cloud state diverge. |
| `src/services/observability/sentryInstrumentation.ts` | Observability boundary | Filtering rules and PII scrubbing — silent regressions leak data. |
| `src/services/billing/webpayAdapter.ts` | Business-critical | Payment state transitions; surviving mutants here cost money. |
| `src/services/ergonomics/rula.ts` | Ergonomics standard | RULA score (McAtamney 1993). Boundary mutations on the canonical tables flip risk levels. |
| `src/services/ergonomics/reba.ts` | Ergonomics standard | REBA score (Hignett 2000). Trunk extension boundary checks are mutation hotspots — see R20 baseline. |
| `src/services/protocols/iper.ts` | Compliance | IPER probability × consequence matrix. Off-by-one mutations re-classify hazards. |
| `src/services/protocols/tmert.ts` | Compliance | TMERT scoring branches must keep their boundary semantics. |
| `src/services/protocols/prexor.ts` | Compliance | PREXOR thermal-stress thresholds; mutated boundaries silently miss heat-illness conditions. |
| `src/services/safety/ergonomicAssessments.ts` | Safety wrapper | Composes ergonomics scoring into assessments — preserves correctness across protocol versions. |
| `src/services/safety/iperAssessments.ts` | Safety wrapper | Composes IPER scoring into assessments. |

## How to run

Stryker is already installed (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`,
both `^9.6.1`).

```bash
npm run test:mutation              # full target list (~30–60 min, 14 files)
npm run test:mutation:auth         # only verifyAuth.ts (~2–4 min)
npm run test:mutation:slm          # the SLM trio (~6–10 min)
npm run test:mutation:ergonomics   # rula.ts + reba.ts (~10–20 min)
npm run test:mutation:protocols    # tmert + iper + prexor (~5–10 min)
npm run test:mutation:safety       # ergonomicAssessments + iperAssessments (~5–10 min)
```

The legacy `npm run mutation` alias is preserved for back-compat (now
explicitly pinned to `stryker.config.json`).

## Reading the report

After each run Stryker writes:

- `reports/mutation/index.html` — interactive report. Open in a browser. Each file
  is colored by mutation score (green/yellow/red); click a file to see each
  mutant, its location, and whether it was killed or survived.
- `reports/mutation/report.json` — machine-readable. Used by CI dashboards.

Survived mutants are the actionable signal. For each one, write a test that would
have killed it, then re-run.

## Threshold policy

Configured in `stryker.config.json`:

```jsonc
"thresholds": { "high": 80, "low": 60, "break": 50 }
```

- `high: 80` — score at or above is reported as healthy.
- `low: 60` — between low and high is a warning.
- `break: 50` — under this, Stryker exits non-zero. CI will fail.

These are intentionally conservative for the consolidated config. The R20
ergonomics ratchet had previously achieved `break: 70` for ergonomics-only
runs; consolidation does **not** regress R20 work — it simply applies a
floor that also fits the security/business modules still warming up. A
follow-up R21 should re-introduce per-file thresholds for ergonomics
files once Stryker schema supports it (9.6.1 does not).

## Mutator configuration

The consolidated config sets `mutator.excludedMutations: ["ArrayDeclaration"]`
GLOBALLY. Rationale: RULA/REBA canonical tables (TABLE_A, TABLE_B, TABLE_C
in `rula.ts` and `reba.ts`) come from peer-reviewed papers
(McAtamney 1993; Hignett 2000) — table values are canonical and the
parametric per-cell tests already assert every cell via the
inputs→postureA/B/finalScore pipeline. Mutating those array literals
produces noise, not actionable bugs. Stryker schema 9.6.1 does not
support file-level `excludedMutations`; the global setting is safe
because security/business modules don't have canonical-table tests
where ArrayDeclaration mutations would mislead.

## Performance notes

- Wall-clock estimate on the 14 targeted files with `concurrency: 4`:
  **~30–60 minutes**, dominated by the SLM trio, ergonomics tables, and
  `webpayAdapter.ts`.
- Do **not** run mutation testing on every PR. The intended cadence is **weekly**
  (or pre-release), executed by a scheduled CI workflow.
- Local debugging tip: use the surgical scripts (`test:mutation:auth`,
  `test:mutation:ergonomics`, etc.) to iterate on a single domain in
  ~5–20 minutes.

## CI integration

CI integration is **not wired in this commit**. Reasoning: a full mutation
run takes 30+ minutes and would block PR throughput if attached to the
standard CI matrix.

A follow-up bucket will add `.github/workflows/mutation.yml` with a `cron`
schedule (proposed: weekly on Sunday 02:00 UTC) and on-demand `workflow_dispatch`
trigger. Until that lands, mutation runs are manual.

## Local-run prerequisites

1. `npm install` — devDependencies already declared, this just hydrates them.
2. `npm test` must pass (Stryker reuses the live Vitest suite — a broken green
   build means broken mutation results).
3. Free disk space for `.stryker-tmp/` — Stryker copies the project tree per
   mutant batch. Allow ~500 MB working room.
4. Windows users: Vitest workers may run hot. If you see EBUSY/EPERM on
   `.stryker-tmp/` cleanup, close any IDE indexers watching that directory.
