# Health Connect Migration Runbook

**Owner:** Agent A2 (this round) -> hands off to whoever takes the next round.
**Status (2026-04-28):**
- **Round 1 — done.** Types + adapter scaffolding + facade landed.
- **Round 2 — done.** `@kiwi-health/capacitor-health-connect@0.0.40` installed,
  `healthConnectAdapter` implemented against the plugin API, and `Telemetry.tsx`
  surgically swapped to prefer the facade with the legacy `/api/fitness/sync`
  path kept as a fall-through.
- **Round 3 phase 1 — done.** `@perfood/capacitor-healthkit@1.3.2` installed,
  `healthKitAdapter` implemented, facade gained an iOS branch, `/api/fitness/sync`
  carries a `Sunset:` header (RFC 8594) with structured deprecation logs, and
  `Telemetry.tsx` now branches both adapters. Test count grew 12 -> 16.
- **Round 3 phase 2 — pending.** Full Telemetry rewrite (consolidate the legacy
  Google Fit aggregate-parsing block once production telemetry confirms zero
  hits), `SCOPES` cleanup in `server.ts` (drop `fitness.*` OAuth scopes),
  Google OAuth consent screen re-verification with the reduced sensitive-scope
  set, eventual removal of `/api/fitness/sync` after 2026-12-31 sunset.

---

## 1. Why migrate

Google Fit is being shut down:

- **Sign-up closed:** 2024-05-01. No new OAuth clients can request Fit scopes.
- **API sunset:** 2026 (Google has communicated incremental REST shutdowns through 2026; the `fitness.activity.read`, `fitness.heart_rate.read`, and `fitness.body.read` scopes are on the deprecation list).
- **Replacement:** Google now points all Android health integrations at **Health Connect**, the on-device system app that brokers data between sources (Fitbit, Samsung Health, Wear OS, manual entries) and consumer apps. iOS continues to use **HealthKit**.

Guardian-Praeventio currently calls Google Fit from `src/pages/Telemetry.tsx` -> `POST /api/fitness/sync` (defined in `server.ts:828`) using OAuth tokens stored in `oauth_tokens/{uid_provider}` Firestore documents (see `src/services/oauthTokenStore.ts`). That flow keeps working **for now**, but it must be retired before Google flips the kill switch.

---

## 2. Health Connect overview

| Aspect          | Android (Health Connect)                                          | iOS (HealthKit)                                            |
|-----------------|-------------------------------------------------------------------|------------------------------------------------------------|
| Distribution    | Pre-installed on Android 14+, Play Store install on 9-13          | Built-in since iOS 8                                       |
| Min SDK         | 26 (Android 8.0)                                                  | iOS 8+                                                     |
| Permissions     | Per-record-type, declared in `AndroidManifest.xml`                | Per-quantity-type, declared in Info.plist + runtime prompt |
| Storage         | On-device SQLite, brokered via system app                         | On-device, encrypted at rest                               |
| Server access   | None — Health Connect is on-device-only by design                 | None — HealthKit is on-device-only by design               |

The Capacitor ecosystem provides plugins that abstract both stores behind a single TypeScript API. Recommended candidates (pick **one** in Round 2):

- `@capacitor-community/health-connect` — Android-only; pair with HealthKit plugin for iOS.
- `@capacitor-community/health` — covers both stores; less mature.
- `cordova-plugin-health` via Capawesome bridge — broadest coverage; older API.

---

## 3. Migration steps

Steps marked **[done]** were completed in Round 1 or Round 2.

