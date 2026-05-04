# Mobile build runbook — Android + iOS

**Sprint:** 20 (Brecha A — Capacitor mobile preparation)
**Status:** Capacitor 8 deps installed, `capacitor.config.ts` validated. Native folders (`android/`, `ios/`) are NOT generated yet — they require Android SDK / Xcode toolchains that are not present in the dev container or in GitHub-hosted CI runners. This runbook is the local-build entry point for whoever ships the first store binary.

**Companion docs:**
- [`IOS_BUILD.md`](../IOS_BUILD.md) — deeper iOS Info.plist / entitlements / HealthKit walkthrough.
- [`docs/architecture-decisions/0006-mobile-deferred-to-local-build.md`](architecture-decisions/0006-mobile-deferred-to-local-build.md) — rationale for not automating the mobile build in CI this Sprint.
- [`HEALTH_CONNECT_MIGRATION.md`](../HEALTH_CONNECT_MIGRATION.md) — Android Health Connect specifics.
- [`deep-linking-runbook.md`](./deep-linking-runbook.md) — Universal Links (iOS) + App Links (Android) activation flow. Covers the AASA / `assetlinks.json` placeholders that MUST be replaced with the real Apple Team ID and Android keystore SHA-256 fingerprint before the first store build.

---

## 1. Prerequisites by platform

### Android
- **Android Studio** Hedgehog or newer (2023.1.1+).
- **Android SDK** API 34 or higher (target/compile SDK).
- **JDK 17+** (Temurin recommended). Capacitor 8 + Gradle 8.x require JDK 17.
- Environment variables:
  - `ANDROID_HOME` → e.g. `~/Library/Android/sdk` (macOS) or `%LOCALAPPDATA%\Android\Sdk` (Windows).
  - `JAVA_HOME` → JDK 17 install path.
  - `PATH` → include `$ANDROID_HOME/platform-tools` and `$ANDROID_HOME/emulator`.

### iOS
- **macOS Sonoma** (14.x) or newer. Apple toolchain only ships on macOS.
- **Xcode 15+** with Command Line Tools (`xcode-select --install`).
- **CocoaPods 1.13+** (`sudo gem install cocoapods` or `brew install cocoapods`).
- **Apple Developer account** ($99/year) for physical-device beyond 7 days, TestFlight, and App Store distribution.
- A signed-in Apple ID in Xcode > Settings > Accounts with a development team selected.

---

## 2. First-time setup (one-time per machine)

```bash
# 1. From the repo root, install JS deps and produce a fresh web bundle.
npm ci
npm run build

# 2. Add native platforms. Run BOTH if you ship to both stores; the iOS
#    command requires macOS and Xcode tooling. After `cap add` runs once,
#    commit the generated android/ and ios/ folders to git.
npx cap add android
npx cap add ios   # macOS-only

# 3. Sync the freshly built dist/ into both native projects.
npx cap sync
```

**Apply native config edits before the first build:**
- iOS `Info.plist` and `App.entitlements` — see `IOS_BUILD.md` for the full template (HealthKit, Location, Camera, Microphone, Bluetooth, Contacts, Motion usage strings).
- Android `AndroidManifest.xml` permissions — see the matrix in section 4.

---

## 3. Subsequent builds (per change)

```bash
# After any change in src/, capacitor.config.ts, or web assets:
npm run build && npx cap sync

# Then open the native IDE for run / debug / archive:
npx cap open android   # opens Android Studio
npx cap open ios       # opens Xcode (macOS only)
```

There are also npm shortcuts already defined in `package.json`:

```bash
npm run cap:sync           # build + sync both platforms
npm run cap:android        # build + sync android + open Android Studio
npm run cap:ios            # build + sync ios + open Xcode
npm run cap:build:android  # build + sync android (no IDE — useful for CLI Gradle build)
```

---

## 4. Plugins permissions matrix

