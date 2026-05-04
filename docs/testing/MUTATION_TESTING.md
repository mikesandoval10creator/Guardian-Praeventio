# Mutation Testing (Stryker)

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
