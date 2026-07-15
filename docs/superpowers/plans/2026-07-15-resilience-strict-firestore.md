# Strict Firestore Resilience Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the maintenance resilience cron treats a lone critical Firestore outage as globally critical and hands the report to the existing operations notification hook.

**Architecture:** Add an optional aggregation policy to the resilience alert job and forward it unchanged to `buildResilienceHealthReport`. Configure only the maintenance route with `strict`, preserving the monitor's existing `slm_priority` default for every caller that does not opt in.

**Tech Stack:** TypeScript, Express, Vitest, Firebase Admin Firestore, existing resilience health monitor and FCM adapter.

## Global Constraints

- Preserve all existing features and notification delivery behavior.
- Do not change the monitor's default `slm_priority` aggregation policy.
- Keep the separate FCM delivery-marker debt out of this PR.
- Prove each production change with a failing test before implementation.
- Keep policy selection explicit and auditable at the maintenance composition root.

---

### Task 1: Propagate the aggregation policy through the alert job

**Files:**
- Modify: `src/server/jobs/runResilienceHealthAlert.ts`
- Test: `src/server/jobs/runResilienceHealthAlert.test.ts`

**Interfaces:**
- Consumes: `MonitorOptions['overallPolicy']` and `buildResilienceHealthReport(checkers, options)` from `src/services/observability/resilienceHealthMonitor.ts`.
- Produces: `ResilienceHealthAlertDeps.overallPolicy?: MonitorOptions['overallPolicy']`, forwarded to the monitor without introducing a new default.

- [ ] **Step 1: Write the failing end-to-end job test**

Add this case inside `describe('runResilienceHealthAlertCron', ...)`:

```ts
it('strict: una caída aislada de Firestore es crítica y notifica a operaciones', async () => {
  const { db, writes } = buildFakeDb();
  const notifyOps = vi.fn().mockResolvedValue(undefined);

  const result = await runResilienceHealthAlertCron({
    db,
    now: fixedNow,
    overallPolicy: 'strict',
    notifyOps,
    checkers: {
      firestore: criticalChecker('firestore'),
      network: healthyChecker('network'),
    },
  });

  expect(result.overallStatus).toBe('critical');
  expect(result.report.subsystems).toContainEqual(
    expect.objectContaining({ id: 'firestore', status: 'critical' }),
  );
  expect(notifyOps).toHaveBeenCalledTimes(1);
  expect(notifyOps).toHaveBeenCalledWith(
    expect.objectContaining({ overallStatus: 'critical' }),
  );
  expect(
    writes.filter((write) => write.path.startsWith('health_alerts/')),
  ).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test -- src/server/jobs/runResilienceHealthAlert.test.ts --reporter=dot`

Expected: FAIL because the runtime currently ignores `overallPolicy` and the default `slm_priority` aggregation returns `degraded`, so `notifyOps` and the critical alert marker are not reached.

- [ ] **Step 3: Add the minimal policy pass-through**

Change the monitor import and dependency contract:

```ts
import {
  buildResilienceHealthReport,
  type MonitorOptions,
  type ResilienceCheckers,
  type ResilienceHealthReport,
} from '../../services/observability/resilienceHealthMonitor.js';

export interface ResilienceHealthAlertDeps {
  // existing fields remain unchanged
  /** Política de agregación; si se omite, el monitor conserva su default. */
  overallPolicy?: MonitorOptions['overallPolicy'];
}
```

Forward it in the existing monitor call:

```ts
const report = await buildResilienceHealthReport(deps.checkers, {
  nowMs: () => now().getTime(),
  checkerTimeoutMs: deps.checkerTimeoutMs,
  overallPolicy: deps.overallPolicy,
});
```

- [ ] **Step 4: Run the test to verify GREEN**

Run: `npm run test -- src/server/jobs/runResilienceHealthAlert.test.ts --reporter=dot`

Expected: PASS, including the new strict-policy case and every pre-existing job case.

- [ ] **Step 5: Commit the independently testable job change**

