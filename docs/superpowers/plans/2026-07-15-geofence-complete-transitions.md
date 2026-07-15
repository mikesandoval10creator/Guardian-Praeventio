# Complete Geofence Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each successful geofence evaluation expose an auditable previous/current transition so entry, isolated exit, multizone changes, direct crossings, and removed-zone exits are emitted correctly.

**Architecture:** `useGeofence` remains the single owner of polygon evaluation and membership history. It will append a backward-compatible third callback argument containing previous/current ID sets plus entered/exited zone objects; `useGeofenceWithEvents` will consume that transition directly instead of reconstructing state.

**Tech Stack:** React 19 hooks, TypeScript, Turf polygon predicates, Vitest 4, Testing Library `renderHook`.

## Global Constraints

- Preserve existing callbacks that consume only `(activeZones, position)`.
- Preserve GPS watcher lifecycle, sampling options, polygon evaluation, alarms, permissions, and event payload schemas.
- Preserve `onZoneEntry` and emit entries before exits during a direct crossing.
- Add no dependency and perform no unrelated refactor.
- Follow strict RED -> GREEN -> REFACTOR with tests that exercise real hook behavior where practical.

---

### Task 1: Produce complete transitions in `useGeofence`

**Files:**
- Modify: `src/hooks/useGeofence.ts:115-220`
- Test: `src/hooks/useGeofence.transitions.test.tsx:1-88`

**Interfaces:**
- Consumes: `GeofenceZone[]`, browser geolocation observations, and the existing optional callback.
- Produces: exported `GeofenceTransition` and callback signature `(activeZones, position, transition) => void`.

- [ ] **Step 1: Extend the real-hook tests with the desired transition contract**

Add assertions against the third callback argument and fixtures for adjacent/overlapping zones. The direct-crossing assertion must use this shape:

```ts
expect(onZonesChanged).toHaveBeenLastCalledWith(
  [ZONE_B, OVERLAP_ZONE],
  { lat: -33.5, lng: -69.5 },
  expect.objectContaining({
    previousZoneIds: new Set(['zone-a', 'overlap']),
    currentZoneIds: new Set(['zone-b', 'overlap']),
    enteredZones: [ZONE_B],
    exitedZones: [ZONE_A],
  }),
);
```

Add a configuration-removal case that enters `ZONE_A`, rerenders the hook with `zones: []`, sends the next GPS observation, and expects `exitedZones: [ZONE_A]` even though the current configuration no longer contains it.

- [ ] **Step 2: Run the focused transition suite and verify RED**

Run:

```bash
npm run test -- src/hooks/useGeofence.transitions.test.tsx --reporter=dot
```

Expected: failure because the third callback argument is absent and the removed-zone exit has no retained zone object.

- [ ] **Step 3: Implement the transition at the polygon-evaluation boundary**

Export the exact contract:

```ts
export interface GeofenceTransition {
  previousZoneIds: ReadonlySet<string>;
  currentZoneIds: ReadonlySet<string>;
  enteredZones: readonly GeofenceZone[];
  exitedZones: readonly GeofenceZone[];
}
```

Replace the ID-only membership ref with a zone-object snapshot. On each observation compute the transition before updating the ref:

```ts
const previousZones = insideZonesRef.current;
const previousZoneIds = new Set(previousZones.map((zone) => zone.id));
const currentZoneIds = new Set(insideZones.map((zone) => zone.id));
const enteredZones = insideZones.filter((zone) => !previousZoneIds.has(zone.id));
const exitedZones = previousZones.filter((zone) => !currentZoneIds.has(zone.id));
insideZonesRef.current = insideZones;

const transition: GeofenceTransition = {
  previousZoneIds,
  currentZoneIds,
  enteredZones,
  exitedZones,
};
```

Use `enteredZones` for the existing alarm condition and invoke `onZonesChangedRef.current?.(insideZones, observedPosition, transition)`.

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run the command from Step 2. Expected: all tests in `useGeofence.transitions.test.tsx` pass.

- [ ] **Step 5: Run the low-level geofence regression tests**

Run:

```bash
npm run test -- src/hooks/useGeofence.test.ts src/hooks/useGeofence.transitions.test.tsx --reporter=dot
```

Expected: both files pass with no regression in permissions, watcher cleanup, alarms, or geometry hashing.

- [ ] **Step 6: Commit the low-level transition contract**

```bash
git add src/hooks/useGeofence.ts src/hooks/useGeofence.transitions.test.tsx
git commit -m "fix(geofence): expose complete zone transitions"
```

### Task 2: Consume authoritative transitions in the event wrapper

