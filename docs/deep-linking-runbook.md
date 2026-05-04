# Deep linking runbook — Universal Links (iOS) + App Links (Android)

**Sprint:** 21 (Bucket G)
**Goal:** When a user receives a link such as `https://praeventio.app/projects/abc123/sos` via WhatsApp, email, SMS, etc., tapping it should open directly inside the installed Capacitor app. If the app is not installed, the link must fall through to the PWA in the user's default browser.

**Companion docs:**
- [`mobile-build-runbook.md`](./mobile-build-runbook.md) — Android + iOS native build flow.
- [`architecture-decisions/0006-mobile-deferred-to-local-build.md`](./architecture-decisions/0006-mobile-deferred-to-local-build.md) — why native folders are not generated in CI.

---

## 1. Architecture overview

```
WhatsApp / email / SMS
  └─ user taps https://praeventio.app/sos?lat=...
        │
        ├─ App installed + association verified
        │     └─ OS opens Capacitor app
        │           └─ @capacitor/app  appUrlOpen  event
        │                 └─ src/main.tsx dispatches CustomEvent
        │                       └─ DeepLinkHandler  navigate(slug)
        │
        └─ App not installed (or association not verified)
              └─ Default browser opens the PWA at the same URL
```

The web fallback is automatic: the same URL renders the same React route in the PWA. No extra code is needed for the fallback case.

---

## 2. Apple — Universal Links

### 2.1 Files in this repo
- [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association) — the Apple App Site Association (AASA) JSON manifest. MUST NOT have a `.json` extension.
- [`server.ts`](../server.ts) — explicit Express route handler that forces `Content-Type: application/json` for the file (Apple rejects any other content type).

### 2.2 Pre-store-build checklist
1. **Replace `TEAMID`** in [`apple-app-site-association`](../public/.well-known/apple-app-site-association). Both the `applinks.details[0].appID` value and the `webcredentials.apps[0]` value contain `TEAMID.com.praeventio.guard`. Find the real Team ID at https://developer.apple.com/account → Membership → Team ID (10 character alphanumeric, e.g. `9JA89QQLNQ`).
2. **Add the Associated Domains capability** in Xcode:
   - Open `ios/App/App.xcworkspace`.
   - Select the `App` target → "Signing & Capabilities" tab.
   - Click `+ Capability` → "Associated Domains".
   - Add the entry: `applinks:praeventio.app`
   - Xcode writes this into `ios/App/App/App.entitlements`. Commit the change.
3. **Verify AASA delivery** in production:
   ```bash
   curl -I https://praeventio.app/.well-known/apple-app-site-association
   # MUST return:
   #   HTTP/2 200
   #   content-type: application/json
   # No redirect (no 301/302), no `application/octet-stream`.
   ```
4. **Force Apple's CDN to refresh** (Apple caches AASA aggressively, ~24h TTL):
   - Run a build of the app on a real device with a developer profile.
   - Use `swcutil show --id <bundle-id>` on the device's macOS host to inspect the AASA fetch log. Look for `Status: 0 (success)` and `Active: 1`.
   - Apple staff also recommend bumping the CDN by tweaking the AASA file's whitespace and re-uploading.

### 2.3 Local dev caveat
Apple's `swcutil` only fetches AASA over HTTPS. Local dev (`http://10.0.2.2:5173` or `http://localhost`) will NOT trigger Universal Links — testing requires either a real HTTPS staging environment OR a tunneling tool (e.g., ngrok, Cloudflare Tunnel) with a valid TLS cert.

---

## 3. Google — Android App Links

### 3.1 Files in this repo
- [`public/.well-known/assetlinks.json`](../public/.well-known/assetlinks.json) — Digital Asset Links statement. Lists the SHA-256 fingerprints of the keystores allowed to claim `https://praeventio.app`.
- [`server.ts`](../server.ts) — explicit handler ensuring `Content-Type: application/json`.
- [`capacitor.config.ts`](../capacitor.config.ts) — documents the `<intent-filter android:autoVerify="true">` block that must be added to `android/app/src/main/AndroidManifest.xml` after `npx cap add android`. Capacitor 8 has no config-object API for custom intent filters, so this is a one-time manual edit.