```bash
git add src/server/jobs/runResilienceHealthAlert.ts src/server/jobs/runResilienceHealthAlert.test.ts
git commit -m "fix(resilience): propagate alert aggregation policy"
```

### Task 2: Require strict aggregation at the maintenance composition root

**Files:**
- Modify: `src/server/routes/maintenance.ts`
- Test: `src/__tests__/server/maintenance.test.ts`

**Interfaces:**
- Consumes: `ResilienceHealthAlertDeps.overallPolicy` from Task 1.
- Produces: the maintenance scheduler invocation with `overallPolicy: 'strict'`; the existing `notifyOps(report)` callback remains the sole FCM handoff.

- [ ] **Step 1: Write the failing route wiring test**

Add this case in `describe('POST /api/maintenance/check-overdue', ...)` after the successful authorized case:

```ts
it('200 — ejecuta resilience-health con agregación estricta', async () => {
  const res = await request(buildApp())
    .post(URL)
    .set('Authorization', AUTH)
    .send();

  expect(res.status).toBe(200);
  expect(H.runResilienceHealthAlertCron).toHaveBeenCalledWith(
    expect.objectContaining({ overallPolicy: 'strict' }),
  );
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test -- src/__tests__/server/maintenance.test.ts --reporter=dot`

Expected: FAIL because the route currently omits `overallPolicy` even though its documented intent is strict aggregation.

- [ ] **Step 3: Configure the route explicitly**

Add the policy next to the checker timeout in the existing invocation:

```ts
checkerTimeoutMs: 4_000,
overallPolicy: 'strict',
notifyOps: async (report) => {
```

- [ ] **Step 4: Run the route test to verify GREEN**

Run: `npm run test -- src/__tests__/server/maintenance.test.ts --reporter=dot`

Expected: PASS, including the existing test that proves a critical report reaches `fcmAdapter.sendToTokens` for admin tokens.

- [ ] **Step 5: Commit the explicit maintenance policy**

```bash
git add src/server/routes/maintenance.ts src/__tests__/server/maintenance.test.ts
git commit -m "fix(maintenance): require strict resilience alerts"
```

### Task 3: Verify compatibility and release evidence

**Files:**
- Verify: `src/services/observability/resilienceHealthMonitor.test.ts`
- Verify: `src/__tests__/server/runResilienceHealthAlert.test.ts`
- Verify: all files modified in Tasks 1 and 2

**Interfaces:**
- Consumes: the completed policy propagation and route wiring.
- Produces: reproducible test, lint, typecheck, build, Graphify, and PR evidence.

- [ ] **Step 1: Run the focused regression suite**

Run: `npm run test -- src/server/jobs/runResilienceHealthAlert.test.ts src/__tests__/server/runResilienceHealthAlert.test.ts src/__tests__/server/maintenance.test.ts src/services/observability/resilienceHealthMonitor.test.ts --reporter=dot`

Expected: all four files pass; existing expected warning logs remain baseline-only.

- [ ] **Step 2: Run static checks on the affected boundary**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npx eslint src/server/jobs/runResilienceHealthAlert.ts src/server/jobs/runResilienceHealthAlert.test.ts src/server/routes/maintenance.ts src/__tests__/server/maintenance.test.ts`

Expected: exit code 0.

- [ ] **Step 3: Build with the repository's canonical Android fingerprint**

Run in PowerShell:

```powershell
$env:ANDROID_CERT_SHA256='3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0'
npm.cmd run build
```

Expected: production build exits 0 without creating intentional source changes.

- [ ] **Step 4: Refresh Graphify and inspect the final dependency path**

Run: `graphify update .`

Expected: the graph refresh succeeds and source inspection still resolves `maintenance.ts -> runResilienceHealthAlertCron -> buildResilienceHealthReport`, with notification handed to the existing `notifyOps` callback.

- [ ] **Step 5: Review, publish, and update tracking**

Confirm `git diff origin/main...HEAD --check`, inspect the complete diff, push `codex/resilience-strict-firestore`, open a draft PR, and move Notion page `39baa66d73fe81acb5c9f2312f3093b4` to `Review` with the PR URL and exact verification commands.