1. **[done — R1]** Add types: `src/services/health/types.ts` (HeartRateSample, StepsSample, CaloriesSample, SleepSample, HealthDataRange, HealthAdapter, HealthScope, PermissionResult).
2. **[done — R1]** Stub `src/services/health/healthConnectAdapter.ts` with the typed interface; every read method throws `NotImplemented`.
3. **[done — R1]** Wrap existing Google Fit flow in `src/services/health/googleFitAdapter.ts` with `@deprecated` JSDoc that points back here.
4. **[done — R1]** Add `src/services/health/index.ts` facade — `getHealthAdapter()` picks Health Connect on native, falls back to Google Fit, then noop.
5. **[done — R1]** TDD `src/services/health/healthFacade.test.ts` — covers all four selection branches + noop empty-array contract.
6. **[done — R2]** Install the Capacitor plugin:
   ```bash
   npm i @kiwi-health/capacitor-health-connect@^0.0.40
   ```
   `@capacitor-community/health-connect` was the original Round 1 candidate but
   the maintained, currently-published namespace is `@kiwi-health`. Plugin is
   Android-only (mirrors Health Connect's own platform scope); iOS HealthKit
   parity will land via a separate `@perfood/capacitor-healthkit` adapter in a
   future round (see open question 1 below).
7. **[done — R2]** Implement `healthConnectAdapter` methods against the plugin
   API. Real implementations now exist for `requestPermissions`, `readHeartRate`,
   `readSteps`, `readCalories`, `readSleep`. `isAvailable` is wired to
   `HealthConnect.checkAvailability()` with a cached probe + sync getter (the
   getter returns `false` until the first `Available` response lands; the facade
   re-asks on every selection so the next call sees `true`).
8. **[round 3]** Android setup:
   - `android/app/build.gradle`: bump `minSdkVersion` to 26 if not already.
   - `android/app/src/main/AndroidManifest.xml`: add the `<queries>` block for `com.google.android.apps.healthdata`, plus read permissions for HEART_RATE, STEPS, ACTIVE_CALORIES_BURNED, TOTAL_CALORIES_BURNED, SLEEP_SESSION.
   - `MainActivity.kt`: register the Health Connect permission contract launcher.
   - Run `npx cap sync android` after the manifest edits.
9. **[round 3]** iOS setup (deferred — needs the HealthKit plugin first):
   - Add `@perfood/capacitor-healthkit` (or equivalent) to `package.json`.
   - Enable HealthKit capability in Xcode.
   - Add `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` to `Info.plist`.
   - Add an iOS adapter mirroring `healthConnectAdapter` and update the facade to pick it on `Capacitor.getPlatform() === 'ios'`.
10. **[partial — R2]** Migrate `src/pages/Telemetry.tsx` to call
    `getHealthAdapter()` instead of `fetch('/api/fitness/sync')`. The two
    targeted blocks have been **surgically** swapped:
    - `handleConnectGoogleFit` (now ~line 172): prefers
      `adapter.requestPermissions(['heart-rate', 'steps'])` when the facade
      picks Health Connect; falls through to the existing OAuth popup
      otherwise.
    - `fetchFitnessData` (now ~line 199): prefers
      `adapter.readHeartRate({start, end})` + `adapter.readSteps({start, end})`
      when the facade picks Health Connect; the legacy aggregate-parsing block
      is preserved as a fall-through and only runs on web / when the native
      read fails.
    **Round 3** still needs to: (a) delete the legacy aggregate-parsing block
    once telemetry/QA confirms the new path is live in production builds,
    (b) re-label the UI button (currently still says "Google Fit"),
    (c) audit the `setFitTokens` shape — `fitTokens` is treated as a generic
    truthy flag today, fine for now but worth a cleanup pass.
11. **[round 3]** Server cleanup (after Telemetry.tsx fully stops calling the endpoint):
    - Mark `/api/fitness/sync` (`server.ts:828`) deprecated by adding a `Sunset:` HTTP header and a structured log line on every hit.
    - Set a calendar reminder ~30 days before the Google Fit sunset date to remove the route entirely.
12. **[round 3]** OAuth scope cleanup in `server.ts:545-550`: drop the three `fitness.*` scopes from the `SCOPES` array. The Calendar scope stays.
13. **[round 3]** Re-submit the Google OAuth consent screen for verification with the reduced sensitive-scope set, otherwise the consent prompt will keep showing the Fit-era warning.

---

## 4. Privacy & compliance

- **Data residency:** Health Connect and HealthKit are **on-device-only**. The migration intentionally removes the round-trip through `/api/fitness/sync`, which means biometric data no longer transits Guardian's servers. That is a privacy win and a compliance simplification.
- **Chile — Ley 19.628 (Protección de la Vida Privada):** biometric and health data are sensitive personal data. Migration documentation must record (a) what is collected, (b) the on-device retention boundary, (c) the explicit-consent flow.
- **Chile — Ley 21.719 (Datos Personales, vigente 2026):** raises the bar — explicit, granular, revocable consent is mandatory for sensitive categories. Guardian's consent UI must:
  1. List each scope (heart-rate, steps, calories, sleep) separately.
  2. Default all toggles to off.
  3. Provide a one-tap revoke that calls Health Connect's `revokeAllPermissions()` (or equivalent on HealthKit).
  4. Persist a consent timestamp + version locally and (anonymously) on the audit log.
- **No server upload by default:** if a future feature *needs* server-side processing of a sample (e.g. SUSESO heat-stress flagging), it must be a separate, opt-in flow with its own consent prompt — do not silently re-introduce upload through the migration.

---

## 5. Round 2 decisions + Open questions for Round 3

### Round 2 decisions (locked in)

- **Plugin pick:** `@kiwi-health/capacitor-health-connect@^0.0.40` (Android only).
  Last-published version at install time was 0.0.40. Picked over
  `@capacitor-community/health-connect` because the latter is no longer the
  actively-maintained namespace; picked over `@capacitor-community/health`
  because the unified plugin lags the Android-only one's record-type coverage.
- **iOS strategy:** deferred. `healthConnectAdapter.isAvailable` returns
  `false` on iOS (it checks `Capacitor.getPlatform() === 'android'` first), so
  iOS users will continue to fall through to `googleFitAdapter` and
  `noopAdapter` until a HealthKit-backed adapter ships.
- **Telemetry.tsx scope:** surgical swap (option (b) from the prior Q list).
  The two Fit-specific blocks were touched; Bluetooth, MediaPipe, and the rest
  of the file are untouched.
- **Plugin API quirks worth flagging:**
  - The plugin's `RecordType` for heart-rate is `'HeartRateSeries'` (a series
    of samples per record), **not** a single `'HeartRate'` record. The adapter
    flattens samples on read.
  - `requestHealthPermissions` returns granted permissions as full Android
    permission strings (`android.permission.health.READ_HEART_RATE`); the
    adapter parses the suffix back to a `HealthScope`.
  - Sleep stages are returned as numeric enum values; the adapter maps them
    to the four-bucket `SleepQuality` (`light` / `deep` / `rem` / `awake`).

