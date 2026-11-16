# Bounded local fire-propagation worker

Notion scope (live rows revalidated):
- `3c2aa66d-73fe-8189-bb91-d0e9340c6ae1` — tMax without an upper bound.
- `3c2aa66d-73fe-81d1-8879-c568c2d62e20` — synchronous simulateFireSpread on the UI thread.

Both rows describe the same execution boundary. The broader simulator/LLM test-debt row is not closed by this change.

## Execution contract

The training view visibly clamps its horizon to **1–240 minutes**, with a finite default for invalid numeric state. This is an explicit local compute budget, not a physical fire limit or safety certification. The client and worker independently reject out-of-range/nonfinite requests before entering Euler. The worker fixes the step at `0.25`; an extra request field cannot override it. The resulting timeline is bounded to at most 961 points.

`EmergencySimulator` no longer calls `simulateFireSpread` synchronously. A dedicated worker is created per request and terminated on success, error, explicit cancellation, close while running, parameter/project change, unmount or a five-second deadline. The client removes listeners/timers on every terminal path. No synchronous fallback is used if workers are unavailable.

The UI shows indeterminate progress (not a fabricated completion percentage), a cancel control and actionable timeout/error text. Late/cancelled replies do not render a chart under a different context. Nonfinite/invalid results cannot reach the SVG. Closing a completed view retains its valid result; it is not falsely labelled cancelled. No emergency is dispatched by the calculation; the existing explicit real-emergency action is preserved and its caller regression test remains passing.

No model coefficients, Euler integration code, emergency thresholds, Firestore data, LLM prompts, account permissions or dispatch pipeline are changed. Parameters are only local simulation numbers; the worker performs no network requests or persistence.

## Executed behavioral evidence

RED was observed for the visible horizon accepting 10000, missing owned worker execution, and a never-answering worker remaining pending after five seconds. GREEN followed each corresponding slice. An intermediate JSX parenthesis error was fixed and is not treated as behavioral RED.

Canonical Vite+ tests exercise the real client/worker handler/model, UI with controlled worker transport and existing Euler/escalation behavior. They cover bounded/fractional horizons, fixed-step integrity, nonfinite inputs/output, actual numerical-output preservation, worker completion/error/unavailability, cancellation, deadline, cleanup, late replies and context changes. These fixtures are not production emergency-delivery evidence.

## Real browser / production-bundle probe

An isolated Vite production entry imported the actual client/protocol/Euler modules and emitted the real worker asset. A disposable **headless Chrome** profile ran that bundle through an owned loopback-only HTTP server. Observed result:

```json
{"requested":10000,"rawError":"invalid","createdAfterRaw":0,"horizon":240,"points":961,"lastT":240,"created":1,"terminated":1,"ticksWhileWaiting":5,"elapsedMs":6.399999976158142,"identicalToReference":true}
```

The browser reported no page errors and its DOM reached `finished`. The five heartbeat ticks were counted before the worker reply, and the numeric result exactly matched the reference Euler call. The raw oversized client request created no worker. The server, disposable browser profile and temporary bundle were closed/removed afterward. Raw local evidence: Hermes scratch `fire-worker-browser-proof.json`; probe source `fire-worker-browser-probe.mjs` (local evidence, not a committed CI harness).

This proves that the actual worker transport and isolated production bundling work on this Chrome installation; it is not a full app production build/browser E2E, low-end-device benchmark, Android/OEM test, runtime delivery claim or deployment. The measured elapsed time is not an SLA or a before/after comparison. Historical claims of minutes of freezing were not reproduced by intentionally hanging a real browser.

The existing app PWA configuration includes JavaScript assets in its precache glob; no cache policy is changed. Offline mobile behavior is not newly claimed as physically tested. Full-head TypeScript/build checks remain required CI gates; another multi-GB local typecheck was not run during this slice.
