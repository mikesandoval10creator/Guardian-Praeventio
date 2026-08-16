# Mobile signing runbook — secrets, provisioning, triggers

**Sprint:** 30 — Bucket GG (iOS pipeline scaffold; Android shipped in Sprint 21 Ola 6).
**Companion:** [`mobile-build-runbook.md`](./mobile-build-runbook.md) §6 (Android keystore generation lives there and is NOT duplicated here).

This runbook is the operational counterpart to the Fastlane + GitHub Actions scaffold. It tells the release owner exactly which secrets to paste, where to paste them, and how to trigger a release. The scaffold is intentionally inert until the secrets are present — `mobile-release.yml` skips both platform jobs cleanly when their secrets are missing.

---

## 1. Secrets the user MUST paste

Configure under **Repo → Settings → Secrets and variables → Actions**.

### 1.1 Android (5 secrets — already documented in mobile-build-runbook §6.2)

| Secret | Source |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i release.keystore \| tr -d '\n'` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password from `keytool` |
| `KEY_ALIAS` | alias used in `keytool` (default `praeventio`) |
| `KEY_PASSWORD` | key password from `keytool` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | `base64 -i play-service-account.json \| tr -d '\n'` |

### 1.2 iOS (8 secrets — new in Sprint 30)

| Secret | Source / how to obtain |
| --- | --- |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_TEAM_ID` | 10-char Team ID — Apple Developer portal → Membership |
| `APP_BUNDLE_ID` | `com.praeventio.guard` (matches `appId` in `capacitor.config.ts`) |
| `MATCH_GIT_URL` | Private git repo URL holding fastlane match-encrypted certs + profiles (e.g. `git@github.com:praeventio/ios-certs.git`) |
| `MATCH_PASSWORD` | Symmetric passphrase you choose when running `fastlane match init`. Used to encrypt/decrypt the cert repo. |
| `FASTLANE_USER` | Same as `APPLE_ID` (kept separate so service accounts can override) |
| `FASTLANE_PASSWORD` | App-specific password — Apple ID → Sign-in & Security → App-Specific Passwords. **NEVER the real Apple ID password.** |
| `APP_STORE_CONNECT_API_KEY_ID` *(preferred)* | Replaces `FASTLANE_PASSWORD` for token-based auth — App Store Connect → Users and Access → Keys. |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer UUID from the same Keys page |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Base64-encode the downloaded `.p8` file: `base64 -i AuthKey_XXX.p8 \| tr -d '\n'` |

**Total:** 5 Android + 8 iOS = **13 secrets** for full dual-platform release. The pipeline runs single-platform if you only paste one set — the missing-secrets job is skipped, not failed.

---

## 2. iOS one-time bootstrap (macOS-only)

Performed once on a Mac with Xcode. After this, CI takes over.

```bash
# 2.1 Generate the iOS native folder (commits ios/App/ + ios/App.xcworkspace).
npm ci
npm run build
npx cap add ios
git add ios/
git commit -m "Bootstrap iOS native project (Sprint 30 GG)"

# 2.2 Initialize the certs repo. Pick a PRIVATE git repo URL — never public.
cd ios/App
fastlane match init
# Answer the prompts: storage_mode = git, git_url = <MATCH_GIT_URL value>.

# 2.3 Generate + encrypt distribution cert + App Store provisioning profile.
fastlane match appstore --app_identifier com.praeventio.guard

# 2.4 Set the Apple Team in Xcode (one-time):
# open ios/App/App.xcworkspace
# → Signing & Capabilities → Team: <your team>
# → Bundle Identifier: com.praeventio.guard
# Commit the resulting project.pbxproj changes.
```

After step 2.3, `MATCH_GIT_URL` contains the encrypted certs. Anyone with `MATCH_PASSWORD` (the GitHub secret) can decrypt them at CI time — that's how the macOS runner signs without needing a `.p12` file in the secrets.

---

## 3. Triggering a release

### 3.1 Manual dispatch

```bash
# From the repo root, with `gh auth login` completed:
gh workflow run mobile-release.yml --ref main -f track=internal
gh workflow run mobile-release.yml --ref main -f track=production
gh workflow run mobile-release.yml --ref main -f track=build_only
```

The `track` input maps to:

| `track` value | Android lane | iOS lane |
| --- | --- | --- |
| `internal` *(default)* | `internal` (Play Internal Testing) | `testflight` |
| `production` | `production` (Play Production) | `appstore` |
| `build_only` | `build_only` (no upload) | `build_only` (no upload) |

### 3.2 Tag-driven production

Pushing a tag matching `mobile-v*` triggers production on both platforms simultaneously:

```bash
git tag mobile-v1.0.0
git push origin mobile-v1.0.0
```

### 3.3 Local smoke test (before merging Fastfile changes)

