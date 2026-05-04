# Mutation Testing (Stryker)

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
bug has outsized blast radius:

| File | Category | Why |
|------|----------|-----|
| `src/server/middleware/verifyAuth.ts` | Security-critical | Auth bypass = catastrophic. Boolean inversions on token validation must be caught. |
| `src/server/middleware/limiters.ts` | Security-critical | Rate-limiter logic protects abuse vectors; off-by-one mutations can silently disable throttling. |
| `src/services/slm/orchestrator.ts` | Offline path | Decision tree for selecting on-device vs. cloud inference. |
| `src/services/slm/offlineQueue.ts` | Offline path | Queue ordering, retry backoff, and idempotency. |
| `src/services/slm/reconciliation.ts` | Offline path | Merge logic when local and cloud state diverge. |
| `src/services/observability/sentryInstrumentation.ts` | Observability boundary | Filtering rules and PII scrubbing — silent regressions leak data. |
| `src/services/billing/webpayAdapter.ts` | Business-critical | Payment state transitions; surviving mutants here cost money. |

## How to run

Stryker is already installed (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`,
both `^9.6.1`).

```bash
npm run test:mutation        # full target list (~10–25 min)
npm run test:mutation:auth   # only verifyAuth.ts (~2–4 min)
npm run test:mutation:slm    # only the SLM trio (~6–10 min)
```

The legacy `npm run mutation` alias is preserved for back-compat.

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

These are intentionally conservative for the first iteration. Plan: raise quarterly
once the target modules stabilize above 75 %.

## Performance notes

- Wall-clock estimate on the seven targeted files with `concurrency: 4`:
  **~10–25 minutes**, dominated by `verifyAuth.ts` and the SLM trio.
- Do **not** run mutation testing on every PR. The intended cadence is **weekly**
  (or pre-release), executed by a scheduled CI workflow.
- Local debugging tip: use `test:mutation:auth` to iterate on a single file in
  ~3 minutes.

## CI integration

CI integration is **not wired in this commit**. Reasoning: a mutation run takes
20+ minutes and would block PR throughput if attached to the standard CI matrix.

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
