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

## Run #3 — 2026-05-04 (extended modules)

Branch: `dev/sprint-20-seventeenth-wave-multi-agent-2026-05-04`. Trigger: extending baseline coverage from 3 → 7 of the 14 modules in `stryker.config.json`. Adds the security + business-critical modules whose first run is documented here. The remaining 7 modules (ergonomics + protocols, all `excludedMutations: ["ArrayDeclaration"]` beneficiaries) are deferred to a future wave.

### Per-module results (Run #3)

| Module | Mutants | Killed | Survived | NoCoverage | Score (total) | Score (covered) | Time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/services/billing/webpayAdapter.ts` | 218 | 127 | 69 | 22 | **58.26 %** | 64.80 % | 40 s |
| `src/server/middleware/limiters.ts` | 131 | 4 | 94 | 33 | **3.05 %** | 4.08 % | 45 s |
| `src/services/slm/offlineQueue.ts` | 91 | 55 | 33 | 3 | **60.44 %** | 62.50 % | 58 s |
| `src/services/slm/reconciliation.ts` | 54 | 44 | 10 | 0 | **81.48 %** | 81.48 % | 14 s |
| **Run #3 subtotal** | **494** | **230** | **206** | **58** | **46.56 %** | 52.75 % | 2 m 37 s |

Notes on the numbers:

- `webpayAdapter.ts` (58.26 %) — security + business-critical Webpay adapter for payment commit/return. 22 NoCoverage mutants concentrate on the `acquireWebpayIdempotencyLock` lock-stealing path and the `WEBPAY_IDEMPOTENCY_STALE_LOCK_MS` arithmetic; the existing tests reach the lock-acquire path but don't pin the time-window math. Score is **above** `break: 50`.
- `limiters.ts` (3.05 %) — the sole module **deeply** under `break: 50`. Existing tests assert only the IPv6 keyGenerator smoke (R21 B4 / R20 R6 MEDIUM #2) and don't pin any rate-limit window, key construction, or 429 message body. The 33 NoCoverage mutants are the `geminiGlobalLimiter` / `slmTokenLimiter` blocks that the existing test suite never invokes. **This module's score is the largest blind-spot uncovered in this bucket.**
- `offlineQueue.ts` (60.44 %) — IndexedDB queue with HMAC integrity. Survivors cluster on (a) the `sortKeysDeep` canonicalization (lines 133–141), which the existing tests exercise but don't compare-deep-equal across permutations; (b) the `crypto.randomUUID` fallback path (line 194); (c) the fire-and-forget `slm.queue.grew` analytics block (lines 243–250). Score is above `break: 50`.
- `reconciliation.ts` (81.48 %) — the strongest of the four. The HMAC-mismatch drop path and the legacy-entry pass-through are well-covered; survivors cluster on Sentry-breadcrumb metadata strings (`'info'`, `'reconciling pre-HMAC queue entry'`, `'zettelkasten'`, `{ action: 'reconcile' }`) where the existing tests verify behaviour but don't pin the breadcrumb shape.

### Top 3 surviving mutants per module (actionable)

#### webpayAdapter.ts

1. **`webpayAdapter.ts:197:7` — `ConditionalExpression` on `responseCode === 0 && responseStatus === 'AUTHORIZED'`**
   - Survivor: `if (true && responseStatus === 'AUTHORIZED')` — the response-code half of the AUTHORIZED guard can be neutralized.
   - **Why it matters:** the gate maps Transbank's commit response to our internal AUTHORIZED status. A surviving mutant means a malformed response with non-zero code but a wrongly-set `status: 'AUTHORIZED'` would map through. Companion mutants at `:200:5` and `:204:14` similarly neutralize the `typeof responseCode === 'number'` guard.
   - **Fix:** parametric test on `(responseCode, responseStatus)` quadrants — `(0, 'AUTHORIZED') → AUTHORIZED`, `(0, 'OTHER') → FAILED`, `(-1, *) → REJECTED`, `(undefined, 'AUTHORIZED') → FAILED`.

2. **`webpayAdapter.ts:220:11` — `MethodExpression` on `card_number.slice(-4)` mutated to `card_number`**
   - Survivor: PAN truncation removed; full card number flows through to caller.
   - **Why it matters:** PCI/PII boundary. Test asserts a card-detail response but doesn't check the resulting `lastFourDigits` field is exactly 4 chars long. A regression here would silently leak full PANs to logs.
   - **Fix:** assert `expect(result.lastFourDigits).toMatch(/^\d{4}$/)` and `expect(result.lastFourDigits).toBe('4242')` for a fixture with `'1234567890124242'`.

3. **`webpayAdapter.ts:142:28` — `StringLiteral` `'production'` mutated to `""`**
   - Survivor: `config.environment === 'production'` becomes `config.environment === ""`, neutralizing the env-gate. Plus `EqualityOperator` flip at `:142:5` (`!==` instead of `===`).
   - **Why it matters:** the prod env switch decides Integration vs Production Transbank endpoints. A mutated literal silently routes prod-config calls to Integration (or vice-versa). Companion to the verifyAuth Run #2 priority on `'production'` literal pinning.
   - **Fix:** parametric assertion that `init({environment: 'production'})` constructs an `Options` with `Environment.Production`, and `init({environment: 'integration'})` constructs `Environment.Integration`. Pin the literal.

#### limiters.ts

1. **`limiters.ts:31:13` and `:45:13` — `ArithmeticOperator` on `windowMs: 15 * 60 * 1000`**
   - 4 survivors: `15 * 60 / 1000` (= 0.9 ms), `15 / 60 * 1000` (= 250 ms), and similar variants. Both `geminiLimiter` and `invoiceStatusLimiter` accept these mutations because no test pins the window value.
   - **Why it matters:** the entire rate-limit window can collapse to milliseconds without a test failure. Effectively disables throttling.
   - **Fix:** assert that the `rateLimit()` call receives `windowMs: 900_000` (or 15 min in seconds × 60 × 1000) by introspecting the wrapped factory or by counting requests in 14 vs 16 minutes.

2. **`limiters.ts:33:35` and `:47:35` — `ConditionalExpression` / `ArrowFunction` on `keyGenerator`**
   - 6+ survivors: `keyGenerator: (req) => true`, `keyGenerator: () => undefined`, `keyGenerator: (req) => false`, plus `LogicalOperator` flips on the `||` chain `user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous'`.
   - **Why it matters:** if `keyGenerator` returns a constant, ALL clients share a single bucket — global throttle for everyone. If it returns `undefined`, behavior is undefined per `express-rate-limit` docs.
   - **Fix:** integration test that hits the limiter twice from two different IPs and asserts both succeed (per-IP isolation). Then a third call from the first IP should hit the limit.