**Files:**
- Modify: `src/hooks/useGeofenceWithEvents.ts:12-67`
- Test: `src/hooks/useGeofenceWithEvents.test.ts:11-126`

**Interfaces:**
- Consumes: `GeofenceTransition` supplied by `useGeofence`.
- Produces: exactly-once `geofence_crossed` enter/exit events and the unchanged `onZoneEntry(enteredZones)` callback.

- [ ] **Step 1: Update wrapper tests to inject explicit transitions**

Extend the captured callback to accept `GeofenceTransition`. Add a helper:

```ts
function transition(
  previousIds: string[],
  currentIds: string[],
  enteredZones: ReturnType<typeof zone>[],
  exitedZones: ReturnType<typeof zone>[],
): GeofenceTransition {
  return {
    previousZoneIds: new Set(previousIds),
    currentZoneIds: new Set(currentIds),
    enteredZones,
    exitedZones,
  };
}
```

Update existing entry, stable-membership, and exit cases to provide the matching transition. Add a direct A-to-B case expecting two emits in current-compatible order (`enter` B, then `exit` A), and add a removed-zone case where the wrapper's current `zones` array is empty but `exitedZones` still contains A.

- [ ] **Step 2: Run the wrapper suite and verify RED**

Run:

```bash
npm run test -- src/hooks/useGeofenceWithEvents.test.ts --reporter=dot
```

Expected: the removed-zone test fails because the current wrapper searches only its current `zones` prop, and the transition argument is not consumed.

- [ ] **Step 3: Replace duplicated wrapper state with the authoritative transition**

Remove `insideRef` and the current-zone lookup. Import `GeofenceTransition` and define the wrapper callback as:

```ts
(
  _activeZones: GeofenceZone[],
  position: GeofencePosition,
  transition: GeofenceTransition,
) => {
  for (const zone of transition.enteredZones) {
    void emitGeofenceCrossed(zone, 'enter', opts, position).catch(/* existing log */);
  }
  for (const zone of transition.exitedZones) {
    void emitGeofenceCrossed(zone, 'exit', opts, position).catch(/* existing log */);
  }
  if (transition.enteredZones.length > 0) {
    onEntryRef.current?.([...transition.enteredZones]);
  }
}
```

Keep the existing event payload and logging messages unchanged.

- [ ] **Step 4: Run the wrapper suite and verify GREEN**

Run the command from Step 2. Expected: all entry, stable, isolated exit, direct crossing, removed-zone, and optional-coordinate cases pass.

- [ ] **Step 5: Run all focused geofence tests**

```bash
npm run test -- src/hooks/useGeofence.test.ts src/hooks/useGeofence.transitions.test.tsx src/hooks/useGeofenceWithEvents.test.ts src/components/emergency/GeofenceAlert.test.tsx --reporter=dot
```

Expected: all four files pass.

- [ ] **Step 6: Commit the wrapper integration**

```bash
git add src/hooks/useGeofenceWithEvents.ts src/hooks/useGeofenceWithEvents.test.ts
git commit -m "fix(geofence): emit authoritative crossing transitions"
```

### Task 3: Verify and publish the complete change

**Files:**
- Verify: all files changed since `origin/main`
- Update externally: Notion task `39baa66d73fe81cdabb2ec9f52ba1ff3`

**Interfaces:**
- Consumes: completed commits from Tasks 1 and 2.
- Produces: a scoped draft PR against `main` and a Notion task in `Review` linked to that PR.

- [ ] **Step 1: Run static verification**

```bash
npm run typecheck
npx eslint src/hooks/useGeofence.ts src/hooks/useGeofence.transitions.test.tsx src/hooks/useGeofenceWithEvents.ts src/hooks/useGeofenceWithEvents.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 2: Run focused behavioral verification**

```bash
npm run test -- src/hooks/useGeofence.test.ts src/hooks/useGeofence.transitions.test.tsx src/hooks/useGeofenceWithEvents.test.ts src/components/emergency/GeofenceAlert.test.tsx --reporter=dot
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Vite build exits 0 without bundle errors.

- [ ] **Step 4: Audit scope and diff**

```bash
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
```

Expected: only the design, plan, two hooks, and their transition tests are changed; the worktree is clean.

- [ ] **Step 5: Push and create the draft PR**

Push `codex/geofence-complete-transitions`, create a draft PR targeting `main`, and include root cause, behavior, compatibility, tests, typecheck, lint, and build evidence in the body.

- [ ] **Step 6: Update Notion**

Set `Status` to `Review`, set `PR` to the created PR URL, and replace `Verify cmd` with the exact focused test command plus `npm run typecheck` and `npm run build`.
