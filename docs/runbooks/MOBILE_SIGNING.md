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

## Related

- Plan integral Fase C.1 (Mobile signing pipeline)
- `capacitor.config.ts:34-51` (intent filters consuming these files)
- `AndroidManifest.xml` deep-link declaration