3. **`limiters.ts:36:21` / `:50:21` / `:185-187` — `StringLiteral` / `ObjectLiteral` on 429 `message` bodies**
   - 8+ survivors: every limiter's `message: { error: '...' }` can be replaced by `message: {}` or have its strings emptied without a test failing.
   - **Why it matters:** the 429 response body is the user-facing error contract. Mutated forms would still 429, but with empty/invalid JSON body — clients depending on the `error` discriminator would crash.
   - **Fix:** integration test that asserts the 429 response body is exactly `{ error: 'gemini_global_cap_reached', message: '...' }` (or matching schema).

#### offlineQueue.ts

1. **`offlineQueue.ts:243-250` — `BlockStatement` / `StringLiteral` / `ObjectLiteral` on `slm.queue.grew` analytics emission**
   - 5 survivors: the `void (async () => {})()` body, the inner `try {}` block, the event name `''`, and the payload `{}` all pass.
   - **Why it matters:** silent loss of `slm.queue.grew` analytics breaks the product-tracking SLA wired in the 9va wave (HMAC integrity). Mirror of the orchestrator `slm.query.offline` survivor closed in 16va Bucket A.
   - **Fix:** spy on `analytics.track` and assert `expect(spy).toHaveBeenCalledWith('slm.queue.grew', expect.objectContaining({ queue_depth_after: expect.any(Number), session_id: record.id }))`.

2. **`offlineQueue.ts:194:7` — `ConditionalExpression` cluster on `crypto.randomUUID` feature-detect (5 mutants)**
   - Survivors: `if (true)`, `if (false)`, `LogicalOperator` flips, `EqualityOperator` flips, `BlockStatement {}` on the `if (c && typeof c.randomUUID === 'function')` guard.
   - **Why it matters:** the fallback path generates IDs via `Math.random().toString(36)` — much less collision-resistant. A surviving `if (false)` mutant means even browsers with native UUIDs would hit the weak fallback in tests where it doesn't matter, but in production the entropy gap matters.
   - **Fix:** test that `generateSessionId()` in a context with `crypto.randomUUID` returns a 36-char UUID-shaped string, and in a context without it returns the `q_<base36>_<base36>` shape.

3. **`offlineQueue.ts:301:7` — `ConditionalExpression` on `if (existing.reconciled) return;`**
   - Survivor: `if (false) return;` — the early-return guard against re-marking a reconciled session is bypassed.
   - **Why it matters:** without the guard, a double-reconcile call would re-write the row and could blow away analytics ordering or trigger duplicate Sentry breadcrumbs. The existing test only covers a single-reconcile path.
   - **Fix:** test `markReconciled(id); markReconciled(id);` doesn't double-emit analytics or double-write.

#### reconciliation.ts

1. **`reconciliation.ts:106:43` — `ConditionalExpression` on `session.hmac.length === 0`**
   - Survivor: `typeof session.hmac !== 'string' || false` — the empty-HMAC check is neutralized.
   - **Why it matters:** an empty-string HMAC slipping through `verifyHmac` means a forged queue entry with `hmac: ''` would route to the legacy pre-HMAC path instead of being dropped as `mismatch`.
   - **Fix:** test that an entry with `hmac: ''` (string but empty) is treated like `hmac: undefined` and drops with `'mismatch'`.

2. **`reconciliation.ts:183:9` — `ConditionalExpression` on `if (integrity === 'legacy')` flipped to `if (true)`**
   - Survivor: forces every entry through the legacy-pre-HMAC breadcrumb branch even when integrity is `'ok'` or `'mismatch'`.
   - **Why it matters:** would emit `'reconciling pre-HMAC queue entry'` breadcrumbs for valid HMAC sessions, polluting Sentry telemetry.
   - **Fix:** assert that for `integrity === 'ok'`, the legacy-entry breadcrumb is **not** emitted.

3. **`reconciliation.ts:138-139` and `:191-193` — `StringLiteral` / `ObjectLiteral` on Sentry breadcrumb metadata**
   - 5 survivors clustered on the breadcrumb `category: 'zettelkasten'`, `data: { action: 'reconcile' }`, `level: 'info'`, `message: 'reconciling pre-HMAC queue entry'`, `data: { sessionId: session.id }`.
   - **Why it matters:** the breadcrumb shape is the contract Sentry queries match on. Empty strings/objects would break Sentry filtering rules without test failure.
   - **Fix:** spy on `Sentry.addBreadcrumb` and assert exact `{ category, message, level, data }` shape.

### Threshold ratchet recommendation (Run #3)

**Recommendation: NO global ratchet on `break`.** Reasoning:

- Per the documented safety rule "do not increase the `break` threshold above the lowest module's score − 5", the safe upper bound across the **7 baselined modules** is `min(76.19, 43.59, 85.48, 58.26, 3.05, 60.44, 81.48) − 5 = 3.05 − 5 = -1.95`. That is far below the current `break: 50`.
- `limiters.ts` at 3.05 % is now the dominant constraint — it sits well below `break: 50`. The surgical `npm run test:mutation` against the full mutate list would exit non-zero on `limiters.ts` alone, exactly as `orchestrator.ts` did before 16va.
- Two of seven modules now sit above 80 % (sentryInstrumentation 85.48, reconciliation 81.48); two more above 70 % (verifyAuth 76.19); the rest in the 43–60 band. Per-file thresholds remain blocked on Stryker 9.6.1 schema (R21 backlog item).
- The deferred path "GLOBAL `break: 50 → 55` once orchestrator ≥ 55 %" from Run #2 is now compounded: even if orchestrator hits 55 %, `limiters.ts` at 3.05 % blocks the ratchet.

