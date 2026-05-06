# SOS Load Test — 1,000 Concurrent Workers

Sprint 34, Brecha D (E2E load coverage).

## Why this exists

Praeventio Guard is an emergency-response system. A regional disaster
(earthquake, mass casualty, evacuation) realistically produces hundreds
to thousands of simultaneous SOS pushes. If even one alert is dropped,
the cost is human life. Pre-Sprint-34 we had unit tests and Playwright
E2E coverage of the happy path, but no reproducible drill against the
actual write throughput of `POST /api/emergency/sos`.

This document specifies the load test, its acceptance criteria, and how
to run it.

## What is exercised

- Express server in `E2E_MODE=1` (auth bypass via `E2E <secret>:<uid>`)
- Firestore emulator (`firestore` only) for `projects/*` membership and
  `tenants/*/emergency_alerts/*` persistence
- Per-uid rate limiter (`sosLimiter`, 10/min). Each VU uses a unique
  uid, so no VU should hit the limiter — failures here are real
  failures, not throttling artefacts.

Out of scope (intentionally, this sprint):

- Real FCM dispatch — the emulator does not run FCM. Push fan-out is
  exercised by unit tests on `notify-brigada` and the SOS handler.
- KMS, Sentry, Resend email fallback. All three are stubbed by the
  test secret / missing-env paths.

## Files

- `loadtest/sos-1000-concurrent.yml` — Artillery scenario.
- `loadtest/sos-processor.cjs` — assigns a unique uid per VU.
- `loadtest/seed-and-assert.cjs` — seeds project membership; asserts
  emergency_alerts count post-run.
- `loadtest/run.sh` — orchestrates emulator + server + Artillery.
- `loadtest/Dockerfile` — Linux container for hosts where bash trap
  semantics misbehave (notably native Windows).

## Acceptance criteria

| Metric | Threshold | Rationale |
| --- | --- | --- |
| **Persistence** | exactly **1000 / 1000** docs in `tenants/load-test-project/emergency_alerts` | Zero loss. SOS is not retry-safe at the human layer. |
| **p95 latency** | **< 800 ms** (request → response, fan-out included) | A worker pressing SOS expects a confirmation tick within ~1 s. |
| **p99 latency** | **< 1500 ms** (informational) | Surfaces tail-latency from Firestore emulator queues. |
| **Error rate** | **< 1 %** | Honest workers with unique uids should never see 429. Any 5xx is a defect. |
| **Rate-limit hits** | **0 expected** | Each VU has its own uid. Any 429 means the limiter is misconfigured. |

> If `p95 >= 800 ms` or any non-zero loss is observed, file a Sprint-35
> P0: investigate Firestore Admin SDK batching (consider `BulkWriter`)
> and FCM multicast saturation.

## Running

### Linux / macOS / WSL

```bash
npm install
bash loadtest/run.sh
```

The script writes timestamped reports to `loadtest/reports/`:

- `sos-1k-<ts>.json` — Artillery raw stats.
- `sos-1k-<ts>.html` — Artillery HTML report.
- `emulator-<ts>.log`, `server-<ts>.log` — process logs.

### Native Windows (PowerShell or cmd)

bash trap/kill on native Windows is unreliable; orphan node processes
can persist. **Run via Docker** instead:

```powershell
docker build -f loadtest/Dockerfile -t praeventio-loadtest .
docker run --rm -v "${PWD}:/repo" -w /repo praeventio-loadtest
```

Or use Git Bash / WSL accepting the caveat.

### npm script

```bash
npm run loadtest:sos    # equivalent to `bash loadtest/run.sh`
```

The script is intentionally **not** wired into PR CI (cost). It runs
on-demand or via the manually-dispatched workflow
`.github/workflows/loadtest.yml`.

## CI

`.github/workflows/loadtest.yml` is `workflow_dispatch` only. It
installs the dependencies, runs `bash loadtest/run.sh`, and uploads the
HTML report as an artifact named `sos-loadtest-report`.

## Known limitations

- The emulator does not model FCM. Persistence + handler latency are
  what's measured; fan-out latency is approximated by the in-process
  multicast call.
- No KMS round-trip — alert payloads are not encrypted at rest in the
  emulator. Production-shaped latency for that path is covered
  separately by `kmsEnvelope` micro-benchmarks.
- The 10s ramp deliberately sustains ~100 RPS peak. Steeper bursts
  (e.g., 1000 in 1s) should be added in a follow-up sprint once we
  decide on the realistic burst profile from the field.
