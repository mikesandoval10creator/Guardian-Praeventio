# Mobile signing runbook — Android + iOS deep links

**Scope:** prepare `assetlinks.json` (Android App Links) and `apple-app-site-association` (Universal Links) for production release.

**Audience:** DevOps + release manager.

**Status:** code is ready; only requires real signing artifacts. This runbook documents the exact commands the owner of the signing keys must run.

---

## Why this is blocked on the human

The two files involved live at:

- `public/.well-known/assetlinks.json` — currently contains `"REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD"`
- `public/.well-known/apple-app-site-association` — currently uses `TEAMID.com.praeventio.guard` as placeholder

Filling them requires:

1. **Android:** the production keystore (`.jks`) used to sign the Play Store release. Without the keystore there is no SHA-256 to compute.
2. **iOS:** a paid Apple Developer Program account (US$ 99/year) to know the assigned `TEAMID`.

Until both exist, the code paths that consume these files (`AndroidManifest.xml` intent filter, `capacitor.config.ts:34-51`) keep working in dev with the placeholders.

---

## Android — `assetlinks.json`

### Prerequisites

- Java JDK 11+ (`keytool` on PATH).
- Production keystore created (one-time):
  ```sh
  keytool -genkey -v \
    -keystore guardian-praeventio-release.jks \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -alias praeventio-release
  ```
  Store the keystore + password in 1Password / Google Secret Manager — **never in git**.

### Compute the SHA-256

```sh
keytool -list -v \
  -keystore guardian-praeventio-release.jks \
  -alias praeventio-release \
| grep "SHA256:" \
| awk '{print $2}'
```

The output is the colon-separated hex string Android expects, e.g.
`14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1E:1B:53:8A:1B:0F:9C:F1:1B:DD:64`.

### Update the file

Open `public/.well-known/assetlinks.json` and replace the placeholder in the existing entry:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.praeventio.guard",
      "sha256_cert_fingerprints": [
        "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1E:1B:53:8A:1B:0F:9C:F1:1B:DD:64"
      ]
    }
  }
]
```

If a **debug** SHA-256 is also wanted for staging deep-link testing, add a second entry with the debug keystore's fingerprint.

### Verify

Once deployed to `https://app.praeventio.cl/.well-known/assetlinks.json`:

```sh
curl -s https://app.praeventio.cl/.well-known/assetlinks.json | jq '.[0].target.sha256_cert_fingerprints'
```

Google's [Digital Asset Links verifier](https://developers.google.com/digital-asset-links/tools/generator) can sanity-check the file.

---

## iOS — `apple-app-site-association`

### Prerequisites

- Active Apple Developer Program enrollment (paid).
- Bundle identifier registered in App Store Connect for `com.praeventio.guard`.
- The Team ID (10 alphanumeric chars) visible at <https://developer.apple.com/account> → "Membership Details".

### Update the file

Open `public/.well-known/apple-app-site-association` and replace `TEAMID` with the real one (no quotes around it; it joins with the bundle id):

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "A1B2C3D4E5.com.praeventio.guard",
        "paths": ["/m/*", "/audit-portal/*"]
      }
    ]
  }
}
```

Important:

- The file **must** be served as `Content-Type: application/json` (or no extension) over HTTPS.
- It must NOT be redirected — Apple's link daemon refuses redirects.
- Verify it's reachable at `https://app.praeventio.cl/.well-known/apple-app-site-association` (no `.json` extension).

### Verify

```sh
curl -sI https://app.praeventio.cl/.well-known/apple-app-site-association
# Esperado: HTTP/2 200, Content-Type: application/json
```