**Per-module strategy (documentation only — config untouched)**:

| Module | Run #3 score | Could individually support `break:` | Block on |
|---|---:|---:|---|
| verifyAuth | 76.19 % | 70 | regression below 70 |
| orchestrator | 43.59 % | 38 | regression below 38 |
| sentryInstrumentation | 85.48 % | 80 | regression below 80 |
| webpayAdapter | 58.26 % | 53 | regression below 53 |
| limiters | 3.05 % | n/a (test gap) | needs first-pass tests before any break threshold |
| offlineQueue | 60.44 % | 55 | regression below 55 |
| reconciliation | 81.48 % | 76 | regression below 76 |

**For now: thresholds untouched.** The next bucket priority is `limiters.ts` test-spine — current 3.05 % means the existing IPv6 smoke test is the only thing keeping the file from being effectively unverified. Any of the Top 3 fixes above would more than triple the score in a single test file.

### Cumulative across 7 modules baselined (Run #1 + Run #2 + Run #3)

| Metric | Run #1 (3 modules) | Run #2 (re-run, 3 modules) | Run #3 (4 new modules) | Cumulative all 7 |
|---|---:|---:|---:|---:|
| Mutants total | 224 | 224 | 494 | **718** |
| Killed | 105 | 151 | 230 | **381** |
| Survived | 85 | 55 | 206 | **261** |
| NoCoverage | 34 | 18 | 58 | **76** |
| Score (total) | 46.88 % | 67.86 % | 46.56 % | **53.06 %** |
| Wall-clock | 1 m 29 s | 1 m 11 s | 2 m 37 s | 5 m 17 s |

The cumulative-7 score (53.06 %) sits just above `break: 50`. This is the floor the consolidated config currently enforces across the 7 baselined modules — and `limiters.ts` is the single largest pull-down. Bringing `limiters.ts` from 3.05 % to even 50 % would lift the cumulative-7 score to ~65 % without touching the other six.

### What's next (18th wave or later)

1. **`limiters.ts` test spine** — three small tests would target the three Top 3 clusters above (window arithmetic, keyGenerator, message bodies). Highest score lift per test-line.
2. **`webpayAdapter.ts` AUTHORIZED quadrant** — parametric test on `(responseCode, responseStatus)` to kill the `:197:7` cluster.
3. **`webpayAdapter.ts` PAN truncation** — single-line regex assertion to kill the PCI-relevant `:220:11` mutant.
4. **`offlineQueue.ts` analytics spy** — mirror of the 16va orchestrator analytics fix, applied to `slm.queue.grew`.
5. **`reconciliation.ts` Sentry breadcrumb shape** — single spy + 5-property `objectContaining` assertion to kill the breadcrumb-metadata cluster.

Projected scores after these 5 fixes: limiters ~50 %, webpayAdapter ~70 %, offlineQueue ~70 %, reconciliation ~91 %, cumulative-7 ~65 %. At that point a global `break: 55` ratchet becomes safe.

## Run #4 — 2026-05-04 (ergonomics + protocols)

Branch: `dev/sprint-20-eighteenth-wave-multi-agent-2026-05-04`. Trigger: extending baseline coverage from 7 → 11 of the 14 modules in `stryker.config.json`. Adds the safety wrappers (ergonomicAssessments, iperAssessments) plus two protocol calculators (tmert, iper). The remaining 3 modules (prexor, reba, rula) are deferred to the next stryker-baseline wave.

### Per-module results (Run #4)

| Module | Mutants | Killed | Survived | NoCoverage | Score (total) | Score (covered) | Time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/services/safety/ergonomicAssessments.ts` | 151 | 133 | 17 | 1 | **88.08 %** | 88.67 % | 21 s |
| `src/services/safety/iperAssessments.ts` | 159 | 140 | 18 | 1 | **88.05 %** | 88.61 % | 21 s |
| `src/services/protocols/tmert.ts` | 67 | 57 | 10 | 0 | **85.07 %** | 85.07 % | 10 s |
| `src/services/protocols/iper.ts` | 47 | 42 | 5 | 0 | **89.36 %** | 89.36 % | 8 s |
| **Run #4 subtotal** | **424** | **372** | **50** | **2** | **87.74 %** | 88.15 % | 1 m 0 s |

Notes on the numbers:

- All four modules clear `break: 50` by a wide margin and three of four also clear `high: 80`. This bucket confirms what was suspected at task brief time: the R20 ergonomics + protocols files are the most mature mutation-tested code in the repo (these baselines align with the legacy R20 65–70 floor that the 9th-wave consolidation explicitly preserved).
- Both safety wrappers (`ergonomicAssessments.ts`, `iperAssessments.ts`) score nearly identical 88 % because they share the same architectural pattern: input validation → Firestore `runTransaction` → audit log emission. Survivors cluster on the same hot-spot: the `crypto.randomUUID` feature-detect (line 99 / line 80 respectively) — 8 stacked mutants per module on `if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')`. This is identical to the offlineQueue Run #3 survivor at `:194:7` — same fallback pattern, same un-asserted branch.
- `tmert.ts` (85.07 %) survivors concentrate on the human-readable Spanish `recommendation` strings (lines 78, 80) and on the `risk === 'medio'` / `risk === 'alto'` classification branches that the existing 8 unit tests trigger but don't assert the recommendation text on.
- `iper.ts` (89.36 %) is the strongest of the four. Five survivors all clean: 4 are Spanish recommendation `StringLiteral` mutations on lines 79/86/88/90 (same shape as tmert), 1 is a `ConditionalExpression` on `input.controlEffectiveness !== undefined` defaulting (line 118). The IPER 5x5 probability×severity matrix tests + the IPER_MATRIX shape assertion give this module its high baseline.

### Top 3 surviving mutants per module (actionable)

#### ergonomicAssessments.ts