### Open questions for Round 3

1. **Telemetry.tsx finish line.** The fall-through paths in
   `handleConnectGoogleFit` and `fetchFitnessData` are still alive. Round 3
   should (a) confirm via remote-config / build-flag that all production
   Android builds have HC permissions wired, then (b) delete the legacy
   blocks. Question: do we keep the OAuth popup path for web-only desktop
   QA users, or sunset web Fit support entirely with the server endpoint?
2. **Server endpoint sunset date.** Need a hard date for retiring
   `/api/fitness/sync` — recommend 90 days after Round 3 ships, instrumented
   with `Sunset:` headers + structured logs in the meantime.
3. **Sleep & calories.** Health Connect now exposes both via the new adapter,
   but `Telemetry.tsx` still surfaces only `heartRate` + `steps`. Decision
   needed: extend the FitnessData shape and UI now, or treat as a separate
   feature in a later round?
4. **iOS HealthKit adapter.** Pick a plugin (`@perfood/capacitor-healthkit`
   is the leading candidate) and stand up an `iosHealthKitAdapter` next to
   the Health Connect one; the facade gains a third branch on
   `Capacitor.getPlatform() === 'ios'`.
5. **Permission UX (Ley 21.719).** The current `requestPermissions` call
   bundles all scopes into one Health Connect prompt. Section 4 of this doc
   requires per-scope toggles. Round 3 should split the prompt into one
   call per scope or build a UI gate that filters scopes before requesting.

---

## 6. Files touched

### Round 1
```
src/services/health/types.ts                  (created)
src/services/health/healthConnectAdapter.ts   (created, stub)
src/services/health/googleFitAdapter.ts       (created, deprecated wrapper)
src/services/health/index.ts                  (created, facade)
src/services/health/healthFacade.test.ts      (created, TDD)
HEALTH_CONNECT_MIGRATION.md                   (this file)
```

