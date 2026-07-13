# Native proximity event bridge design

## Context

The fall-detection pipeline already classifies `near`/`far` readings into
device modes and adjusts its impact threshold. Production never receives those
readings: `@capgo/capacitor-proximity` 8.1.9 preserves native screen behaviour
but exposes no event or current reading to JavaScript, so the adapter returns
`null` on every platform.

The existing dependency also hides a contract mismatch. Capacitor 8 returns a
`Promise<PluginListenerHandle>` from `addListener`, while
`ProximityPluginContract` currently models a synchronous handle. A real native
bridge therefore needs both a native event source and asynchronous lifecycle
ownership in the React hook.

## Decision

Vendor a first-party Capacitor package at
`packages/capacitor-proximity`, published locally as
`@praeventio/capacitor-proximity`. It retains the complete public capability set
of the current plugin (`enable`, `disable`, `getStatus`, `getPluginVersion` and
the existing native screen behaviour) and adds:

- `getCurrent(): Promise<{ state: 'near' | 'far' }>`;
- `proximityChanged` events containing `state`, `timestamp`, and native
  distance when Android supplies it;
- explicit asynchronous listener handles and deterministic cleanup.

The package remains independent from `capacitor-mesh`: proximity sensing and
emergency mesh transport have different permissions, lifecycles, failure modes,
and audit boundaries.

## Native behaviour

### Android

Use one `TYPE_PROXIMITY` listener. A reading is `near` when its distance is less
than the sensor's `maximumRange`; otherwise it is `far`. The listener stores the
last reading, emits `proximityChanged`, and preserves the dependency's window
brightness and keep-screen-on behaviour. `disable` and plugin destruction
unregister the listener and restore the exact prior window state.

The distance classifier is a pure Java unit with boundary tests, so vendor
differences and the equality boundary are reviewable without Android hardware.

### iOS

Enable `UIDevice.isProximityMonitoringEnabled`, subscribe to
`UIDevice.proximityStateDidChangeNotification`, emit the same JavaScript event,
and expose `UIDevice.proximityState` through `getCurrent`. Disabling or
destroying the plugin removes the observer before turning monitoring off.

The application does not yet commit an Xcode project, so iOS source and package
metadata are versioned now; physical-device validation remains an explicit
release-gate item rather than being represented as an automated success.

## Application lifecycle

`loadProximityPlugin` returns the first-party plugin only on a native platform
with an available sensor. `useProximityMode` owns the session:

1. enable monitoring;
2. await listener registration;
3. seed from `getCurrent` when available;
4. on unmount, cancellation, or disable, remove the listener and disable native
   monitoring even if setup was still in flight.

Web and unavailable hardware retain the existing neutral `normal` mode. All
adapter and setup failures remain non-fatal and are logged.

## Auditability

- The dependency is a local `file:` package with readable Java, Swift, and
  TypeScript sources.
- Android Gradle wiring is pinned to the local package by a regression test.
- Tests cover simulated near/far events through the real adapter contract and
  into fall-detection threshold changes.
- `docs/stubs-inventory.md` is updated only after the focused tests, typecheck,
  native package build, Android unit test, and web production build pass.
- Physical Android/iOS verification is documented separately and is never
  inferred from simulator tests.