1. **`ergonomicAssessments.ts:99:7` — `crypto.randomUUID` feature-detect cluster (8 mutants)**
   - Survivors: `if (true)`, `if (false)`, `LogicalOperator` flip (`&&` → `||`), `EqualityOperator` flip on `typeof crypto !== 'undefined'`, `StringLiteral` on `'undefined'` → `""`, the symmetric mutants on `typeof crypto.randomUUID === 'function'`, plus `BlockStatement {}` on the entire branch body.
   - **Why it matters:** identical pattern to offlineQueue Run #3 priority #2. The fallback path (lines 100–102) generates IDs via `Math.random().toString(36)` — collision-resistance gap in production. Tests don't pin which branch executes.
   - **Fix:** test `recordErgonomicAssessment()` once with `crypto.randomUUID` mocked to a sentinel UUID and assert the returned id matches; once with `crypto.randomUUID` deleted and assert the id matches the `Math.random` fallback shape (`/^[a-z0-9]{6,}$/`).

2. **`ergonomicAssessments.ts:74:7` — `ConditionalExpression` on `typeof payload.score !== 'number'`**
   - Survivor: short-circuit half flipped to `false`. The companion `ConditionalExpression` on line 144 (`typeof payload.durationMin === 'number'`) survives the same way.
   - **Why it matters:** the `score` field is the canonical RULA/REBA output. A surviving mutant means a non-number `score` (e.g. `'7'` string from a malformed FE payload) flows through into Firestore without rejection.
   - **Fix:** parametric test on invalid `score` types (`'7'`, `null`, `NaN`, `Infinity`) asserting `recordErgonomicAssessment` throws or returns the expected validation error.

3. **`ergonomicAssessments.ts:189:7 / :200:33 / :205:5` — `OptionalChaining` cluster on `existing?.metadata` / `existing?.type` / `existing?.projectId` (3 mutants)**
   - Survivors: `?.` elision on the post-`runTransaction` read of the existing assessment doc.
   - **Why it matters:** when the doc doesn't exist, the optional chain produces `undefined`; without it, the test would throw `TypeError`. The existing tests cover the happy path where the doc exists. A regression here would crash `signErgonomicAssessment` on a stale ID instead of returning the documented error.
   - **Fix:** test `signErgonomicAssessment(nonexistentId)` and assert the proper error path (not a thrown `TypeError`).

#### iperAssessments.ts

1. **`iperAssessments.ts:80:7` — `crypto.randomUUID` feature-detect cluster (8 mutants)**
   - Survivors: identical 8-mutant cluster to the ergonomicAssessments equivalent above (lines 80–82). Same root cause, same fix.
   - **Fix:** mirror the `recordErgonomicAssessment` test pattern in `iperAssessments.test.ts` — branch coverage on `crypto.randomUUID` presence/absence.

2. **`iperAssessments.ts:46:10` — `ConditionalExpression` on the integer-1-to-5 guard inside `isInRange`**
   - Survivor: `typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5` mutated to `true && Number.isInteger(v) && v >= 1 && v <= 5`.
   - **Why it matters:** this guard is the IPER input contract — `probability` and `severity` must be integers in [1,5]. A surviving mutant means a `7` or `'3'` string would pass the guard.
   - **Fix:** parametric test passing each invalid input (`'3'`, `0`, `6`, `3.5`, `null`) and asserting the validation error fires.

3. **`iperAssessments.ts:65:7` — `LogicalOperator` flip on `!payload.inputs || typeof payload.inputs !== 'object'`**
   - Survivor: `&&` instead of `||`. Companion `ConditionalExpression` at `:65:26` on the second half.
   - **Why it matters:** the `inputs` block (containing P + S + control effectiveness) is the IPER calculation payload. A surviving `&&` means `null inputs` would NOT throw — only the rare combination of `null` AND a non-object would.
   - **Fix:** test `recordIperAssessment({...payload, inputs: null})` and `recordIperAssessment({...payload, inputs: 'string'})` both throw.

#### protocols/tmert.ts

1. **`tmert.ts:77:7-25` — `risk === 'medio'` classification cluster (5 mutants)**
   - Survivors: `if (true)`, `if (false)`, `EqualityOperator !==`, `StringLiteral ""`, `BlockStatement {}` on the medium-risk recommendation branch. Companion: line 74 `risk === 'alto'` `ConditionalExpression`.
   - **Why it matters:** the recommendation strings (Spanish text shown to operators) are the user-visible contract of the TMERT calculator. Mutated forms would still classify risk correctly but emit the wrong recommendation text — silent UX regression for safety-critical guidance.
   - **Fix:** assert the exact recommendation text per risk level. e.g. `expect(result.recommendation).toMatch(/Riesgo medio/)` on a medium-risk fixture.

2. **`tmert.ts:78:12 / :80:10` — `StringLiteral` on `recommendation` text (2 mutants)**
   - Survivors: both medium and low recommendations can be replaced by `""` without test failure.
   - **Why it matters:** same root cause as #1 above — recommendation text is unverified.
   - **Fix:** companion to #1 — pin the start-of-string text per risk level.

3. **`tmert.ts:84:47` — `EqualityOperator` flip on `hours > 24`**
   - Survivor: `hours > 24` mutated to `hours >= 24` (boundary off-by-one). The `:86:7` `StringLiteral` mutant on the throw message also survives.
   - **Why it matters:** the validation message says `[0,24]` (inclusive), so `hours === 24` should NOT throw. A surviving mutant would force a throw on the boundary 24-hour case.
   - **Fix:** test `evaluateTmert({exposureHoursPerDay: 24, ...})` succeeds (does not throw) and `evaluateTmert({exposureHoursPerDay: 24.001, ...})` throws.

#### protocols/iper.ts

1. **`iper.ts:79:3 / :86:5 / :88:5 / :90:5` — `StringLiteral` cluster on Spanish recommendation text (4 mutants)**
   - Survivors: 4 of 5 total survivors are Spanish recommendation strings (`'intolerable'`, `'Riesgo tolerable...'`, `'Riesgo moderado...'`, `'Riesgo importante...'`) all replaceable by `""`.
   - **Why it matters:** identical pattern to tmert #1/#2 — recommendation text unverified.
   - **Fix:** parametric test on each `(probability, severity)` quadrant asserting the recommendation matches the documented text per risk level.

