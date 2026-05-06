# SystemEngine

A typed reactive bus for cross-domain coordination in Guardian Praeventio.

## What it is

A thin layer that sits between the existing 11 React contexts (Firebase,
Project, Subscription, Sensor, Emergency, Notification, UniversalKnowledge,
Theme, Language, Normative, AppMode) and the rest of the app. It provides:

1. A **typed event schema** (Zod discriminated union) for the events that
   matter cross-domain.
2. An **EventLog** with online → Firestore + offline → IndexedDB fallback.
3. A **policy registry**: small pure functions that map an event to a
   list of actions.
4. An **executor** that dispatches actions to the existing service
   surfaces (triggerEmergency, addNotification, audit log, FCM…).

## What it is NOT

- Not a replacement for the React contexts. They still own their state.
- Not a new in-memory pub/sub. The bus is **Firestore**: writes to
  `tenants/{tid}/system_events` are emits, `onSnapshot` queries are
  subscriptions. This gives multi-instance fan-out, offline buffering,
  server↔client crossing, and persistence for free.
- Not a re-implementation of the Eulerian Zettelkasten analyzer
  (`services/euler/*` already does that). The SystemEngine consumes the
  metrics and emits health-change events.
- Not a replacement for `services/slm/offlineQueue` or `services/mesh/*`.
  The offline outbox is a thin separate IDB store. Offline-resilience for
  emergency events still flows through the mesh fallback in
  `EmergencyContext`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       SystemEngine                          │
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐         │
│  │ EventLog │ → │Subscriber│ → │  DecisionEngine  │         │
│  │ (FS+IDB) │   │ (React)  │   │ (policies → acts)│         │
│  └──────────┘   └──────────┘   └──────────────────┘         │
│        │                              │                     │
│        ▼                              ▼                     │
│  ┌──────────┐                   ┌──────────┐                │
│  │ Outbox   │                   │ Executor │                │
│  │ (IDB)    │                   │          │                │
│  └──────────┘                   └──────────┘                │
└─────────────────────────────────────────────────────────────┘
        ▲                              │
        │ adapter                      │ trigger / addNotif /
        │                              │ audit / FCM
┌───────┴───────────────────────────────┴────────────────────┐
│  EmergencyContext, SubscriptionContext, SensorContext,     │
│  NotificationContext, ProjectContext, UniversalKnowledge,  │
│  NormativeContext, AppModeContext, FirebaseContext,        │
│  ThemeContext, LanguageProvider                            │
└────────────────────────────────────────────────────────────┘
```

## How to add a new event type

1. Add the payload schema and the discriminated-union arm in
   [`eventTypes.ts`](./eventTypes.ts).
2. Add the type literal to `ALL_EVENT_TYPES`.
3. (optional) Add an adapter in [`adapters/`](./adapters/) that emits the
   event when the source context state changes.
4. (optional) Add a [`policy`](./policies/) that consumes the event and
   produces actions.

## How to add a policy

1. Create a `Policy<EventType>` in [`policies/`](./policies/).
2. Register it via `registerPolicy(yourPolicy)`. The
   `SystemEngineProvider` registers default policies on first mount.
3. Add a unit test in
   [`__tests__/policies/`](./__tests__/policies/).

A policy should be a **pure function** of `(event, context) → Action[]`.
Side effects belong in the executor.

## Existing policies

| Policy | Trigger | What it does |
|---|---|---|
| `geofenceToSos` | `geofence_crossed` (enter into HAZMAT/RESTRICTED) | `triggerEmergency`, notify contacts, audit. Closes the orphan flow where useGeofence fired alarms but never escalated to SOS. |
| `tierChangeReactivity` | `tier_changed` | Invalidate subscription context, refresh feature flags, notify user, audit. Closes the orphan flow where webhook upgrades did not invalidate the running React session. |

## Event types

| Type | Payload (key fields) | Producer |
|---|---|---|
| `fall_detected` | workerId, projectId, confidence, accelMagnitude | FallDetectionMonitor (next iteration) |
| `sos_triggered` | workerId, projectId, emergencyType, origin | EmergencyContext adapter (live) |
| `geofence_crossed` | workerId, projectId, zoneId, zoneType, direction | useGeofenceWithEvents |
| `countdown_expired` | workerId, projectId, context | (placeholder) |
| `node_created` | nodeId, projectId, nodeType, severity | (placeholder) |
| `node_linked` | sourceId, targetId, projectId | (placeholder) |
| `normative_updated` | normativeId, jurisdiction | NormativeContext adapter (placeholder) |
| `tier_changed` | userId, fromTier, toTier, source | SubscriptionContext adapter (live) |
| `entitlement_revoked` | userId, reason | (placeholder) |
| `weather_alert` | projectId, kind, value, unit | UniversalKnowledge adapter (placeholder) |
| `seismic_event` | magnitude, depthKm, lat, lng, timestampMs | UniversalKnowledge adapter (placeholder) |
| `zettelkasten_health_changed` | projectId, score, components, cycles, hasEulerianPath, hasEulerianCycle | `zettelkasten/healthEvent.ts` |
| `audit_log_appended` | action, actorUid, resourceId, result | (placeholder) |

## Mounting the engine

In your top-level provider tree:

```tsx
import { SystemEngineProvider } from './contexts/SystemEngineProvider';

<EmergencyProvider>
  <SubscriptionProvider>
    <NotificationProvider>
      <SystemEngineProvider tenantId={tenantId} enabled={true}>
        <App />
      </SystemEngineProvider>
    </NotificationProvider>
  </SubscriptionProvider>
</EmergencyProvider>
```

The `enabled` prop is the master kill-switch. Default is `true`.

## Offline behaviour

`emit()` is hybrid:

- **Online** → write to `tenants/{tid}/system_events` and mirror to
  `audit_logs` via the existing `/api/audit-log` endpoint.
- **Offline** → enqueue in IndexedDB store `system_events_outbox` (DB
  `praeventio-systemengine`). The `SystemEngineProvider` listens for the
  `online` event and calls `drainOutbox()` to flush.

Idempotency is enforced via a 1-hour ring buffer on
`event.idempotencyKey`. Replay-safe.

The outbox is intentionally separate from `services/slm/offlineQueue`
which has its own HMAC + reconciliation contract for SLM sessions.

## Server-side wiring

- `src/server/triggers/systemEngineTrigger.ts` — Firebase Admin
  `collectionGroup('system_events').onSnapshot` listener mounted in
  `server.ts`. Cleanup hooked into SIGTERM. Server-only side effects
  (e.g. server-side policies that need admin SDK) plug into the
  `onEvent` callback.
- `src/server/routes/systemEvents.ts` — `POST /api/system-events/emit`
  with `verifyAuth + idempotencyKey + Zod`. The verified token's
  `tenantId` claim is the authoritative tenant; tenant-id mismatches in
  the body return 403.

## Tests

```bash
npm test -- src/services/systemEngine
```

35+ unit tests cover schema validation, registry, decision engine
isolation, executor binding wiring, geofenceToSos / tierChangeReactivity
policies, the server trigger, and the Zettelkasten health helper.
