# Health Connect Migration Runbook

**Owner:** Agent N4 (this round) -> hands off to whoever takes the next round.
**Status (2026-04-28):** Round 1 complete — types + adapter scaffolding + facade landed; **no** Capacitor plugin installed yet.

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

Steps marked **[done]** were completed in Round 1.

1. **[done]** Add types: `src/services/health/types.ts` (HeartRateSample, StepsSample, CaloriesSample, SleepSample, HealthDataRange, HealthAdapter, HealthScope, PermissionResult).
2. **[done]** Stub `src/services/health/healthConnectAdapter.ts` with the typed interface; every read method throws `NotImplemented`.
3. **[done]** Wrap existing Google Fit flow in `src/services/health/googleFitAdapter.ts` with `@deprecated` JSDoc that points back here.
4. **[done]** Add `src/services/health/index.ts` facade — `getHealthAdapter()` picks Health Connect on native, falls back to Google Fit, then noop.
5. **[done]** TDD `src/services/health/healthFacade.test.ts` — covers all four selection branches + noop empty-array contract.
6. **[round 2]** Install the Capacitor plugin:
   ```bash
   npm i @capacitor-community/health-connect@^1.0.0   # confirm latest tag at install time
   npx cap sync
   ```
   *Blocked this round* because Agent N5 owns `package.json` for the Webpay/Transbank SDK install. Run after that lands to avoid a merge race.
7. **[round 2]** Implement `healthConnectAdapter` methods against the plugin API. Drop the `throw notImplemented(...)` lines and flip `isAvailable` to a runtime probe (`HealthConnect.checkAvailability()` or equivalent).
8. **[round 2]** Android setup:
   - `android/app/build.gradle`: bump `minSdkVersion` to 26 if not already.
   - `android/app/src/main/AndroidManifest.xml`: add the `<queries>` block for `com.google.android.apps.healthdata`, plus read permissions for HEART_RATE, STEPS, ACTIVE_CALORIES_BURNED, TOTAL_CALORIES_BURNED, SLEEP_SESSION.
   - `MainActivity.kt`: register the Health Connect permission contract launcher.
9. **[round 2]** iOS setup:
   - Enable HealthKit capability in Xcode.
   - Add `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` to `Info.plist`.
   - Capacitor 5+ is required — this repo is on `@capacitor/ios@^8.3.0` so the runtime is already fine.
10. **[round 3]** Migrate `src/pages/Telemetry.tsx` to call `getHealthAdapter()` instead of `fetch('/api/fitness/sync')`. Touchpoints in the file today:
    - `handleConnectGoogleFit` (line 172) -> replace with `await getHealthAdapter().requestPermissions(['heart-rate', 'steps'])`.
    - `fetchFitnessData` (line 199) -> replace the `/api/fitness/sync` POST with `await adapter.readHeartRate(range)` + `readSteps(range)`.
    - Drop the bespoke Google Fit aggregate-parsing block (lines 220-237).
    Deferred this round to avoid a regression on a 1000+ line file.
11. **[round 3]** Server cleanup (after Telemetry.tsx has stopped calling the endpoint):
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

## 5. Open questions for Round 2

1. **Plugin pick.** `@capacitor-community/health-connect` is Android-only. Do we (a) pair it with `@capacitor-community/health` for iOS, or (b) jump straight to a unified plugin? Decision affects `package.json` size and native config complexity.
2. **Telemetry.tsx scope.** Migration step 10 is large (the file is >1000 lines). Should Round 3 do a full rewrite of the page or just a surgical swap of the two functions identified above?
3. **Server endpoint sunset date.** Need a hard date for retiring `/api/fitness/sync` — recommend 90 days after Round 3 ships, instrumented with Sunset headers.
4. **Sleep & calories on Google Fit.** Today's `/api/fitness/sync` payload only includes heart-rate and steps; the deprecated wrapper returns `[]` for sleep and calories. Worth filling in before the sunset, or accept the gap because we're migrating off anyway?

---

## 6. Files touched this round

```
src/services/health/types.ts                  (created)
src/services/health/healthConnectAdapter.ts   (created, stub)
src/services/health/googleFitAdapter.ts       (created, deprecated wrapper)
src/services/health/index.ts                  (created, facade)
src/services/health/healthFacade.test.ts      (created, TDD)
HEALTH_CONNECT_MIGRATION.md                   (this file)
```

Read-only references (intentionally unmodified):
```
src/pages/Telemetry.tsx                       (Google Fit call sites @ lines 172, 199)
server.ts                                     (/api/fitness/sync @ line 828, SCOPES @ line 545)
src/services/oauthTokenStore.ts               (token persistence; no migration impact)
```