2. **`iper.ts:118:7` — `ConditionalExpression` on `input.controlEffectiveness !== undefined`**
   - Survivor: `if (true)` — control-effectiveness branch always taken, even when undefined.
   - **Why it matters:** the optional `controlEffectiveness` modifier reduces residual risk. A surviving mutant means `undefined` would still apply a default reduction (depending on the operator inside the if), affecting the final `riskValue`.
   - **Fix:** test `calculateIper({probability:5, severity:5})` (no control) and `calculateIper({probability:5, severity:5, controlEffectiveness:undefined})` produce identical `riskValue`, distinct from `calculateIper({probability:5, severity:5, controlEffectiveness:0.5})`.

3. **(none — only 5 survivors total in this module)**
   - The remaining survivor is the `controlEffectiveness` mutant above; the other 4 are the recommendation `StringLiteral` cluster. This module is the strongest of the four — the IPER 5x5 matrix parametric tests + invalid-input tests give thorough coverage.

### Threshold ratchet recommendation (Run #4)

**Recommendation: NO global ratchet on `break`.** Reasoning unchanged from Run #3:

- Per the documented safety rule "do not increase the `break` threshold above the lowest module's score − 5", the safe upper bound across the **11 baselined modules** is `min(76.19, 43.59, 85.48, 58.26, 3.05, 60.44, 81.48, 88.08, 88.05, 85.07, 89.36) − 5 = 3.05 − 5 = -1.95`. `limiters.ts` at 3.05 % remains the dominant constraint and continues to block the global ratchet.
- The Run #4 modules **all** sit at or above 85 % — three above the `high: 80` band, one (iper) approaching 90 %. They individually could support `break: 80`, but per-file thresholds remain blocked on Stryker 9.6.1 schema (R21 backlog item).
- This bucket changes nothing about the Run #3 priority list: `limiters.ts` is still the single largest test-gap. Bringing `limiters.ts` from 3.05 % to 50 % remains the highest-priority test-add per score-lift-per-line.

**Per-module strategy (documentation only — config untouched)**:

| Module | Run | Score | Could individually support `break:` | Block on |
|---|---|---:|---:|---|
| verifyAuth | #2 | 76.19 % | 70 | regression below 70 |
| orchestrator | #2 | 43.59 % | 38 | regression below 38 |
| sentryInstrumentation | #2 | 85.48 % | 80 | regression below 80 |
| webpayAdapter | #3 | 58.26 % | 53 | regression below 53 |
| limiters | #3 | 3.05 % | n/a (test gap) | needs first-pass tests before any break threshold |
| offlineQueue | #3 | 60.44 % | 55 | regression below 55 |
| reconciliation | #3 | 81.48 % | 76 | regression below 76 |
| **ergonomicAssessments** | **#4** | **88.08 %** | **80** | regression below 80 |
| **iperAssessments** | **#4** | **88.05 %** | **80** | regression below 80 |
| **protocols/tmert** | **#4** | **85.07 %** | **80** | regression below 80 |
| **protocols/iper** | **#4** | **89.36 %** | **80** | regression below 80 |

**For now: thresholds untouched.** All four Run #4 modules clear `break: 50` comfortably. The Run #3 `limiters.ts` follow-up remains the gate on a global ratchet; Run #4 doesn't change that calculus.

### Cumulative across 11 modules baselined (Run #1 + Run #2 + Run #3 + Run #4)

| Metric | Run #1 (3 modules, baseline) | Run #2 (3 modules, re-run) | Run #3 (4 new modules) | Run #4 (4 new modules) | Cumulative all 11 (#2 + #3 + #4) |
|---|---:|---:|---:|---:|---:|
| Mutants total | 224 | 224 | 494 | 424 | **1142** |
| Killed | 105 | 151 | 230 | 372 | **753** |
| Survived | 85 | 55 | 206 | 50 | **311** |
| NoCoverage | 34 | 18 | 58 | 2 | **78** |
| Score (total) | 46.88 % | 67.86 % | 46.56 % | 87.74 % | **65.94 %** |
| Wall-clock | 1 m 29 s | 1 m 11 s | 2 m 37 s | 1 m 0 s | 6 m 17 s |

The cumulative-11 score (**65.94 %**) sits comfortably above `break: 50` and above `low: 60`, well below `high: 80`. Run #4 added 4 modules averaging 87.6 %, which lifted the cumulative from Run #3's 53.06 % (cumulative-7) to 65.94 % (cumulative-11). `limiters.ts` at 3.05 % is still the single dragging score: removing it from the average would push cumulative to ~72 %.

### What's next (19th wave or later)

1. **Final stryker-baseline wave** — baseline the remaining 3 modules: `prexor.ts`, `reba.ts`, `rula.ts`. RULA/REBA have `excludedMutations: ["ArrayDeclaration"]` for canonical tables; expect scores in the 70–85 % range based on the R20 ratchet history and on the Run #4 `iper.ts` parallel.
2. **`limiters.ts` test spine** — still the priority for any meaningful global ratchet. See Run #3 priorities.
3. **`crypto.randomUUID` feature-detect coverage** — ergonomicAssessments + iperAssessments + offlineQueue all share the same un-asserted fallback branch. A single shared utility test would close 8 + 8 + 5 = 21 mutants across three files in one bucket.
4. **Spanish recommendation text pinning** — tmert + iper both have unverified recommendation strings. A single parametric `(risk_level → text_match)` test per file would close 4 + 4 = 8 mutants.

Projected scores after #2/#3/#4 above + final 3 modules baselined: cumulative-14 lands around 70 % depending on prexor/reba/rula. Once `limiters.ts` ≥ 55 %, `break: 50 → 55` ratchet becomes safe globally.

## Run #5 — 2026-05-04 (FINAL 3 modules — 14/14 baseline COMPLETE)

Branch: `dev/sprint-20-nineteenth-wave-multi-agent-2026-05-04`. Trigger: closing baseline coverage from 11 → 14 of the 14 modules in `stryker.config.json`. **All Stryker config targets now have an initial mutation score.** Adds the final 3 modules: PREXOR thermal/noise calculator and the canonical RULA + REBA ergonomics scorers (both with `excludedMutations: ["ArrayDeclaration"]` honoring McAtamney 1993 / Hignett 2000 tables).

