# @praeventio/capacitor-proximity

First-party, repository-versioned Capacitor 8 bridge for the device proximity
sensor used by Guardian's carry-mode and fall-detection policy.

## Contract

The package preserves the previous plugin capabilities:

- `enable()` / `disable()`;
- `getStatus()`;
- `getPluginVersion()`;
- Android window dim/restore and iOS system proximity monitoring.

It adds `getCurrent()` and the `proximityChanged` event:

```ts
{
  state: 'near' | 'far';
  timestamp: number; // Unix epoch milliseconds
  distance?: number; // Android centimetres when supplied by the sensor
}
```

`addListener` returns Capacitor's asynchronous `PluginListenerHandle`. The app
hook owns the complete session: enable, await listener, seed current state,
remove listener, then disable. Calls are idempotent and all destroy paths
restore native state.

## Platform implementation

- Android uses one `Sensor.TYPE_PROXIMITY` listener. `distance < maximumRange`
  is `near`; equality is `far`. Invalid/non-finite readings never create near
  evidence. Repeated readings update `getCurrent` but emit only state changes.
- iOS enables `UIDevice.isProximityMonitoringEnabled`, observes
  `UIDevice.proximityStateDidChangeNotification`, and reads
  `UIDevice.proximityState`.
- Web reports unavailable. It never fabricates a proximity reading.

## Automated verification

From the repository root:

```text
npm run proximity:build
npm run test -- src/__tests__/mobile/proximityNativeContract.test.ts src/__tests__/mobile/androidBuildWiring.test.ts src/services/proximitySensor/proximityPluginAdapter.test.ts src/hooks/useProximityMode.test.tsx src/components/emergency/FallDetectionMonitor.proximity.test.tsx --reporter=dot
```

The pure Android boundary rule can run without an Android SDK:

```text
javac -d <temp> packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/ProximityStateMapper.java packages/capacitor-proximity/android/src/test/java/com/praeventio/proximity/ProximityStateMapperSelfTest.java
java -cp <temp> com.praeventio.proximity.ProximityStateMapperSelfTest
```

With Android SDK configured, also run:

```text
cd android
gradlew :praeventio-capacitor-proximity:testDebugUnitTest
```

## Physical-device release gate

Automation proves contracts and application behaviour, not the hardware path.
Before a mobile release:

1. Android: start fall detection, cover/uncover the sensor, confirm one
   `near`/`far` transition, pocket sensitivity, exact brightness restoration,
   and cleanup after leaving the screen.
2. iPhone: repeat near/far and cleanup checks, including unsupported-device
   status where available.
3. Both platforms: confirm the accelerometer/DeviceMotion stream and fall event
   path continue while proximity is `near` and the OS dims/blanks the display.
4. Capture device model, OS version, timestamps, and result in the mobile
   release evidence. Do not mark this gate passed from simulator results.

## Provenance

The compatibility surface and original screen behaviour derive from
`@capgo/capacitor-proximity` 8.1.9. See `THIRD_PARTY_NOTICES.md`.
