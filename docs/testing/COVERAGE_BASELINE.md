# Coverage baseline — Guardian Praeventio

> Plan v3 Fase 1. The user's directive (2026-05-29): tests of what the app
> already has → **90%**, measured honestly, without deleting code or lowering
> floors. This file is the starting snapshot + the prioritization that drives
> the coverage-lift work. Update the snapshot whenever a full
> `npm run test:coverage` is run.

## How to measure

```bash
npm run test:coverage   # v8 provider, all:true, 30s timeout, reportOnFailure
node scripts/check-coverage-ratchet.cjs   # enforce floors (report-only until seeded)
```

Config lives in `vitest.config.ts` (`test.coverage`). `all: true` means files
with **no importing test** still count — so the denominator is the honest "what
the app actually has", not just files a test happened to touch.

## Baseline — 2026-05-29

Suite health: **11,263 passed / 0 failed / 1 todo** (1073 test files). The
historical "394 failing" in `TODO.md §8` was stale. (4 transient failures on
the first instrumented run were 5s-timeout-under-instrumentation, fixed with
`--test-timeout=30000` + `coverage.reportOnFailure`.)

| Metric | % | Covered / Total |
|---|---|---|
| **Lines** | **43.35%** | 35092 / 80939 |
| Statements | 42.63% | 38132 / 89441 |
| Functions | 40.02% | 7236 / 18080 |
| Branches | 38.46% | 22308 / 57999 |

### Where the uncovered mass is (by directory)

| Dir | Coverage | Uncovered lines | Note |
|---|---|---|---|
| `src/server` | **20%** | **14,181** | Routes/middleware/jobs — pure logic, supertest-able. **Biggest lever.** |
| `src/components` | 23% | 10,589 | UI — needs jsdom; lower value/line. |
| `src/pages` | 21% | 9,382 | UI — lazy pages, lots of JSX. |
| `src/services` | **82%** | 5,065 | Calc engines already well-tested. Only the tail left. |
| `src/hooks` | 14% | 4,552 | Logic — second-biggest lever. |
| `src/contexts` | 16% | 761 | Providers. |
| `src/utils` | 67% | 655 | `offlineStorage.ts` is the big 0% one. |

## Strategy (highest leverage first, vital-first within each)

1. **`src/server/routes/*`** — the single biggest gain/effort. Most routes are
   0–10%. Per CLAUDE.md every route needs 401 + happy + 400/403/404. Vital/money
   order: `billing.ts` (517 uncov), `emergency.ts`, then compliance routes
   (`cphsMinute`, `incidentTrends`, `confidentialReports`, `projectClosure`),
   then the rest (`curriculum`, `workerReadiness`, `admin`, `culturePulse`…).
2. **`src/hooks/*`** — logic hooks: `useManDownDetection` (report-flagged),
   `useRiskEngine`, `useBiometricAuth`, `useSeismicMonitor`, `useEvacuation`.
3. **`src/services` tail** — finish the 18% remaining (already 82%).
4. **UI (`components`/`pages`)** — smoke + key interactions; lower priority.

## Honest exclusions (documented, not inflated)

Some code is impractical to unit-test without secrets/hardware/native bridges
and will be excluded or smoke-only, **not** counted as "covered":
Capacitor native plugin wrappers, Maps-key-gated map components, web workers,
MediaPipe camera setup. These are listed here as they're identified so the
final % is honest.

## Ratchet

`scripts/coverage-floors.json` holds the monotonic floors. Seeded at the
baseline; raise as coverage climbs, never lower silently. `check-coverage-ratchet.cjs`
enforces (report-only until the floors file exists).

## Snapshot — 2026-05-31 (after the server-route coverage campaign #602–#615)

Full `npm run test:coverage` re-run. The ~54 real-router suites + 13
`z.unknown()` 500→400 fixes lifted lines **43.35% → 50.89%**.

| Metric | % | Covered / Total |
|---|---|---|
| **Lines** | **50.89%** | 41256 / 81060 |
| Statements | 49.91% | 44712 / 89573 |
| Functions | 44.59% | 8069 / 18094 |
| Branches | 43.81% | 25446 / 58078 |

`src/server` rose **20% → 51%** (the campaign's target dir). Remaining mass:

| Dir | Uncovered lines | Note |
|---|---|---|
| `src/components` | 10,590 (23%) | UI — jsdom, lower value/line |
| `src/pages` | 9,386 (21%) | UI |
| `src/server` | 8,619 (51%) | still the cleanest lever |
| `src/services` | 4,989 (83%) | tail |
| `src/hooks` | 4,135 (22%) | logic — second lever |

Top remaining non-UI levers (next blocks): `billing.ts` (517, 0%), `server.ts`
(343), `curriculum.ts` (293, 7%), `geminiBackend.ts` (229, 0%), then the
mid-size server routes (`b2dAdmin`, `leadership`, `restrictedZones`,
`aiGuardrails`, `workPermits`, `admin`, `culturePulse`, `gemini`).

**Block 1 · wave 1** (this PR): emergency, dte, suseso, compliance, commute,
apprenticeship → **+230 tests** (real-router). Finding: `apprenticeship.ts`
`authorize` does `get` + 2 `set`s without `runTransaction` (CLAUDE.md #19) —
flagged, not fixed.