### Per-module results (Run #5)

| Module | Mutants | Killed | Survived | NoCoverage | Score (total) | Score (covered) | Time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/services/protocols/prexor.ts` | 82 | 67 | 15 | 0 | **81.71 %** | 81.71 % | 15 s |
| `src/services/ergonomics/reba.ts` | 310 | 241 | 61 | 8 | **77.74 %** | 79.80 % | 1 m 29 s |
| `src/services/ergonomics/rula.ts` | 225 | 212 | 13 | 0 | **94.22 %** | 94.22 % | 1 m 18 s |
| **Run #5 subtotal** | **617** | **520** | **89** | **8** | **84.28 %** | 85.39 % | 3 m 2 s |

Notes on the numbers:

- All three modules clear `break: 50` by a wide margin and two of three (prexor, rula) also clear `high: 80`. `rula.ts` (94.22 %) is the **strongest module ever baselined**, edging past the previous champion `iper.ts` (89.36 % from Run #4). The `excludedMutations: ["ArrayDeclaration"]` setting strips noise from the canonical TABLE_A/B/C lookups; what's left is the boundary-arithmetic and recommendation-text logic the parametric per-cell tests already exercise heavily.
- `prexor.ts` (81.71 %) — survivors cluster on (a) Spanish recommendation `StringLiteral`/`ConditionalExpression` cases for `'alto'` / `'significativo'` (lines 80–83, 4 mutants) — same pattern as tmert/iper Run #4; (b) validation `EqualityOperator` boundary flips (`<` → `<=`, `>` → `>=`) on lines 62, 90, 95, 109 (5 mutants); (c) `ConditionalExpression` / `LogicalOperator` on the `Number.isFinite(t) && t > 0` guard at line 109 (4 mutants); (d) `StringLiteral` on validation throw messages (2 mutants, low-stakes).
- `reba.ts` (77.74 %) — the lowest of the three because its branch surface is wider (5 segment scoring functions × multiple flexion/extension boundaries each). Survivors cluster on (a) per-segment `flex` / `kg` boundary `EqualityOperator` flips on lines 167–234 (~25 mutants — `>=` ↔ `>`, `<=` ↔ `<`, `< -20` ↔ `<= -20` on the body-angle bands); (b) input-validation `ConditionalExpression` / `LogicalOperator` on lines 288–319 (~10 mutants on `!input.trunk || !input.neck || !input.legs`); (c) the field-name `StringLiteral` cluster in the validation array on lines 302–306 (`'trunk.flexionDeg'` → `""`, 5 mutants); (d) Spanish recommendation strings (`low: 'Riesgo bajo...'`, `medium: 'Riesgo medio...'`, `high: 'Riesgo alto...'`, `very_high: 'Riesgo muy alto...'`) on lines 277–280 (4 mutants); (e) the `if (u.supported) base -= 1` `AssignmentOperator` flip to `+=` on line 212 (single high-impact mutant).
- `rula.ts` (94.22 %) — only 13 survivors out of 225 mutants. They split into (a) recommendation `StringLiteral` / `ConditionalExpression` on the `getRecommendation` switch at lines 240–241 (action levels 2 and 3 — 4 mutants); (b) action-level `EqualityOperator` boundary flips at lines 231–232 (`final <= 2` ↔ `final < 2`, `final <= 4` ↔ `final < 4` — 2 mutants); (c) trunk extension boundary at line 131 (`flex < -20` ↔ `flex <= -20` and `< -20` ↔ `< +20` — 3 mutants, mirror of REBA `:170`/`:206`); (d) neck extension boundary at line 169 (`f < 0` ↔ `f <= 0` — 1 mutant); (e) muscle-pattern `'repeated'` `StringLiteral` at line 206 (`pattern === 'repeated'` ↔ `pattern === ""` — 1 mutant); (f) `RangeError` message text at line 121 (1 mutant, low-stakes); (g) the `'static'` short-circuit `ConditionalExpression` on line 206 (1 mutant). The TABLE_A/B/C canonical-cell snapshot tests + the parametric per-quadrant tests give this module its high baseline.

### Top 3 surviving mutants per module (actionable)

#### protocols/prexor.ts

1. **`prexor.ts:109:9` and `:109:31` — `ConditionalExpression` / `LogicalOperator` / `EqualityOperator` cluster on `Number.isFinite(t) && t > 0` (4 mutants)**
   - Survivors: `if (true)`, `if (Number.isFinite(t) || t > 0)`, `if (Number.isFinite(t) && true)`, `if (Number.isFinite(t) && t >= 0)`.
   - **Why it matters:** the per-measurement guard inside the dose loop. A surviving mutant lets a `durationHours: 0` or `Infinity` measurement contribute to the cumulative dose, silently inflating the noise-exposure assessment. The guard is the last line of defence against bad inputs that already passed the outer validation.
   - **Fix:** parametric test on the dose path with measurements `[{durationHours: 0, levelDbA: 90}, {durationHours: Infinity, levelDbA: 90}]` and assert the dose equals 0 (both excluded).

2. **`prexor.ts:62:7 / :90:44 / :95:39` — `EqualityOperator` flips on `<` ↔ `<=` boundary cluster (3 mutants)**
   - Survivors: `levelDbA < COUNTING_THRESHOLD_DBA` ↔ `<=`, `m.durationHours < 0` ↔ `<=`, `m.levelDbA < 0` ↔ `<=`.
   - **Why it matters:** the validation layer says `≥ 0` is allowed, so `0` exactly should NOT throw. A surviving `<=` mutant would force a throw on the boundary. Companion to the tmert Run #4 priority on `hours > 24` ↔ `>= 24`.
   - **Fix:** explicit boundary test `calculatePrexor({measurement: [{durationHours: 0, levelDbA: 0}]})` succeeds (does not throw); `calculatePrexor({measurement: [{durationHours: -0.001, ...}]})` throws.

3. **`prexor.ts:80:5 / :80:10 / :81:14 / :82:5 / :82:10 / :83:14` — `StringLiteral` / `ConditionalExpression` on `'alto'` / `'significativo'` recommendation cases (4 mutants)**
   - Survivors: switch case literal mutated to `""`, recommendation text mutated to `""`, plus `ConditionalExpression` flipping the `case` body to fall through.
   - **Why it matters:** identical pattern to tmert + iper Run #4 priority — Spanish recommendation text unverified. Mutated forms emit the wrong guidance text for the most consequential risk levels.
   - **Fix:** parametric test on each `(dose, level)` quadrant asserting the recommendation matches the documented text per risk level (`expect(result.recommendation).toMatch(/^Riesgo alto/)` on a high-dose fixture, etc.).

#### ergonomics/reba.ts

1. **`reba.ts:167–234` — segment scoring `EqualityOperator` boundary flip cluster (≈25 mutants)**
   - Survivors: every `>=` / `<=` / `<` / `>` per-segment flexion-angle boundary across trunk / neck / upper-arm / lower-arm / wrist / load can be flipped without test failure. Examples: `flex >= 0 && flex <= 20` ↔ `flex > 0`, `f > 45 && f <= 90` ↔ `f >= 45`, `l.kg < 5` ↔ `l.kg <= 5`, `l.kg <= 10` ↔ `l.kg < 10`.
   - **Why it matters:** these are the canonical Hignett 2000 boundaries. Tests cover the *interior* of each band but don't pin the exact boundary value (e.g. `flex = 20` → trunk score 2 vs 3). Boundary regressions silently bump risk classifications across the band threshold.
   - **Fix:** parametric per-boundary test — for each segment, evaluate at `boundary - 0.001`, `boundary`, and `boundary + 0.001` and assert the segment score matches the documented band assignment. ~12 boundaries × 3 evaluations = ~36 assertions in one parametric `it.each`.

2. **`reba.ts:288–319` — input-validation `ConditionalExpression` / `LogicalOperator` cluster (~10 mutants)**
   - Survivors: `!input || typeof input !== 'object'` second-half neutralized; `!input.trunk || !input.neck || !input.legs` flipped to `&&`; `!input.upperArm || !input.lowerArm || !input.wrist` similar; standalone `if (!input.load)` / `if (!input.coupling)` / `if (!input.activity)` forced to `false`.
   - **Why it matters:** the validation layer is the contract for every front-end call. A surviving `&&` mutant means a partial payload (e.g. `{trunk: {...}, neck: undefined, legs: undefined}`) would NOT throw — it would silently produce `NaN`-tainted scores or crash deeper in the pipeline.
   - **Fix:** parametric test passing every individual missing-required-field permutation (`{...minimal, trunk: undefined}` etc.) and asserting each one throws with the documented message.

3. **`reba.ts:212:20` — `AssignmentOperator` `-=` ↔ `+=` on `if (u.supported) base -= 1`**
   - Survivor: supported-arm bonus inverted from a -1 reduction to a +1 addition. Single high-impact mutant.
   - **Why it matters:** the `supported` flag for upper-arm posture should *reduce* the score (arm rest reduces fatigue). A surviving `+=` mutant would *increase* the score for supported arms — silent reversal of the assistive-equipment benefit calculation.
   - **Fix:** test that `evaluateReba({...fixture, upperArm: {...arm, supported: true}})` produces a strictly LOWER `upperArmScore` than the same fixture with `supported: false`.

#### ergonomics/rula.ts

1. **`rula.ts:240:5 / :240:20 / :241:5 / :241:20` — `ConditionalExpression` / `StringLiteral` on `getRecommendation` action levels 2 and 3 (4 mutants)**
   - Survivors: `case 2:` body falls through, `case 3:` body falls through, both recommendation strings mutated to `""`.
   - **Why it matters:** action levels 2 ('Investigation needed') and 3 ('Investigation and changes soon') are the most common practical outcomes for ergonomic assessments. A surviving mutant returns empty text — silent UX regression. Mirror of tmert / iper / reba recommendation-text pattern.
   - **Fix:** parametric `(finalScore → expectedRecommendation)` test asserting the documented text per action level: `(2, /investigación/)`, `(5, /pronto/)`, `(7, /investigación e implementar cambios ahora/)`.

2. **`rula.ts:131:12 / :131:16 / :169:9` — trunk + neck extension boundary cluster (4 mutants)**
   - Survivors: `flex < -20` ↔ `<=`, `flex < -20` ↔ `< +20` (UnaryOperator), `f < 0` ↔ `<=` on the neck score.
   - **Why it matters:** the back/neck extension boundary is the defining safety threshold (negative flex = extension). The `+20` mutation is particularly insidious — flexion ≥ 20° (which is the more harmful direction) would NOT trigger the +1 bonus, while extension < 20° would. Mirror of REBA Run #5 priority #1 boundary cluster.
   - **Fix:** explicit boundary test at `flex = -20` (boundary) and `flex = -19.9` (just inside flexion band) with documented score assertions.

3. **`rula.ts:206:31 / :206:43` — `ConditionalExpression` / `StringLiteral` on `pattern === 'static' || pattern === 'repeated'` (2 mutants)**
   - Survivors: `pattern === 'repeated'` short-circuited to `false`, `'repeated'` string mutated to `""`.
   - **Why it matters:** the muscle-use pattern (`'static'` or `'repeated'`) adds +1 to the muscle score per the McAtamney 1993 protocol. A surviving mutant means `'repeated'` patterns silently miss the +1, under-scoring repetitive-motion risk.
   - **Fix:** test `evaluateRula({...fixture, muscle: {pattern: 'repeated', ...}})` produces a `muscleScore` exactly 1 higher than `pattern: 'occasional'` baseline.

### Threshold ratchet recommendation (Run #5)

**Recommendation: NO global ratchet on `break`.** Reasoning:

- Per the documented safety rule "do not increase the `break` threshold above the lowest module's score − 5", the safe upper bound across the **14 baselined modules** is `min(76.19, 43.59, 85.48, 58.26, 3.05, 60.44, 81.48, 88.08, 88.05, 85.07, 89.36, 81.71, 77.74, 94.22) − 5 = 3.05 − 5 = -1.95`. `limiters.ts` at 3.05 % remains the dominant constraint — Run #5 does not change the calculus.
- The Run #5 modules **all** sit above 77 % (one above 94 %, two above 80 %). They individually could support `break: 70`, but per-file thresholds remain blocked on Stryker 9.6.1 schema (R21 backlog item).
- Honest call: the 18va wave's tests promised in the Run #4 "next steps" (limiters spine, crypto.randomUUID coverage, Spanish recommendation pinning) are **not** reflected in this run because the Stryker re-run on those files is pending CI. So the cumulative-14 number reflects the test state circa Run #4 — it does not yet capture any uplift from the limiters work.

**Per-module strategy (documentation only — config untouched)**:

| Module | Run | Score | Could individually support `break:` | Block on |
|---|---|---:|---:|---|
| verifyAuth | #2 | 76.19 % | 70 | regression below 70 |
| orchestrator | #2 | 43.59 % | 38 | regression below 38 |
| sentryInstrumentation | #2 | 85.48 % | 80 | regression below 80 |
| webpayAdapter | #3 | 58.26 % | 53 | regression below 53 |
| limiters | #3 | 3.05 % | n/a (test gap) | needs first-pass tests before any break threshold |
| offlineQueue | #3 | 60.44 % | 55 | regression below 55 |
| reconciliation | #3 | 81.48 % | 76 | regression below 76 |
| ergonomicAssessments | #4 | 88.08 % | 80 | regression below 80 |
| iperAssessments | #4 | 88.05 % | 80 | regression below 80 |
| protocols/tmert | #4 | 85.07 % | 80 | regression below 80 |
| protocols/iper | #4 | 89.36 % | 80 | regression below 80 |
| **protocols/prexor** | **#5** | **81.71 %** | **76** | regression below 76 |
| **ergonomics/reba** | **#5** | **77.74 %** | **70** | regression below 70 |
| **ergonomics/rula** | **#5** | **94.22 %** | **89** | regression below 89 |

**For now: thresholds untouched.** All three Run #5 modules clear `break: 50` comfortably; rula.ts even clears `break: 90` territory. The Run #3 `limiters.ts` follow-up remains the gate on a global ratchet; Run #5 doesn't change that calculus.

### Cumulative across 14 modules baselined (Run #2 + Run #3 + Run #4 + Run #5 — 14/14 COMPLETE)

| Metric | Run #2 (3 modules, re-run) | Run #3 (4 new modules) | Run #4 (4 new modules) | Run #5 (3 new modules) | Cumulative all 14 |
|---|---:|---:|---:|---:|---:|
| Mutants total | 224 | 494 | 424 | 617 | **1759** |
| Killed | 151 | 230 | 372 | 520 | **1273** |
| Survived | 55 | 206 | 50 | 89 | **400** |
| NoCoverage | 18 | 58 | 2 | 8 | **86** |
| Score (total) | 67.86 % | 46.56 % | 87.74 % | 84.28 % | **72.37 %** |
| Wall-clock | 1 m 11 s | 2 m 37 s | 1 m 0 s | 3 m 2 s | 7 m 50 s |

The cumulative-14 score (**72.37 %**) sits comfortably above `break: 50` and above `low: 60`, well below `high: 80`. Run #5 added 3 modules averaging 84.6 % (rula 94.22 % pulls the average up; reba 77.74 % pulls it back), which lifted the cumulative from Run #4's 65.94 % (cumulative-11) to 72.37 % (cumulative-14) — a **+6.43 pp** uplift. `limiters.ts` at 3.05 % remains the single dragging score: removing it from the cumulative-14 average would push the score to ~77.5 %.

### 14/14 baseline COMPLETE — what's next

1. **CI cron weekly mutation run on the 14 modules** — `.github/workflows/mutation.yml` proposed in Run #1 / Run #2 backlog. Now that all 14 modules have a baseline, the workflow can compare scores PR-over-cron and emit Sentry alerts on regressions ≥ 3 pp. This should be the **next bucket** — it converts the static baseline into a regression gate.
2. **`limiters.ts` test spine** — still the priority for any meaningful global ratchet. See Run #3 priorities. Bringing limiters from 3.05 % to even 50 % would lift cumulative-14 from 72.37 % to ~77 %.
3. **Boundary `EqualityOperator` cluster — REBA + RULA + PREXOR** — single shared parametric test pattern (per-boundary `value-1, value, value+1` triple) would close the ~25 REBA mutants + 3 RULA mutants + 3 PREXOR mutants in one bucket. Highest mutant-kills-per-test-line ratio of any open backlog item.
4. **Spanish recommendation text pinning — universal** — tmert + iper + prexor + reba + rula all share the same un-asserted recommendation-text pattern. A single shared parametric `(risk_level → text_match)` pattern across 5 files would close ~16 mutants in one bucket.
5. **Per-file thresholds** — Stryker 9.6.1 still does not support `thresholds` at file level; track upstream issue. Once supported, the per-module `break:` column above becomes the enforced contract.

After items #2/#3/#4: projected cumulative-14 ~85 %. At that point a global `break: 60` ratchet becomes safe and `low: 70` / `high: 85` becomes a reasonable target band.

## Cross-references

- `docs/testing/MUTATION_TESTING.md` — top-level run guide, threshold policy, target rationale.
- `stryker.config.json` — single canonical config (consolidated 9th wave).
- 8th-wave Bucket C verification record — prior `verifyAuth` smoke run (84 mutants, 64.29 % score). This baseline reproduces it exactly on Windows.
- Sprint 20 12th-wave commit `443ae08` — orchestrator analytics additions; explains the 24 NoCoverage mutants accumulated in that file.
- Sprint 20 9va wave (HMAC integrity layer) — explains the offlineQueue HMAC tag and the reconciliation `verifyHmac` path baselined in Run #3.
- McAtamney L., Corlett E.N. (1993) — RULA canonical TABLE_A/B/C source. `excludedMutations: ["ArrayDeclaration"]` honors the canonical-table contract.
- Hignett S., McAtamney L. (2000) — REBA canonical TABLE_A/B/C source. Same exclusion rationale.
