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
