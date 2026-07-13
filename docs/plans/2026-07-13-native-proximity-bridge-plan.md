# Native Proximity Event Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real Android/iOS `near`/`far` events to the existing device-mode and fall-detection pipeline without removing any current capability.

**Architecture:** Replace the opaque npm-only proximity dependency with a first-party local Capacitor package that preserves its API and screen behaviour while adding events and current-state reads. Make the React hook own enable/listen/disable lifecycle with Capacitor's asynchronous listener contract.

**Tech Stack:** TypeScript 5.8, Capacitor 8, Java 17/Android SensorManager, Swift/UIKit, Vitest 4, JUnit 4.

## Global Constraints

- Preserve `enable`, `disable`, `getStatus`, `getPluginVersion`, Android dim/restore behaviour, and iOS proximity-monitoring behaviour.
- Do not fabricate proximity evidence on web or unavailable hardware.
- Proximity failure must never crash or disable the base fall-detection stream.
- Every production behaviour begins with a failing regression test.
- Simulator and source tests must not be described as physical-device validation.

---

### Task 1: Pin the local plugin boundary

**Files:**
- Modify: `src/__tests__/mobile/androidBuildWiring.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Create: `packages/capacitor-proximity/package.json`
- Create: `packages/capacitor-proximity/tsconfig.json`
- Create: `packages/capacitor-proximity/src/definitions.ts`
- Create: `packages/capacitor-proximity/src/index.ts`
- Create: `packages/capacitor-proximity/src/web.ts`

**Interfaces:**
- Produces: `CapacitorProximityPlugin` with `enable`, `disable`, `getStatus`, `getPluginVersion`, `getCurrent`, async `addListener`, and `removeAllListeners`.

- [x] Write a failing wiring test requiring `@praeventio/capacitor-proximity: file:packages/capacitor-proximity` and Android Gradle paths under `packages/capacitor-proximity/android`.
- [x] Run `npm run test -- src/__tests__/mobile/androidBuildWiring.test.ts --reporter=dot` and confirm failure references the old Capgo package/path.
- [x] Add the local package surface, TypeScript/Vite aliases, dependency, lockfile, and Gradle wiring.
- [x] Rerun the wiring test and `npx tsc -p packages/capacitor-proximity/tsconfig.json`.

### Task 2: Implement and test Android readings

**Files:**
- Create: `packages/capacitor-proximity/android/build.gradle`
- Create: `packages/capacitor-proximity/android/src/main/AndroidManifest.xml`
- Create: `packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/ProximityStateMapper.java`
- Create: `packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/CapacitorProximity.java`
- Create: `packages/capacitor-proximity/android/src/main/java/com/praeventio/proximity/CapacitorProximityPlugin.java`
- Create: `packages/capacitor-proximity/android/src/test/java/com/praeventio/proximity/ProximityStateMapperTest.java`

**Interfaces:**
- Consumes: `Sensor.TYPE_PROXIMITY`, `Sensor.getMaximumRange()`.
- Produces: `proximityChanged` payload `{ state, timestamp, distance }` and current reading.

- [x] Write failing JUnit boundary tests for distance below, equal to, and above maximum range plus non-finite values.
- [x] Confirm the mapper test starts red before the production class exists.
- [x] Implement the pure mapper, one sensor listener, last-reading storage, event callback, idempotent enable/disable, and exact window restoration.
- [x] Connect the callback to Capacitor `notifyListeners` and reject `getCurrent` until a real sample exists.
- [x] Run the SDK-free Java mapper self-test. Gradle JUnit remains a CI/device-build gate because this workstation has no Android SDK configured.

### Task 3: Implement the iOS event bridge

**Files:**
- Create: `packages/capacitor-proximity/PraeventioCapacitorProximity.podspec`
- Create: `packages/capacitor-proximity/Package.swift`
- Create: `packages/capacitor-proximity/ios/Sources/PraeventioCapacitorProximity/CapacitorProximity.swift`
- Create: `packages/capacitor-proximity/ios/Sources/PraeventioCapacitorProximity/CapacitorProximityPlugin.swift`

**Interfaces:**
- Consumes: `UIDevice.isProximityMonitoringEnabled`, `UIDevice.proximityState`, and `UIDevice.proximityStateDidChangeNotification`.
- Produces: the same `proximityChanged` payload and `getCurrent` contract as Android.

- [x] Define the package/pod metadata and bridged method list.
- [x] Implement idempotent monitor/observer registration and removal.
- [x] Emit an initial/current state and every notification using epoch milliseconds.
- [x] Verify plugin TypeScript API and Swift method names with source-contract tests in Task 5; record that device execution requires the generated Xcode project.

### Task 4: Wire production lifecycle with TDD

**Files:**
- Modify: `src/services/proximitySensor/proximityModeDetector.ts`
- Modify: `src/services/proximitySensor/proximityPluginAdapter.ts`
- Modify: `src/services/proximitySensor/proximityPluginAdapter.test.ts`
- Modify: `src/hooks/useProximityMode.ts`
- Modify: `src/hooks/useProximityMode.test.tsx`
- Modify: `src/components/emergency/FallDetectionMonitor.proximity.test.tsx`

**Interfaces:**
- Consumes: `@praeventio/capacitor-proximity`.
- Produces: `ProximityPluginContract` with asynchronous listener handle and explicit `enable`/`disable` lifecycle.

- [x] Replace null-pin tests with failing tests for native available/unavailable/plugin-error paths.
- [x] Change simulated plugins to asynchronous listeners and add failing tests for enable, cleanup, setup cancellation, and setup failure.
- [x] Run focused tests and confirm failures are due to the missing production bridge/lifecycle.
- [x] Implement the minimum adapter and hook changes, including safe cleanup of in-flight setup.
- [x] Prove simulated `near` raises the real fall sensitivity and `far` restores it.

### Task 5: Audit guards and documentation

**Files:**
- Create: `packages/capacitor-proximity/README.md`
- Create: `src/__tests__/mobile/proximityNativeContract.test.ts`
- Modify: `docs/stubs-inventory.md`
- Modify: `docs/plans/2026-07-13-native-proximity-bridge-design.md`

**Interfaces:**
- Produces: source-level guards for both native implementations and an explicit physical-device checklist.

- [x] Write failing source-contract tests pinning Android `notifyListeners`, Android destroy cleanup, iOS notification observation, iOS observer cleanup, and both `getCurrent` implementations.
- [x] Add package documentation with architecture, payload schema, lifecycle, limitations, and Android/iOS physical test steps.
- [x] Remove the resolved stub entry and replace it with the real implementation evidence and remaining device-validation limitation.
- [x] Run all proximity/mobile focused tests.

### Task 6: Verification and publication

**Files:**
- Review all files in this plan; do not stage generated caches or unrelated changes.

- [x] Run focused Vitest tests, package TypeScript build, SDK-free Android mapper tests, app typecheck, ESLint, and the production web build. Android Gradle and Swift/device execution remain explicit environment gates.
- [x] Inspect `git diff --check`, `git status --short`, dependency diff, and native lifecycle code line by line.
- [x] Commit only scoped files, push `codex/native-proximity-events`, and open draft PR #1264 against `main`.
- [x] Update the Notion task with PR URL, exact verification commands, honest physical-device limitation, and status `Review`.

## Verification record

Recorded on 2026-07-13 from the isolated
`codex/native-proximity-events` worktree:

- focused Vitest suite: 6 files, 54 tests passed;
- full repository Vitest suite: passed (exit code 0 in 352 seconds); Vitest
  still reports the pre-existing Framer Motion promise-leak diagnostics from
  `src/components/shared/Sheet.test.tsx`;
- application typecheck: passed;
- application ESLint: 0 errors (existing repository warnings remain);
- local plugin TypeScript build: passed;
- local package dry-run: contains TypeScript declarations, Java, Swift,
  package-manager metadata, licence, and third-party notice;
- pure Java mapper self-test: passed without Android SDK;
- production web build: passed;
- Android Gradle configuration reached SDK discovery and stopped because
  `ANDROID_HOME`/`local.properties` is not configured on this workstation;
- Swift compilation and real sensor behaviour require macOS/Xcode and physical
  Android/iOS devices and are retained as release gates in the package README.