These are the Capacitor plugins already wired in `package.json` plus the runtime permissions and `Info.plist` / `AndroidManifest` keys each one requires. The owner of the first store submission MUST verify every entry below before tapping **Archive** in Xcode or **Generate Signed Bundle** in Android Studio.

| Plugin | Android permission | iOS Info.plist key |
| --- | --- | --- |
| `@capacitor/geolocation` | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | `NSLocationWhenInUseUsageDescription` (and `NSLocationAlwaysAndWhenInUseUsageDescription` if background) |
| `@capacitor/motion` | (auto-granted; sensor access via `body-sensors` is optional) | `NSMotionUsageDescription` |
| `@capacitor/push-notifications` | `POST_NOTIFICATIONS` (Android 13+) | `UIBackgroundModes` → `remote-notification`, plus enable Push Notifications capability in Xcode |
| `@capacitor-community/bluetooth-le` | `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` (Android 12+); `ACCESS_FINE_LOCATION` for scan results on Android 11 and below | `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription` |
| `@capacitor-community/sqlite` | none | none (data lives in the app sandbox) |
| `@capacitor-community/admob` | `INTERNET`, `ACCESS_NETWORK_STATE`, `com.google.android.gms.permission.AD_ID` (Android 13+) | none beyond the SKAdNetwork IDs in `Info.plist` (template in AdMob docs) |
| `@capacitor-community/keep-awake` | none | none |
| `@capacitor/preferences` | none | none |
| `@aparajita/capacitor-biometric-auth` | `USE_BIOMETRIC` (and legacy `USE_FINGERPRINT` for older devices) | `NSFaceIDUsageDescription` |
| `@perfood/capacitor-healthkit` | n/a (iOS only) | `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription` + HealthKit capability + provisioning-profile entitlement (see `IOS_BUILD.md`) |
| `@kiwi-health/capacitor-health-connect` | `android.permission.health.READ_*` cluster (heart rate, steps, sleep, etc. — declare only what you read) | n/a (Android only). Also requires Health Connect APK pre-installed on Android 13; bundled in Android 14+. See `HEALTH_CONNECT_MIGRATION.md`. |

---

## 5. Troubleshooting

### Gradle / Android Studio failing on first build
- `cd android && ./gradlew clean` then re-open Android Studio.
- Check that `org.gradle.java.home` (in `~/.gradle/gradle.properties`) points at JDK 17, not the system JDK.
- If you see `Unsupported class file major version 65`, you're on JDK 21 — downgrade or set `JAVA_HOME` to a JDK 17 install just for this project.

### iOS pod install fails
```bash
cd ios/App
pod deintegrate
pod install --repo-update
```
- If a single pod is stuck, `pod cache clean <PodName>` then re-install.
- Apple Silicon: pods that don't ship arm64 slices need `arch -x86_64 pod install`.

### Webview shows a blank screen
- Verify `webDir: 'dist'` matches the actual Vite output (`dist/index.html` exists).
- Confirm `npm run build` ran in the same checkout BEFORE `npx cap sync`.
- For dev live-reload: in `capacitor.config.ts`, the `server.url` block points at `http://10.0.2.2:5173` for Android emulator. On a physical device, replace with your machine's LAN IP and ensure the firewall allows port 5173.

### `npx cap sync` warns about missing platforms
- Expected if `android/` or `ios/` was not generated yet. Re-run the `cap add` step from section 2.

### Plugin shows up as "not implemented" at runtime
- Ran `cap sync` after `npm install` of a new plugin? Plugins auto-register only when sync runs.
- iOS-only plugin called on Android (or vice versa) — wrap calls with `Capacitor.isNativePlatform()` and `Capacitor.getPlatform() === 'ios'`.

---

## 6. CI signing pipeline (Android — Sprint 21 Ola 6, Bucket S)

