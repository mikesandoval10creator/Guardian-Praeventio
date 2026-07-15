# Strict Firestore Resilience Alert Design

## Context

The maintenance route describes its server-side resilience check as `strict`, but the route does not pass a policy to `runResilienceHealthAlertCron`. The job then calls `buildResilienceHealthReport` without `overallPolicy`, so the monitor uses its `slm_priority` default.

The server cron measures Firestore and network directly. All other subsystems are absent and therefore reported as `unknown`. Under `slm_priority`, one critical Firestore result becomes only `degraded`; the job emits notifications only for `critical`, so a real Firestore outage can avoid the operations alert.

## Goal

Allow the resilience alert job to receive an explicit aggregation policy and configure the maintenance cron with `strict`, making one critical Firestore result produce a critical global report and invoke the existing operations notification path.

## Non-goals

- Do not change the monitor's `slm_priority` default for UI or other consumers.
- Do not change Firestore ping behavior, FCM recipient discovery, report persistence, or daily idempotency.
- Do not address the separate Notion task about distinguishing attempted and delivered notifications.
- Do not add new collections, routes, dependencies, or user-facing copy.

## Considered approaches

### 1. Propagate an explicit policy through the job (selected)

Add `overallPolicy?: MonitorOptions['overallPolicy']` to `ResilienceHealthAlertDeps`, pass it to `buildResilienceHealthReport`, and set `overallPolicy: 'strict'` in `maintenance.ts`.

This keeps the monitor default compatible, makes caller intent auditable, and supports future server jobs with different policies without duplicating aggregation logic.

### 2. Make the job globally strict

Hard-code `strict` inside `runResilienceHealthAlertCron`. This is smaller but silently changes all present and future job callers and makes the dependency contract misleading. It is rejected because the monitor already supports multiple policies deliberately.

### 3. Special-case Firestore after aggregation

Override `degraded` to `critical` in the maintenance route when the Firestore subsystem is critical. This duplicates policy logic outside the pure monitor and risks drift when subsystem rules evolve. It is rejected.

## Interfaces and data flow

`ResilienceHealthAlertDeps` gains one optional property:

```ts
overallPolicy?: MonitorOptions['overallPolicy'];
```

The job forwards it without inventing a new default:

```ts
const report = await buildResilienceHealthReport(deps.checkers, {
  nowMs: () => now().getTime(),
  checkerTimeoutMs: deps.checkerTimeoutMs,
  overallPolicy: deps.overallPolicy,
});
```

The maintenance route supplies:

```ts
overallPolicy: 'strict',
```

The resulting production flow is:

1. The scheduler invokes `/api/maintenance/check-overdue`.
2. The Firestore checker reports `critical` when its canonical read fails.
3. The network checker reports `healthy`; unconfigured client-only checkers report `unknown`.
4. `strict` aggregation returns global `critical` because at least one subsystem is critical.
5. The existing job persists the report, checks daily idempotency, and calls `notifyOps`.
6. The existing maintenance callback resolves admin FCM tokens and sends the critical alert.

## Error handling and compatibility

- Omitting `overallPolicy` preserves the existing `slm_priority` default.
- Invalid policies remain prevented by TypeScript through reuse of `MonitorOptions`.
- Checker timeouts, persistence failures, notification failures, and idempotency retain their existing behavior.
- This task treats `notifyOps` invocation as the alert handoff; delivery-state semantics remain owned by the separate task already present in Notion.

## Testing strategy

Two layers prove the complete contract:

- Route wiring test: an authenticated maintenance request must call `runResilienceHealthAlertCron` with `overallPolicy: 'strict'`.
- Real job integration test: only Firestore is critical, network is healthy, other subsystems are unconfigured; with `strict`, the report must be globally critical, `notifyOps` must receive that report, and the alert marker must be written.
- Compatibility test: existing job tests that omit the policy must keep their current results.
- Existing monitor policy tests remain the proof that `strict` aggregation classifies one critical subsystem correctly.

## Acceptance criteria

- The maintenance cron passes `overallPolicy: 'strict'` explicitly.
- `runResilienceHealthAlertCron` forwards the selected policy to the monitor.
- A lone critical Firestore result yields `overallStatus: 'critical'` despite unknown client-only subsystems.
- The same run invokes `notifyOps` once with a critical report and persists the daily alert marker.
- Existing callers that omit the policy remain compatible.