### Round 2
```
package.json                                  (+ @kiwi-health/capacitor-health-connect@^0.0.40 — already in tree)
package-lock.json                             (lock entry already present)
src/services/health/healthConnectAdapter.ts   (replaced stubs with real plugin calls)
src/services/health/healthFacade.test.ts      (added vi.mock for the plugin + Capacitor.getPlatform)
src/pages/Telemetry.tsx                       (surgical swap of handleConnectGoogleFit + fetchFitnessData)
HEALTH_CONNECT_MIGRATION.md                   (this file — Round 2 status)
```

### Round 3 phase 1
```
package.json                                  (+ @perfood/capacitor-healthkit@^1.3.2)
package-lock.json                             (lock entry added by npm install)
src/services/health/types.ts                  (HealthAdapterName += 'healthkit')
src/services/health/healthKitAdapter.ts       (created — real plugin implementation)
src/services/health/index.ts                  (facade gained iOS branch + __setPlatformChecker)
src/services/health/healthFacade.test.ts      (4 new iOS-path test cases; vi.mock for healthkit plugin)
src/pages/Telemetry.tsx                       (handleConnectGoogleFit + fetchFitnessData branch on 'healthkit' too)
server.ts                                     (Sunset/Deprecation/Link headers + structured log on /api/fitness/sync)
HEALTH_CONNECT_MIGRATION.md                   (this file — Round 3 phase 1 status)
```

### Round 3 phase 1 — iOS plugin pick

- **Plugin pick:** `@perfood/capacitor-healthkit@^1.3.2`
  - Last published: **2025-02-13** (~14 months prior to this round; the
    plugin's API is stable and the project is still tagged as the
    leading HealthKit-only Capacitor option in the community).
  - Capacitor compat: peer `@capacitor/core@^4.0.0` declared; the project
    uses `@capacitor/core@^8.3.0`. Plugins targeting Cap 4 still work on
    Cap 5/6/7/8 because the bridge ABI is forward-compatible (the same is
    true for `@kiwi-health/capacitor-health-connect`); installed with
    `--legacy-peer-deps` to acknowledge the version gap explicitly.
  - Considered alternatives (NOT picked):
    - `cordova-plugin-health` — older Cordova-era plugin, requires the
      Capawesome/cordova bridge, less typed surface.
    - `@awesome-cordova-plugins/health` — wraps the cordova plugin; same
      bridge dependency.
  - If activity stalls or Cap 9 ships breaking changes, migrate to
    `@capacitor-community/health` (currently lags HealthKit-only coverage)
    or fork `@perfood/capacitor-healthkit` into a Guardian-owned namespace.

### Round 3 phase 1 — iOS native config TODOs

The adapter is wired and selected by the facade on `Capacitor.getPlatform() === 'ios'`,
but the iOS app **will not** prompt for HealthKit access until these native
edits land in `ios/`:

1. Xcode project: add the **HealthKit** capability to the App target's
   `Signing & Capabilities` pane. This generates the `HealthKit` entitlement
   in `App.entitlements`.
2. `ios/App/App/Info.plist`: add the user-facing usage strings (Apple rejects
   submissions without these even if the app never reads):
   ```xml
   <key>NSHealthShareUsageDescription</key>
   <string>Guardian-Praeventio reads your heart rate, steps, calories, and sleep to surface heat-stress and fatigue alerts. Data stays on this device.</string>
   <key>NSHealthUpdateUsageDescription</key>
   <string>Guardian-Praeventio does not write data to HealthKit; this declaration is required by the HealthKit framework.</string>
   ```
3. `npx cap sync ios` after the manifest edits to copy the plugin's iOS
   sources into the Xcode workspace.
4. (Optional) `Background Modes` capability with the `Background Delivery`
   sub-mode if we later add background reads.

Read-only references (intentionally unmodified, owned by other agents this round):
```
src/services/oauthTokenStore.ts               (token storage; Agent O4 owns)
src/services/security/                        (KMS — Agent A1)
src/services/billing/                         (billing — agent unspecified)
src/services/vertex/                          (Vertex — Agent A3)
firestore.rules                               (Agent A4 polishing this round)
KMS_ROTATION.md                               (Agent A1)
```