```bash
# Android (Linux / macOS):
bundle install
export KEYSTORE_PATH="$(pwd)/release.keystore"
export ANDROID_KEYSTORE_PASSWORD="..."
export KEY_ALIAS="praeventio"
export KEY_PASSWORD="..."
bundle exec fastlane android build_only

# iOS (macOS only):
cd ios/App
bundle install
export APP_BUNDLE_ID="com.praeventio.guard"
export APPLE_TEAM_ID="..."
export MATCH_GIT_URL="..."
export MATCH_PASSWORD="..."
bundle exec fastlane ios build_only
```

---

## 4. Certificate pinning for app.praeventio.net (MASVS-NETWORK-2)

The Android release build pins the SPKI SHA-256 of the production TLS leaf plus a backup key in
[`android/app/src/main/res/xml/network_security_config.xml`](../android/app/src/main/res/xml/network_security_config.xml). The file ships
in the repo with **literal placeholder pins** (`PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY` and
`PIN_SHA256_BACKUP_REPLACE_AT_PROD_DEPLOY`); these MUST be replaced with the real digests before
the first store build. A release APK with the placeholders still present will fail every TLS
handshake to `app.praeventio.net` and the app will be unusable — the
[`scripts/check-cert-pinning-ratchet.cjs`](../scripts/check-cert-pinning-ratchet.cjs) gate refuses the build until they are replaced
(`npm run lint:cert-pinning`).

### 4.1 Why two pins (leaf + backup)

Per **RFC 7469 §4.2.2** (HTTP Public Key Pinning), a single pin bricks the app on the next cert
rotation because the OS has no fallback to honor. The backup pin is a *different* SPKI that the
app will also accept — commonly the intermediate CA's SPKI, the root SPKI, or the SPKI of a
pre-issued next-rotation key kept offline. Android enforces two-key minimum only as a soft warning,
so the ratchet hard-pins it.

### 4.2 Extract the leaf pin

Run this on the production host that terminates TLS for `app.praeventio.net`, AFTER the production
certificate is deployed and BEFORE the first Android release build:

```bash
echo | openssl s_client -connect app.praeventio.net:443 -servername app.praeventio.net 2>/dev/null \
  | openssl x509 -noout -pubkey \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

Output is a single line of 43 base64 characters (no `=` padding). That is your leaf pin.

> **Tip:** if `app.praeventio.net` is fronted by Cloudflare or another CDN, the leaf you see on
> the wire is the CDN's edge cert — pin THAT, not your origin cert, because all real handshakes
> terminate at the edge.

### 4.3 Choose a backup pin (offline / pre-rotation)

The backup pin MUST be a different SPKI from the leaf. Pick one of:

1. **Intermediate CA SPKI** (recommended for short-lived leaves). Extract it with:
   ```bash
   echo | openssl s_client -connect app.praeventio.net:443 -servername app.praeventio.net 2>/dev/null \
     | openssl x509 -noout -issuer -serial \
     # then fetch the issuing intermediate from the AIA caIssuers URL and run the
     # same pkey / dgst / enc pipeline as §4.2
   ```
2. **Root CA SPKI** (broadest rotation safety, but you trust every cert that root has ever issued
   under the OS trust store).
3. **Pre-issued next-rotation SPKI** (the strongest): generate the *next* production keypair
   offline, get a cert signed for it ahead of time, store the SPKI of the pre-issued cert as the
   backup, and rotate by deploying that pre-issued cert when the current leaf expires.

### 4.4 Patch the network security config

Open `android/app/src/main/res/xml/network_security_config.xml` and replace the two placeholder
strings inside `<pin-set>` with the base64 digests from §4.2 and §4.3. Keep the `digest="SHA-256"`
attribute on every `<pin>` element. Commit the change.

### 4.5 Verify before shipping

```bash
npm run lint:cert-pinning
# expected: "Cert-pinning ratchet: PASS"

