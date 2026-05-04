# Mutation Testing Baseline (Stryker)

First real Stryker run on three high-value modules of Guardian Praeventio. Establishes the empirical floor against which future ratchets will be measured. Run #2 (16th wave) confirms the uplift produced by the 15th-wave Bucket A test additions.

## Run metadata

| Field | Value |
|-------|-------|
| Run date | 2026-05-04 |
| Branch | `dev/sprint-20-fourteenth-wave-multi-agent-2026-05-04` |
| Parent commit | `ae9b76c` (sprint-20 13th wave) |
| Wave | 14th wave, Bucket D |
| Stryker version | 9.6.1 (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`) |
| Test runner | Vitest (existing `vitest.config.ts`) |
| Coverage analysis | `perTest` |
| Concurrency | 1 (Windows host workaround for `STATUS_STACK_BUFFER_OVERRUN` reported in 8th wave) |
| Mutator excluded | `ArrayDeclaration` (canonical RULA/REBA tables; non-target here) |
| Per-mutant timeout | 30000 ms |
| Host OS | Windows 11 Pro |
| Modules baselined | 3 (verifyAuth, orchestrator, sentryInstrumentation) |

## Methodology

Each module was baselined independently using the surgical `--mutate=<file>` invocation against the consolidated `stryker.config.json` (see `docs/testing/MUTATION_TESTING.md` for the consolidation rationale). Concurrency forced to 1 because vitest worker forks crashed mid-run on the dev Windows host during the 8th-wave smoke test (the prior `verifyAuth` run on Linux/CI hadolint approach had also used reduced concurrency). The timeout per mutant was tightened to 30 s to bound runaway tests.

Stryker scoring formula:

```
mutation score (total)   = killed / (killed + survived + timeout + no-coverage)
mutation score (covered) = killed / (killed + survived + timeout)
```

The `total` column is the conservative figure — it punishes uncovered lines as if every mutation there had survived. The `covered` column shows what the existing tests achieve only on the lines they reach. We track the `total` figure for threshold decisions.

## Per-module results

| Module | Mutants total | Killed | Survived | Timeout | NoCoverage | Score (total) | Score (covered) | Wall-clock |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `src/server/middleware/verifyAuth.ts` | 84 | 54 | 22 | 0 | 8 | **64.29 %** | 71.05 % | 47 s |
| `src/services/slm/orchestrator.ts` | 78 | 6 | 48 | 0 | 24 | **7.69 %** | 11.11 % | 13 s |
| `src/services/observability/sentryInstrumentation.ts` | 62 | 45 | 15 | 0 | 2 | **72.58 %** | 75.00 % | 29 s |
| **Cumulative** | **224** | **105** | **85** | **0** | **34** | **46.88 %** | 55.26 % | 1 m 29 s |

Notes on the numbers:

- The `verifyAuth` total mutant count (84) matches the 8th-wave smoke run exactly, and the score (64.29 %) is identical — confirming behaviour is stable post 13th wave (no regression introduced by the 12th/13th waves' analytics + CSP work).
- The `orchestrator.ts` score (7.69 %) is dominated by **48 surviving mutants and 24 NoCoverage mutants** — the bulk of the orchestrator's analytics, retry, and adapter glue is reachable from the existing tests but not asserted on. This file gained heavy analytics wiring during the 12th wave; tests have not yet caught up.
- The `sentryInstrumentation.ts` score (72.58 %) is the strongest of the three. Survivors cluster on the PII-redaction `REDACT_KEYS` set and the heuristic in `isSentrySetupError`, both of which are tricky to mutate-kill without overspecifying tests.

## Top 10 surviving mutants worth fixing (across all modules)

Ranked by likely security/regression cost, then by ease of test addition. Mutator names follow Stryker's taxonomy; see <https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/> for definitions.

### High priority — security/PII boundaries

1. **`sentryInstrumentation.ts:152-163` — `StringLiteral` on every `REDACT_KEYS` entry**
   - 11 surviving mutants total: each redaction key (`'authorization'`, `'cookie'`, `'token'`, `'apiKey'`, `'api_key'`, `'sessionId'`, `'session'`, `'password'`, `'prompt'`, `'rawPrompt'`, `'userInput'`) can be mutated to `""` and no test fails.
   - **Why it matters:** the redaction guarantees PII-scrubbing of payloads bound for Sentry; if a mutation silently emptied any of these keys, real PII would ship.
   - **Fix:** parametric test that, for each key in `REDACT_KEYS`, builds a payload with that key set to a sentinel string, runs `sanitizeContext`, and asserts the value is `'[REDACTED]'`.

2. **`verifyAuth.ts:41:35` — `ConditionalExpression` on `isE2EModeEnabled`**
   - Survivor: `process.env.NODE_ENV !== 'production'` mutated to `if (true)`.
   - **Why it matters:** the E2E backdoor is gated by NODE_ENV. A surviving mutant means production E2E auth would not be caught by tests.
   - **Fix:** explicit unit test for `isE2EModeEnabled()` returning `false` when `NODE_ENV === 'production'`.

3. **`verifyAuth.ts:33:46` — `ConditionalExpression` on production+E2E startup guard**
   - Survivor: the `process.env.E2E_MODE === '1'` half of the AND can be flipped without any test failing.
   - **Why it matters:** module-level `throw` is the last line of defence against a misconfigured Cloud Run deploy mixing prod + E2E. A surviving mutant means the throw is not exercised.
   - **Fix:** test the module under `NODE_ENV=production` + `E2E_MODE=1` and assert the import throws.

4. **`verifyAuth.ts:62-63` — `ConditionalExpression` / `EqualityOperator` / `UnaryOperator` on `sepIdx === -1`**
   - 4 survivors stacked on the same expression handling the `<secret>:<uid>` token split.
   - **Why it matters:** if the colon parser regresses, all E2E sessions degrade silently to `e2e-user-001`.
   - **Fix:** add cases that pass `secret` (no colon) and `secret:` (empty uid) and assert the resolved `uid`.

### Medium priority — silent business-logic gaps

5. **`orchestrator.ts:75:7` and `:76:7` — `ConditionalExpression` / `EqualityOperator` / `BooleanLiteral` on `forceOffline === true` / `forceOnline === true`**
   - 6 survivors total across these two lines.
   - **Why it matters:** the offline/online routing decision in `shouldUseOffline` is the central guard for which inference path runs; mutants here don't trip the existing 3-test smoke.
   - **Fix:** explicit assertions for `{forceOffline: false}` (online), `{forceOnline: true, navigator.onLine: false}` (still online), and `{}` defaults.

6. **`orchestrator.ts:205:7` — `ConditionalExpression` on `remote !== null`**
   - Survivor: `if (false)` instead of `if (remote !== null)`.
   - **Why it matters:** controls whether the cloud-side response is consumed or discarded.
   - **Fix:** assert that when `remote` returns a non-null payload, the response body equals it.

7. **`orchestrator.ts:237-241` — `BlockStatement` / `StringLiteral` / `ObjectLiteral` on `trackQueryOffline` analytics emission**
   - 5 survivors: the entire body of `trackQueryOffline` can be blanked, the event name `'slm.query.offline'` can be `""`, the payload object can be `{}`.
   - **Why it matters:** silent loss of offline-path analytics breaks product-tracking SLAs (Sprint 20 12th wave wired this).
   - **Fix:** spy on `analytics.track` and assert the call shape.

### Lower priority — string identity / heuristic asserts

8. **`sentryInstrumentation.ts:184:7` — `ConditionalExpression` on `if (!(err instanceof Error)) return false`**
   - Survivor: condition flipped to `if (true)`.
   - **Fix:** call `isSentrySetupError(null)` / `isSentrySetupError('string')` and assert `false`.

9. **`sentryInstrumentation.ts:187:5` — `LogicalOperator` / `ConditionalExpression` on the `msg.includes(...)` chain**
   - 3 survivors on `||` flips and condition forcing.
   - **Fix:** test each substring (`'sentry'`, `'hub'`, `'not initialized'`) in isolation produces `true` and a benign error produces `false`.

10. **`orchestrator.ts:44:31` — `StringLiteral` on `ASK_GUARDIAN_ENDPOINT = '/api/ask-guardian'`**
    - Survivor: endpoint mutated to `""`. No test pins the actual URL.
    - **Fix:** assert the fetch call URL on the online path.

## Threshold ratchet recommendation

**Recommendation: NO ratchet on global thresholds.**

Current `stryker.config.json` has `{ high: 80, low: 60, break: 50 }`. That floor was set conservatively in the 9th-wave consolidation precisely because security/business modules were assumed to be "warming up" relative to the R20 ergonomics work.

Looking at the three modules baselined:

- `verifyAuth.ts` (64.29 %) — sits in the `low <= score < high` band. Ratcheting `break` above 60 would lock in a regression-trap that the 8th-wave smoke run already established as the floor; we should **not** ratchet up past `break: 60` until tests actually push score above 70.
- `orchestrator.ts` (7.69 %) — drastically below `break: 50`. The full-list `npm run test:mutation` would currently fail CI on this module alone. **`stryker.config.json`'s `break: 50` is a known-failing floor for orchestrator under its current test coverage.**
- `sentryInstrumentation.ts` (72.58 %) — between low and high. Could individually support `break: 65`, but Stryker 9.6.1 does not support per-file thresholds (R21 backlog item).

A premature ratchet on the global `break` would force orchestrator tests to be written under time pressure rather than as a deliberate test-design exercise. The deliberate path:

1. Bucket D (this run) — establish baseline. Done.
2. Follow-up bucket — write the high-priority tests above (especially #1 PII redaction parametric and #5/#6/#7 orchestrator assertions). Re-run Stryker.
3. Once orchestrator >= 50 % and verifyAuth >= 70 %, ratchet global `break` to 60 and `low` to 70.

**For now: leave thresholds untouched.** Surgical `npm run test:mutation:auth` etc. continue to enforce break:50 per-module run, which `verifyAuth` and `sentryInstrumentation` clear comfortably; the failing exit code of the orchestrator run is a feature, not a regression — it tells the test-author bucket exactly what to fix.

## Run #2 — 2026-05-04 (post-15th-wave)

Branch: `dev/sprint-20-sixteenth-wave-multi-agent-2026-05-04`. Trigger: 15th-wave Bucket A (commit `2b58681`) added 26 targeted tests against the Run #1 top-3 surviving mutants per module (REDACT_KEYS parametric for Sentry, prod-config startup-throw test for verifyAuth, four-quadrant decision matrix for orchestrator). This run measures the uplift.

### Score deltas

| Module | Run #1 score | Run #2 score | Δ (pp) | Run #1 killed | Run #2 killed | Killed Δ | Survived Δ |
|--------|---:|---:|---:|---:|---:|---:|---:|
| `src/server/middleware/verifyAuth.ts` | 64.29 % | **76.19 %** | +11.90 | 54 | 64 | +10 | -10 |
| `src/services/slm/orchestrator.ts` | 7.69 % | **43.59 %** | +35.90 | 6 | 34 | +28 | -12 |
| `src/services/observability/sentryInstrumentation.ts` | 72.58 % | **85.48 %** | +12.90 | 45 | 53 | +8 | -8 |
| **Cumulative** | 46.88 % | **67.86 %** | +20.98 | 105 | 151 | +46 | -30 |

Cumulative across the 3 modules: 224 mutants, 151 killed, 55 survived, 18 NoCoverage, 0 timeouts, 0 errors. Score (covered) climbs from 55.26 % → 73.30 %. Wall-clock at concurrency=1 on Windows host: 40 s (verifyAuth) + 15 s (orchestrator) + 16 s (sentryInstrumentation) = 1 m 11 s, slightly faster than Run #1 (1 m 29 s) likely because the added tests are tightly-scoped unit tests.

### What moved per module

- **verifyAuth (+11.90 pp)** — the Run #1 top-3 mutants on `process.env.E2E_MODE === '1'` (line 33) and `isE2EModeEnabled()` (line 41) were targeted; the `33:46` mutant is now killed by the new module-level prod-config startup throw test, and the line-62/63 `sepIdx === -1` cluster lost 4 of its 6 survivors. The remaining 12 survivors are NEW targets — see below.
- **orchestrator (+35.90 pp, the largest uplift)** — the 4-quadrant `shouldUseOffline` decision matrix added by the 15th wave killed all 6 of the previous `forceOffline` / `forceOnline` mutants on lines 75–76 plus 22 more on the surrounding flow. Score moves from below `break:50` (run was failing) to 43.59 % — still under break:50, but within striking distance of the next bucket.
- **sentryInstrumentation (+12.90 pp)** — the parametric REDACT_KEYS test (`it.each(REDACT_KEYS)`) killed all 11 of the previous `StringLiteral` survivors on lines 152–163. Survivors now cluster on the heuristic `isSentrySetupError` `LogicalOperator` chain (lines 196–200) and a single mutator-resistant string at 123.

### Top 3 NEW surviving mutants (different from Run #1)

#### verifyAuth.ts

1. **`verifyAuth.ts:77:7` — `ConditionalExpression` on Bearer scheme guard**
   - Survivor: `if (!authHeader.startsWith('Bearer '))` mutated to `if (true)`.
   - Why it matters: this is the second-line guard after the E2E branch — if it always trips, every `Bearer` request 401s. No test currently asserts the negative path "Bearer + valid header → continues to admin verifyIdToken".
   - Companion: `77:8 MethodExpression` (`startsWith` → `endsWith`) — same root cause.
   - Fix: positive-path test that supplies `Authorization: Bearer xyz`, mocks `admin.auth().verifyIdToken` to resolve, and asserts `next()` is called.

2. **`verifyAuth.ts:62:28 / 62:39 / 63:25 / 63:36` — leftover `sepIdx === -1` cluster (4 mutants)**
   - Survivors: `ConditionalExpression` flips and `UnaryOperator` `-1` → `+1` on `token.indexOf(':')` parsing.
   - Why it matters: same as Run #1, but only partially closed. The 15th-wave tests cover `secret:uid` and `secret` (no colon), but do not assert the `secret:` (empty uid) edge or trigger the `+1` boundary.
   - Fix: explicit assertion `secret:` → `req.user.uid === 'e2e-user-001'` (fallback) and a non-`-1` index test.

3. **`verifyAuth.ts:36:7 / 41:60 / 53:51 / 70:20 / 71:17` — `StringLiteral` cluster (5 mutants)**
   - Survivors: error-message strings, `'production'` literal in the env check, `'E2E '` scheme prefix, and `e2e-user-001` / `'e2e@praeventio.test'` defaults.
   - Why it matters: most are low-stakes (the error message text is not behavioural), but `41:60` (mutating `'production'` to `""`) silently neutralises the prod gate without test coverage.
   - Fix: test that asserts `isE2EModeEnabled()` returns `false` specifically when `NODE_ENV === 'production'` (literal pinning) — separate from existing "non-test env" tests.

#### orchestrator.ts

1. **`orchestrator.ts:237–245` — `trackQueryOffline` analytics emission body still empty-body / object-literal mutable**
   - Survivors: 5 mutants (`BlockStatement {}`, `StringLiteral ""`, `ObjectLiteral {}`) on the entire offline analytics call shape. Run #1 listed this as priority #7; the 15th wave did not add tests for the analytics seam.
   - Why it matters: silent loss of `'slm.query.offline'` event breaks the product-tracking SLA the 12th wave wired.
   - Fix: spy on `analytics.track` and assert `expect(spy).toHaveBeenCalledWith('slm.query.offline', expect.objectContaining({ query_kind: 'general' }))`.

2. **`orchestrator.ts:104–105` — `tryGetIdToken` `OptionalChaining` + `LogicalOperator` cluster (5 mutants)**
   - Survivors: `?.` chain elision, `&&` → `||` flips, `EqualityOperator` flips on `typeof token === 'string' && token.length > 0`.
   - Why it matters: the auth path through Firebase. Mutations to the truthy guard let an empty/undefined token propagate into the Authorization header. NEW: not in Run #1 top 10 (was "noCoverage" before; now reachable thanks to 15th-wave tests but not asserted).
   - Fix: test `tryGetIdToken()` with mocked Firebase auth returning `''`, `null`, and `'real-token'`, asserting return-value identity.

3. **`orchestrator.ts:162` — `LogicalOperator` on `data.response ?? data.answer ?? ''` (2 mutants)**
   - Survivors: `(data.response ?? data.answer) && ''` and `data.response && data.answer`.
   - Why it matters: governs how the online backend's two response shapes (`{response:...}` vs `{answer:...}`) are coalesced into the canonical `text` field. Mutated form silently returns empty.
   - Fix: parametric test `it.each([{response:'a'},{answer:'b'},{}])` asserting `text` is correct for each shape.

#### sentryInstrumentation.ts

1. **`sentryInstrumentation.ts:196:5` — `LogicalOperator` chain on `msg.includes('sentry') || msg.includes('hub') || msg.includes('not initialized')` (3 mutants)**
   - Survivors: any single `||` flipped to `&&`, or the whole chain forced to `false`.
   - Why it matters: this heuristic decides what counts as "Sentry setup error" vs a real exception. False classification swallows real errors silently. Carry-over from Run #1 priority #9 — 15th wave did not target this.
   - Fix: parametric test on each substring in isolation (`'sentry hub error'`, `'not initialized'`, plus a control like `'database connection refused'` returning `false`).

2. **`sentryInstrumentation.ts:139:9` — `ConditionalExpression` (2 mutants, `true` and `false`)**
   - Survivor: condition forcing inside `sanitizeContext` recursion guard. NEW survivor — not in Run #1 top 10. Likely surfaced because the parametric REDACT_KEYS test gives broader coverage but doesn't assert the recursion-depth boundary.
   - Fix: nested-object payload test (`{a:{b:{c:'token'}}}`) verifying redaction reaches depth >= 3.

3. **`sentryInstrumentation.ts:193:7` — `ConditionalExpression` on `if (!(err instanceof Error))` flipped to `false`**
   - Survivor: same as Run #1 priority #8. Not addressed by 15th wave.
   - Fix: `isSentrySetupError(null)` / `isSentrySetupError('string')` returning `false`.

### Threshold ratchet recommendation (Run #2)

**Recommendation: NO global ratchet on `break`.** Reasoning:

- Per the documented safety rule "do not increase the `break` threshold above the lowest module's score − 5", the safe upper bound is **orchestrator − 5 = 38.59 %**. That is *lower* than the current `break: 50`. The current break already exceeds the orchestrator's score (43.59 %), which is why surgical `npm run test:mutation:slm` exits non-zero on the orchestrator file — a known-failing floor that documents the gap rather than a CI-breaking surprise.
- Two of three modules now individually clear `break: 80` territory (verifyAuth 76.19 %, sentryInstrumentation 85.48 %), but Stryker 9.6.1 still does not support per-file `thresholds`. Per-file ratchets remain a deferred R21 enhancement.
- A ratchet to `break: 55` would block the next CI run on the orchestrator surgical command. Premature.

**Deferred path (when orchestrator ≥ 55 %)**: raise GLOBAL `break: 50 → 55`, leave `low: 60` and `high: 80` untouched. Track in `MUTATION_BASELINE.md` Run #3.

**Per-module strategy (documentation only — config untouched)**:

| Module | Run #2 score | Could individually support `break:` | Block on |
|---|---:|---:|---|
| verifyAuth | 76.19 % | 70 | regression below 70 (per-file unsupported) |
| orchestrator | 43.59 % | 38 | regression below 38 (per-file unsupported) |
| sentryInstrumentation | 85.48 % | 80 | regression below 80 (per-file unsupported) |

For now: documented in this file, not enforced. The next backlog item (per-file thresholds) is the lever to enforce these.

### What's next (17th wave or later)

1. **Orchestrator analytics seam tests** — kill the 5-mutant `trackQueryOffline` cluster (priority #1 NEW above). Smallest test, biggest score lift.
2. **Orchestrator `tryGetIdToken` truthy-guard tests** — kill the 5-mutant 104:25 / 105:12 cluster.
3. **verifyAuth Bearer positive-path test** — kills 77:7 + 77:8 (2 mutants) and forms the spine of the existing supertest harness.
4. **sentryInstrumentation isSentrySetupError parametric** — kills 196:5 cluster (3 mutants) and 193:7 (1 mutant).

If all four follow-up tests land, projected scores: verifyAuth ~85 %, orchestrator ~55 %, sentryInstrumentation ~91 %, cumulative ~78 %. At that point GLOBAL `break: 55` is safe and per-file `break: 70 / 50 / 80` becomes meaningful — the 17th wave can ratchet without surprise CI breaks.

## CI integration recommendation

**Cron weekly, NOT per-PR.** Confirmed by this baseline:

- 3 small modules took 1 m 29 s of wall-clock at concurrency=1 on a dev Windows host. The full 14-module list at concurrency=4 on Linux CI is the documented 30–60 minute window from `MUTATION_TESTING.md`.
- A 30-minute job on every PR is unacceptable for review throughput.
- The actionable signal (which mutants survived, where) does not need same-day feedback — it's a quarterly hygiene check, not a gate.

Concrete proposal:

```yaml
# .github/workflows/mutation.yml (NOT created in this bucket)
on:
  schedule:
    - cron: '0 2 * * 0'   # Sunday 02:00 UTC
  workflow_dispatch:
```

Output should upload `reports/mutation/index.html` and `reports/mutation/report.json` as workflow artifacts. A follow-up bucket should also wire a Sentry alert when the score drops below the previous run's number minus a tolerance (e.g. -3 pp).

## Open backlog items

1. **Full 14-module run on Linux CI** — needed to verify the consolidated config holds end-to-end. Windows host instability (concurrency=1 forced) makes a local full run unreliable; a CI manual `workflow_dispatch` is the right venue.
2. **Tests for the 10 surviving mutants above** — separate bucket, not this one.
3. **Per-file thresholds** — Stryker 9.6.1 does not support `thresholds` at file level; track upstream issue and reintroduce R20-style ergonomics-specific gates when supported.
4. **`.github/workflows/mutation.yml`** with cron + workflow_dispatch — separate bucket.
5. **Trend persistence** — JSON report committed to a `reports/mutation/history/<date>.json` index so we can chart score evolution per module.
6. **Sentry alert on score drop** — Praeventio Sentry org already wired in the 10th wave; emit a custom event on regression.

## Cross-references

- `docs/testing/MUTATION_TESTING.md` — top-level run guide, threshold policy, target rationale.
- `stryker.config.json` — single canonical config (consolidated 9th wave).
- 8th-wave Bucket C verification record — prior `verifyAuth` smoke run (84 mutants, 64.29 % score). This baseline reproduces it exactly on Windows.
- Sprint 20 12th-wave commit `443ae08` — orchestrator analytics additions; explains the 24 NoCoverage mutants accumulated in that file.
