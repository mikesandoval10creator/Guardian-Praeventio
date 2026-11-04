# ManDown WebView: project isolation

## Scope

Ticket `40caa66d-73fe-8116-b81c-e02c9981d0a1` corrects the local sensor bus and the manual WebView detector. It does not change the Android foreground service, sensor thresholds, native ownership protocol, network dispatch implementation, or future-timestamp policy of bus rules.

## Contract

- R1: retain the latest reading per exact `(projectId, workerUid, kind)` tuple. Identifiers remain literal; JSON tuple encoding avoids separator collisions. Default correlation rules resolve all contributing readings in the triggering reading's project. Local alert replay identity also includes the project.
- R2: `evaluateManDownEvidence` accepts an explicit active `projectId`. `null`, empty, or the device sentinel cannot establish a project and return `none` (the hook retains its ordinary inactivity countdown). Legacy omitted scope is accepted only when the worker-filtered input has one unambiguous non-sentinel project; it never combines multiple projects.
- R3: project-bound impact and sustained immobility are required before reducing the countdown. Truly device-wide readings (`workerUid` AND `projectId` equal `LOCAL_DEVICE_UID`) may corroborate only BLE connectivity and battery state. A named foreign project is never treated as device-wide; unscoped impacts/immobility cannot become a project-specific anchor. Same-project local-worker sentinel readings retain their existing attribution.
- R4: the hook supplies its active project. When project/worker identity changes, it locally excludes the prior bus snapshot by reading ID without resetting the physical inactivity deadline; it does not clear the shared bus. Returning to a project cannot reuse that snapshot to shorten the countdown. New device observations and a refreshed battery snapshot may still corroborate new project-bound evidence.
- R5: a countdown already started remains attached to its original project/identity, including its dispatch and event writes. Selection/settings-object changes do not silently cancel it or redirect it. Explicit cancellation, stop, native ownership handoff and unmount still clear it. Acceleration is read from a current ref for the black box. Dispatch runs outside React state updaters to avoid duplicate local dispatch under StrictMode replay. Before suspicion, the active selection at threshold determines the project; after suspicion, its origin is pinned.
- R6: no corroboration keeps the existing 10-second self-cancellation window; complete same-project corroboration preserves the existing 5-second path. Correlation is advisory and never blocks local help.

## Verification

Run the repository's canonical test command under a Node version satisfying `package.json`:

```sh
npm run test:ci -- src/services/sensorBus src/hooks/useManDownDetection.test.tsx src/hooks/useBluetoothMesh.test.tsx src/hooks/useGeolocationTracking.test.tsx src/hooks/useProximityMode.test.tsx src/components/emergency/FallDetectionMonitor.test.tsx src/components/emergency/FallDetectionMonitor.proximity.test.tsx
npm run verify:fresh
```

Traceability: R1/R2/R3 -> `src/services/sensorBus/projectIsolation.test.ts`; R4/R5/R6 -> `src/hooks/useManDownDetection.test.tsx`; existing publisher and FallDetectionMonitor suites protect bus wiring and native-yield behavior.

The hook tests execute the real singleton publisher/bus/correlation engine under React/jsdom with synthetic sensors, fake timers and mocked persistence/emergency transports. They do not send SOS or prove FCM receipt, Android background operation, production persistence, legal compliance or field efficacy. Physical-device/native acceptance remains distinct.