npm run test -- src/__tests__/mobile/androidBuildWiring.test.ts
# expected: "AndroidManifest — certificate pinning for app.praeventio.net (MASVS-NETWORK-2)" all green
```

If the ratchet or the unit test fails with `placeholder pin`, you skipped §4.4 — go back and
replace both placeholders. There is no `--force` escape; the gate is the gate.

### 4.6 Rotation playbook

When the leaf cert rotates (renewal, CA change, key compromise):

1. Update the **backup** pin in `network_security_config.xml` to the SPKI of the new leaf. Ship
   this build to the store. At this point the OS has *both* the current leaf and the new leaf in
   the pin set — handshake succeeds against either.
2. Deploy the new cert to the production edge.
3. Update the **leaf** pin in `network_security_config.xml` to the SPKI of the new leaf. Ship this
   build to the store. The OS now expects the new leaf and will reject the old one.
4. After ≥ one full store rollout cycle, you can stop trusting the old leaf by removing it from
   the pin set entirely (keeping only the new leaf + backup). But until then, both must remain in
   the set — Android requires *at least one* pin to match, not *exactly one*.

### 4.7 What this does NOT cover

- **iOS** — iOS uses NSPinnedDomains in `Info.plist` + `NSAppTransportSecurity`. That is a
  separate ticket; this Android-only change does not pin iOS connections.
- **CDN POP changes** that rotate intermediate CAs without notice — review the backup-pin choice
  every quarter; the root-only option is robust against this, the intermediate-CA option is not.
- **Local development** — the dev live-reload loopback (`10.0.2.2`, `localhost`) is in a separate
  `domain-config cleartextTrafficPermitted="true"` block, exempt from pinning.

---

## 5. Pipeline lint (no real builds)

```bash
bash scripts/test-mobile-pipeline.sh
```

Verifies that the scaffold files exist and have valid syntax. CI runs this in the `pipeline-lint` job of `mobile-release.yml`.

---

## 6. Troubleshooting the gates

- **`Android job: This job was skipped` on a fresh repo** — expected. Paste `ANDROID_KEYSTORE_BASE64` and re-run.
- **`iOS job: This job was skipped`** — expected until `MATCH_GIT_URL` is set.
- **`fastfile-lint` fails on iOS Fastfile** — probably means `ios/App/` was not committed yet (see §2.1).
- **`pipeline-lint` fails locally** — run `bash scripts/test-mobile-pipeline.sh` and read the per-step output; missing files are reported with a clear marker.
- **`lint:cert-pinning` fails with `placeholder pin`** — you shipped the literal `PIN_*_REPLACE_AT_PROD_DEPLOY` strings. See [§4.4](#44-patch-the-network-security-config) and replace both pins with real SPKI SHA-256 digests. The gate has no bypass.

---

## 7. Cross-references

- Android keystore generation: [`mobile-build-runbook.md`](./mobile-build-runbook.md) §6.1.
- ADR for the iOS uplift: [`architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md`](./architecture-decisions/0009-mobile-ci-signing-supersedes-0006.md).
- Fastlane workflow file: [`.github/workflows/mobile-release.yml`](../.github/workflows/mobile-release.yml).
- iOS Fastfile: [`ios/App/fastlane/Fastfile`](../ios/App/fastlane/Fastfile).
- Android Fastfile: [`fastlane/Fastfile`](../fastlane/Fastfile).

---

## 8. Battery-optimization exemption for life-safety foreground services

Xiaomi / Huawei / Samsung / OnePlus ship aggressive battery savers that terminate a foreground service within minutes of the screen turning off unless the app is on the OS-level exemption list (`Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`). Without the exemption, the lone-worker check-in loop dies silently after the worker pockets their phone — the supervisor never sees the escalation, the worker never gets help.

### 8.1 What the manifest declares

The host-app manifest (`android/app/src/main/AndroidManifest.xml`) carries the permission:

```xml
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

Plus the body-sensor background gates that the `foregroundServiceType="health"` contract requires when the FGS reads accelerometer at `SENSOR_DELAY_GAME`:

```xml
<uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS" />
<uses-permission android:name="android.permission.BODY_SENSORS_BACKGROUND"
    android:maxSdkVersion="35" />
<uses-permission android:name="android.permission.READ_HEALTH_DATA_IN_BACKGROUND"
    tools:targetApi="36"
    xmlns:tools="http://schemas.android.com/tools" />
```

`BODY_SENSORS_BACKGROUND` is API 33–35 only; `READ_HEALTH_DATA_IN_BACKGROUND` is the API 36+ replacement. The split is per the [Android Developers docs](https://developer.android.com/about/versions/14/changes/fgs-types-required#health).

### 8.2 What the user does

On first launch of the lone-worker page, the app queries `PowerManager.isIgnoringBatteryOptimizations`. If the OS reports the app is still on the battery-optimization list, the app shows an amber CTA (Spanish / English / Portuguese localized in `src/i18n/locales/*/common.json`). Tapping the CTA opens the system Settings page; the user flips "Sin restricciones" / "Unrestricted" and returns to the app. The page re-queries on `window.focus` and the CTA disappears.

The exemption CANNOT be granted programmatically — Android rejects it and Play Console flags apps that try. The runtime CTA is the only legitimate path.

### 8.3 OEM quirks

- **Xiaomi MIUI** strips the `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` activity in some builds. The plugin's `BatteryOptimizationPlugin` falls back to `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, then to a manual error message.
- **Huawei EMUI** requires the user to also enable "App launch" → "Manage manually" in addition to the battery exemption. The CTA copy points at this; the OS handles it.
- **Samsung One UI** honours the exemption; no extra step.

### 8.4 Testing the exemption

The integration test path is:

1. Install the production APK on a Xiaomi / Huawei device (emulators don't simulate the OEM battery saver).
2. Start a lone-worker session; verify the amber CTA appears.
3. Lock the screen, leave the phone in a pocket for 10 minutes.
4. Unlock; verify the supervisor dashboard shows continuous check-ins (no gap > 5 minutes).
5. Repeat the test WITHOUT the exemption granted; verify check-ins stop after ~3 minutes on Xiaomi.

The CI test (`src/__tests__/mobile/androidBuildWiring.test.ts`, describe block "FGS health background permissions") validates the manifest contract; the field test above validates the OS behaviour.