Hosted CI for **Android** mobile builds is now wired via Fastlane. iOS remains local-only until macOS runner cost is justified (see [ADR-0009](architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md), which supersedes [ADR-0006](architecture-decisions/0006-mobile-deferred-to-local-build.md)).

**Workflow**: `.github/workflows/mobile-release.yml`
**Fastlane lanes**: `fastlane/Fastfile` — `internal`, `production`, `build_only`
**Ruby deps**: `Gemfile` (run `bundle install` once locally to generate `Gemfile.lock`).

### 6.1 — One-time keystore setup

Generated **once** on a developer machine; the resulting JKS becomes the canonical signing identity for every store build forever after. **Lose it and you cannot ship updates** — the new keystore would produce a different signing certificate, which Play Console rejects.

```bash
# 1. Generate the release keystore.
keytool -genkey -v \
  -keystore release.keystore \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -alias praeventio

# 2. Encode for GitHub Secrets (no trailing newline).
base64 -i release.keystore | tr -d '\n' > release.keystore.b64

# 3. Generate the Play service-account JSON via Google Cloud Console:
#    Play Console → Setup → API access → Service accounts → Create.
#    Download the JSON, then base64-encode the same way:
base64 -i play-service-account.json | tr -d '\n' > play-service-account.json.b64
```

Store `release.keystore` itself in a password manager / sealed vault — **never** commit the JKS to git, and never paste it into a chat.

### 6.2 — GitHub Secrets required

Configure these under **Repo → Settings → Secrets and variables → Actions**:

| Secret name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Output of `base64 -i release.keystore \| tr -d '\n'` |
| `ANDROID_KEYSTORE_PASSWORD` | Store password from the `keytool` prompt |
| `KEY_ALIAS` | Alias used in `keytool` (default: `praeventio`) |
| `KEY_PASSWORD` | Key password from the `keytool` prompt |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | Output of `base64 -i play-service-account.json \| tr -d '\n'` |

The workflow decodes both base64 secrets back to files (`release.keystore`, `play-service-account.json`) inside the runner only.

### 6.3 — Triggers

- **Manual**: `workflow_dispatch` with a `track` input — choose `internal` (default), `production`, or `build_only`.
- **Tag-driven production**: pushing a tag matching `mobile-v*` triggers a production track upload.
- **Smoke test on PR**: the existing `.github/workflows/mobile-build-check.yml` still runs to validate the web bundle on every PR (it does NOT touch Gradle).

### 6.4 — Local smoke test (recommended before merging Fastfile changes)

```bash
# One-time:
gem install bundler
bundle install   # generates Gemfile.lock (commit it)

# Set the same env vars CI uses (KEYSTORE_PATH must be an absolute path):
export KEYSTORE_PATH="$(pwd)/release.keystore"
export ANDROID_KEYSTORE_PASSWORD="..."
export KEY_ALIAS="praeventio"
export KEY_PASSWORD="..."

# Compiles + signs the AAB without uploading.
bundle exec fastlane android build_only
```

> TODO: `Gemfile.lock` is not yet committed — generate it on a Ruby-enabled machine via `gem install bundler && bundle install` and commit alongside `Gemfile`. CI will work without it (bundler resolves on first run) but reproducibility benefits from pinning.

### 6.5 — iOS deferral (still active)

iOS automation requires:

- `macos-latest` runner minutes (≈10× the cost of Linux).
- Distribution `.p12` certificate + App Store provisioning profile.
- App Store Connect API key (separate from Play service account).

Until those are in place, iOS continues to follow sections 2 + 3 above (local Xcode archive). The `Fastfile` will gain a `platform :ios` block when iOS automation is activated.

---

## 7. Quick reference

```bash
# Build + sync both platforms
npm run cap:sync

# Open Android Studio
npm run cap:android

# Open Xcode (macOS only)
npm run cap:ios

# Inspect resolved Capacitor config
npx cap config --list

# List installed plugins (helpful for debugging "not implemented" runtime errors)
npx cap ls
```
