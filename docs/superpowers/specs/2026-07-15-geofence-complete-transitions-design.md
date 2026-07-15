# Complete Geofence Transitions Design

## Context

The original defect reported in Notion was partially fixed by PR #1256: `useGeofence` now invokes its callback for every evaluated GPS position, including a position outside all zones. That makes a simple exit observable, but the callback still exposes only the current active zones. `useGeofenceWithEvents` reconstructs previous state independently and therefore does not receive an auditable transition snapshot from the component that actually evaluated the polygons.

The remaining acceptance criteria are to expose previous and current membership, prove entry and exit behavior across multiple zones, and prove a direct crossing from one zone to another. The design must preserve existing callers and all current geofence capabilities.

## Goals

- Make every evaluated geofence tick carry an explicit previous/current transition.
- Preserve the existing `(activeZones, position)` callback contract for callers that ignore the new data.
- Give the event wrapper the exact entered and exited zone objects computed by the low-level hook.
- Emit an exit even when an active zone is removed from the supplied zone configuration.
- Cover entry, isolated exit, overlapping/multiple zones, and direct A-to-B crossings with deterministic tests.

## Non-goals

- Do not change GPS watcher lifecycle, sampling options, polygon evaluation, alarms, permissions, or event payload schemas.
- Do not combine this work with the separate task about sharing watchers between tracking and geofencing.
- Do not remove or rename the existing `onZoneEntry` callback exposed by `useGeofenceWithEvents`.

## Public contract

`useGeofence.ts` will export a transition type:

```ts
export interface GeofenceTransition {
  previousZoneIds: ReadonlySet<string>;
  currentZoneIds: ReadonlySet<string>;
  enteredZones: readonly GeofenceZone[];
  exitedZones: readonly GeofenceZone[];
}
```

The existing callback gains a third argument:

```ts
(
  activeZones: GeofenceZone[],
  position: GeofencePosition,
  transition: GeofenceTransition,
) => void
```

JavaScript callers and TypeScript callbacks declaring only the first one or two parameters remain valid because extra arguments can be ignored. The first two arguments keep their existing meaning.

## State and data flow

`useGeofence` will retain the previous active zone objects, not only their IDs. On every successful GPS observation it will:

1. Evaluate the current polygons exactly as it does today.
2. Build previous and current ID sets.
3. Derive `enteredZones` from current zones absent from the previous set.
4. Derive `exitedZones` from previous zone objects absent from the current set.
5. Update the retained snapshot only after the transition is complete.
6. Play the alarm only when `enteredZones` is non-empty, preserving current behavior.
7. Invoke the callback for every evaluated tick with active zones, observed position, and the complete transition.

Retaining previous objects ensures an exit still contains the original zone metadata if that zone was removed from the current configuration before the next GPS fix.

`useGeofenceWithEvents` will stop maintaining a second membership state. It will emit `enter` events from `transition.enteredZones`, emit `exit` events from `transition.exitedZones`, and forward only entered zones to the existing optional `onZoneEntry` callback. Event order remains entries first and exits second to avoid changing current direct-crossing behavior.

## Error handling and invariants

- Invalid polygons remain ignored by the existing per-zone `try/catch`.
- Event emission remains non-blocking; each failed emit is logged without preventing other transition events.
- Repeated GPS ticks with unchanged membership contain empty entered/exited arrays and emit no bus events.
- A watcher resubscription caused by zone configuration changes must not erase the retained previous membership.
- Permission and geolocation errors retain their existing behavior.

## Testing strategy

Tests will exercise real transition calculation in `useGeofence` and event consumption in `useGeofenceWithEvents`:

- Entry: previous set empty, current set contains A, entered contains A.
- Isolated exit: previous contains A, current is empty, exited contains A, callback fires with the outside position.
- Multiple/overlapping zones: membership can add or remove one zone while another remains active without duplicate events.
- Direct crossing: previous contains A, current contains B, entered contains B and exited contains A in the same callback.
- Configuration removal: removing active A and receiving the next fix produces an exit carrying A's retained metadata.
- Stable membership: no repeated entry or exit event.

The focused geofence suites, TypeScript checking, ESLint on touched source/tests, and the production build are required before publishing the PR.

## Acceptance criteria

- Every successful geofence evaluation reports previous/current ID sets and entered/exited zone objects.
- Leaving a zone without entering another invokes the callback and emits one `geofence_crossed: exit` event.
- Direct A-to-B movement produces both transitions exactly once from one observation.
- Multiple-zone membership changes do not duplicate unchanged zones.
- Removing an occupied zone from configuration does not suppress its exit.
- Existing two-argument callbacks and `onZoneEntry` behavior remain compatible.