### 3.2 Pre-store-build checklist
1. **Build the signed APK / AAB** with the production keystore. See [`mobile-build-runbook.md`](./mobile-build-runbook.md) §3 for the keystore creation flow.
2. **Extract the SHA-256 fingerprint** from the production keystore:
   ```bash
   keytool -list -v -keystore release.keystore -alias praeventio | grep SHA256
   # Output:
   #   SHA256: 14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:...
   ```
   (If you also distribute via Play App Signing, repeat for the upload key AND grab the Play-managed signing fingerprint from Play Console → Setup → App signing.)
3. **Replace `REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD`** in [`assetlinks.json`](../public/.well-known/assetlinks.json) with the colon-separated fingerprint (exactly as `keytool` prints it). The field is an array — add multiple entries if you ship from multiple keystores.
4. **Add the intent filter** in `android/app/src/main/AndroidManifest.xml`. Inside the existing `<activity android:name=".MainActivity" ...>` block, add:
   ```xml
   <intent-filter android:autoVerify="true">
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="https" android:host="praeventio.app" />
   </intent-filter>
   ```
   `android:autoVerify="true"` triggers the OS-level verification that fetches `https://praeventio.app/.well-known/assetlinks.json` on first install.
5. **Verify with Google's validator**:
   ```
   https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://praeventio.app&relation=delegate_permission/common.handle_all_urls
   ```
   Successful output is a JSON document with one or more statements echoing your `package_name` and fingerprint.
6. **Verify the device-side state** after install:
   ```bash
   adb shell pm get-app-links com.praeventio.guard
   # Look for: praeventio.app: verified
   ```
   If you see `verified`: App Links are active. If you see `legacy_failure` or `none`: re-check fingerprint match and assetlinks.json delivery.

---

## 4. Server-side delivery requirements (both platforms)

`server.ts` mounts dedicated handlers for both files (above the `/api/` rate limiter — these are unauthenticated and not subject to throttling).

| Requirement | iOS | Android |
|---|---|---|
| HTTPS | Required | Required |
| Content-Type | `application/json` exactly | `application/json` exactly |
| Redirects | Forbidden (Apple drops the file) | Forbidden |
| Path | `/.well-known/apple-app-site-association` | `/.well-known/assetlinks.json` |
| File extension | NONE (no `.json`) | `.json` |
| Auth / cookies | Public, no auth | Public, no auth |

The Vite dev server also serves `public/` automatically, so dev round-trips work for shape verification (`curl http://localhost:5173/.well-known/assetlinks.json`). For Universal Link verification you still need HTTPS — see §2.3.

---

## 5. End-to-end test (manual, post-store-build)

1. Install the signed app on a real device.
2. From a different device (or another app on the same device), send a message containing `https://praeventio.app/sos?lat=-33.4&lng=-70.6` via WhatsApp / Telegram / email.
3. Tap the link.
4. **Expected**: the OS opens the Praeventio app directly on the SOS screen with the latitude/longitude query params preserved.
5. **Fallback**: uninstall the app and tap the same link again. The default browser opens the PWA at the same URL.

If the OS shows a chooser ("Open with…") instead of going straight to the app:
- iOS: Universal Link fell through to the universal-search behavior. Re-check Associated Domains entitlement + AASA cache.
- Android: `autoVerify` failed. Re-check assetlinks.json fingerprint + `adb shell pm get-app-links` output.

---

## 6. Code map

| Component | Path | Role |
|---|---|---|
| AASA manifest | [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association) | iOS Universal Links association |
| Asset links | [`public/.well-known/assetlinks.json`](../public/.well-known/assetlinks.json) | Android App Links association |
| Server middleware | [`server.ts`](../server.ts) (Bucket G block) | Forces correct `Content-Type` |
| Native listener | [`src/main.tsx`](../src/main.tsx) | `@capacitor/app` `appUrlOpen` → CustomEvent |
| Router bridge | [`src/components/shared/DeepLinkHandler.tsx`](../src/components/shared/DeepLinkHandler.tsx) | CustomEvent → `useNavigate(slug)` |
| Capacitor config | [`capacitor.config.ts`](../capacitor.config.ts) | Documents Android intent-filter + iOS entitlement requirements |
| Tests | [`src/components/shared/DeepLinkHandler.test.tsx`](../src/components/shared/DeepLinkHandler.test.tsx) | Unit coverage for the bridge |