Apple provides a [validator](https://search.developer.apple.com/appsearch-validation-tool/) (requires sign-in).

---

## CI guardrail

After both files have real values, add a release-time check to `.github/workflows/deploy.yml`:

```yaml
- name: Validate signing artifacts
  run: |
    grep -q "REPLACE_WITH_REAL_SHA256" public/.well-known/assetlinks.json && {
      echo "::error::assetlinks.json still contains placeholder"
      exit 1
    } || true
    grep -q "^TEAMID\\." public/.well-known/apple-app-site-association && {
      echo "::error::apple-app-site-association still contains placeholder TEAMID"
      exit 1
    } || true
```

This blocks accidental shipping of placeholders.

---

## Rotation

- **Android keystore:** never rotate. If lost or stolen, you cannot publish updates to the same Play Store listing. The `sha256_cert_fingerprints` array in `assetlinks.json` accepts multiple values, so during a Play App Signing migration both old and new fingerprints can coexist.
- **iOS Team ID:** does not rotate unless the dev account changes ownership. The file would need a one-line update + redeploy of the static web bundle.

---

## Automation scripts

Once the human has the keystore and Team ID, prefer the helper scripts over
hand-editing the `.well-known/` files — they validate JSON and never leave a
partial write behind.

### `scripts/fill-android-assetlinks.mjs`

Reads a release keystore, runs `keytool -list -v` under the hood, extracts the
SHA-256 fingerprint, and writes it into `assetlinks.json`. The keystore stays
local (the script does not exfiltrate it anywhere).

Usage:

```sh
# Variant 1 — script invokes keytool itself
node scripts/fill-android-assetlinks.mjs \
  --keystore /secure/guardian-praeventio-release.jks \
  --alias praeventio-release \
  --storepass "$ANDROID_KEYSTORE_PASSWORD" \
  --keypass   "$ANDROID_KEY_PASSWORD"

# Variant 2 — paste an already-computed fingerprint (useful in CI where the
# keytool output is already in the logs from `mobile-release.yml`)
node scripts/fill-android-assetlinks.mjs \
  --sha256 "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1E:1B:53:8A:1B:0F:9C:F1:1B:DD:64"

# Variant 3 — preview only, no write
node scripts/fill-android-assetlinks.mjs --sha256 "<fingerprint>" --dry-run

# Variant 4 — add a second fingerprint (e.g. Play App Signing upload + signing key)
node scripts/fill-android-assetlinks.mjs --sha256 "<other-fp>" --append
```

Env-var equivalents (the same names `.github/workflows/mobile-release.yml`
already uses):

| CLI flag        | Env var                       |
|-----------------|-------------------------------|
| `--keystore`    | `ANDROID_KEYSTORE_PATH`       |
| `--alias`       | `ANDROID_KEY_ALIAS`           |
| `--storepass`   | `ANDROID_KEYSTORE_PASSWORD`   |
| `--keypass`     | `ANDROID_KEY_PASSWORD`        |
| `--sha256`      | `ANDROID_SHA256`              |
| `--file`        | `ASSETLINKS_FILE`             |

Exit codes: `0` ok / `1` bad args / `2` keytool failed / `3` JSON validation
failed (file is never partially written).

### `scripts/fill-ios-aasa.mjs`

Replaces every `TEAMID.` prefix in
`public/.well-known/apple-app-site-association` with the real 10-character
Apple Team ID.

```sh
node scripts/fill-ios-aasa.mjs --team-id A1B2C3D4E5
# or via env: APPLE_TEAM_ID=A1B2C3D4E5 node scripts/fill-ios-aasa.mjs
# preview only: --dry-run
```

Both scripts are idempotent — re-running with the same input does not
re-write the file, so they are safe to call from CI on every release.

---

## Play Console — uploading the keystore for the first time

This is the one-time setup that ties our local keystore to Google Play App
Signing. Do this after `keytool -genkey` but before the first AAB upload.

1. Generate an **upload keystore** locally (the snippet at the top of this
   runbook). Back it up to 1Password before doing anything else.
2. In Play Console: pick the app → **Setup → App integrity → App signing**.
3. Choose **Use a separate upload key**. Download the encrypted PEM that
   Play returns and follow the on-screen `pepk` command to encrypt your
   upload key for upload (Google asks for it on first push so they can
   sign on your behalf).
4. Confirm **Play App Signing** is enabled. From this point Play holds the
   release signing key; your local keystore is only the upload key.
5. Copy **both** SHA-256 fingerprints out of Play Console
   (**App integrity → App signing → App signing key certificate** and
   **Upload key certificate**) and add both to `assetlinks.json` using
   `--append`:

   ```sh
   node scripts/fill-android-assetlinks.mjs --sha256 "<app-signing-fp>"
   node scripts/fill-android-assetlinks.mjs --sha256 "<upload-key-fp>" --append
   ```

   Two entries is the supported config; Android verifies a link if *any*
   listed fingerprint matches.
6. Base64-encode the upload keystore and push it as a GitHub secret named
   `ANDROID_KEYSTORE_BASE64` (see `.github/workflows/mobile-release.yml`
   for the consumer side).

---

## iOS — Xcode signing & capabilities

After enrolling in the Apple Developer Program:

1. In Xcode, open `ios/App/App.xcworkspace` (this directory only exists
   after `npx cap add ios` has been run once on a macOS workstation).
2. Select the **App** target → **Signing & Capabilities**.
3. Check **Automatically manage signing**. Pick your team from the
   dropdown — Xcode generates the provisioning profile and shows the
   Team ID next to the team name. Copy it.
4. Run `node scripts/fill-ios-aasa.mjs --team-id <TEAM_ID>`.
5. Still in **Signing & Capabilities**, click **+ Capability** and add
   **Associated Domains**. Append:
   ```
   applinks:praeventio.app
   webcredentials:praeventio.app
   ```
   (Use the actual production host. `apple-app-site-association` MUST be
   served from the apex you list here, over HTTPS, with
   `Content-Type: application/json` and no redirects.)
6. Commit the resulting `ios/App/App.xcodeproj/project.pbxproj` change.

Where the Team ID lives in the Apple portal, if you do not want to round-trip
through Xcode:
<https://developer.apple.com/account> → **Membership Details** → the
**Team ID** field (10 alphanumeric characters next to your team name).

---

## Verification — does the deep link actually resolve?

After the web bundle ships and the app build is on a device, run these on a
machine with `adb` (Android) or a Mac with the device tethered (iOS):

### Android

```sh
# Phone connected via USB with USB debugging on.
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://praeventio.app/sos" \
  com.praeventio.guard

# Expected: status=ok, the app opens directly on /sos (no chooser dialog).
# If the chooser appears, the assetlinks SHA does NOT match what the device
# sees. Re-run scripts/fill-android-assetlinks.mjs with the correct keystore.
```

To force the system to re-fetch and re-verify `assetlinks.json` on the device
(useful after fixing a wrong fingerprint):

```sh
adb shell pm set-app-links --package com.praeventio.guard 0 all
adb shell pm verify-app-links --re-verify com.praeventio.guard
adb shell pm get-app-links com.praeventio.guard
# Look for: "verified" next to the host you care about.
```

### iOS

On the test device, long-press a `https://praeventio.app/sos` link in Notes
or Messages → **Open in "Praeventio"** must be the default action. If iOS
falls back to Safari, the AASA file is wrong or not reachable. Re-check:

```sh
# Apple's CDN may cache the AASA for up to ~24h. If you just rotated team id,
# reinstall the app to force a fresh fetch.
curl -sI https://praeventio.app/.well-known/apple-app-site-association
curl -s  https://praeventio.app/.well-known/apple-app-site-association | jq .
```

---

## Related

- Plan integral Fase C.1 (Mobile signing pipeline)
- `capacitor.config.ts:34-51` (intent filters consuming these files)
- `AndroidManifest.xml` deep-link declaration
- `scripts/fill-android-assetlinks.mjs`, `scripts/fill-ios-aasa.mjs`
- `.github/workflows/check-mobile-signing.yml` (CI guardrail)
- `.github/workflows/mobile-release.yml` (Fastlane upload pipeline)
