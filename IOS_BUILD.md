# Guardian Praeventio — Build iOS

**Owner:** Agent B2 (Round, 2026-04-28) — hands off to whoever ships the first iOS TestFlight.
**Status:** Capacitor plugin (`@perfood/capacitor-healthkit@^1.3.2`) is installed in `package.json` and wired through `src/services/health/healthKitAdapter.ts`. The native iOS Xcode project has **NOT** been generated yet (no `ios/` directory in this repo). When `npx cap add ios` is run on a macOS machine, the templates in this document MUST be applied before the app can request HealthKit permissions on a real iPhone.

---

## 0. Why iOS native config is mandatory

Apple rejects builds that talk to HealthKit without:

1. Two `Info.plist` strings (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`).
2. The HealthKit **capability** enabled on the Xcode target — this writes the `com.apple.developer.healthkit` entitlement into `App.entitlements` and the App ID's provisioning profile.
3. A Distribution provisioning profile (Apple Developer account, $99/year) that includes the HealthKit entitlement.

The Capacitor plugin auto-discovers via CocoaPods (`PerfoodCapacitorHealthkit.podspec` ships in `node_modules/@perfood/capacitor-healthkit/`). It does **NOT** require a `plugins.CapacitorHealthkit` block in `capacitor.config.ts` — see the comment in that file.

This document also pre-declares the Info.plist usage strings for the **other** native permissions Praeventio Guard needs (Location, Camera, Microphone, Bluetooth, Contacts, Motion). Apple's review team will reject the binary if any of these are missing when the runtime API is called.

---

## 1. Prerequisites

- macOS 13 (Ventura) or newer with **Xcode 15+** installed (`xcode-select --install`).
- **CocoaPods 1.13+** — `sudo gem install cocoapods` (or `brew install cocoapods`).
- **Apple Developer account** ($99/year) — required to run on a physical device beyond 7 days, and required for TestFlight + App Store distribution.
- **Capacitor CLI** — already in this repo's `node_modules` via `@capacitor/cli`. Use `npx cap` (do not install globally; the version pin lives in `package.json`).
- A signed-in Apple ID in Xcode > Settings > Accounts with a development team selected.

---

## 2. First-time setup (run once on macOS)

### 2.1 Build the web bundle

```bash
npm install
npm run build
```

The Vite build emits to `dist/`. Capacitor reads `webDir: 'dist'` from `capacitor.config.ts` and copies that into the iOS app on every `cap sync`.

### 2.2 Add the iOS platform

```bash
npx cap add ios
```

This creates the `ios/App/` Xcode workspace. Commit it to source control once the Info.plist + entitlements edits below are applied. After this command completes, the directory tree is roughly:

```
ios/
  App/
    App.xcodeproj/
    App.xcworkspace/
    App/
      AppDelegate.swift
      Info.plist             <-- you edit this
      App.entitlements       <-- you create/edit this
      Assets.xcassets/
      public/                <-- mirror of dist/
    Podfile
    Podfile.lock
```

### 2.3 Sync Capacitor plugins into the iOS project

```bash
npx cap sync ios
```

`cap sync` runs `pod install` under the hood, pulling in `PerfoodCapacitorHealthkit`, `CapacitorSQLite`, `CapacitorPushNotifications`, and the Capacitor core pods. Re-run this after every `npm install` and every `npm run build`.

### 2.4 Apply the Info.plist edits

Open `ios/App/App/Info.plist` in Xcode (right-click > Open As > Source Code) and paste the keys from [section 6.1](#61-infoplist-full) inside the top-level `<dict>`.

### 2.5 Apply the entitlements

Create `ios/App/App/App.entitlements` (if it doesn't already exist) with the contents of [section 6.2](#62-appentitlements-full).

### 2.6 Enable HealthKit capability in Xcode

Even with the entitlements file present, Xcode requires the capability to be toggled in the UI so it can wire it into the App ID:

1. `npx cap open ios` — opens the workspace in Xcode.
2. Select the **App** target (left sidebar) > **Signing & Capabilities** tab.
3. Click **+ Capability** > **HealthKit**.
4. Tick the **Clinical Health Records** box ONLY if you intend to read FHIR records (Praeventio Guard does NOT — leave unchecked).
5. Verify Xcode automatically updated the App ID on the developer portal (it shows a green checkmark next to the capability).

Repeat step 3 for any other capabilities the build needs:

- **Push Notifications** (already used by `@capacitor/push-notifications`).
- **Background Modes** > tick **Remote notifications** if you push silent updates.
- **Associated Domains** if you set up universal links (deep links into the app).

### 2.7 Configure bundle ID and team

In **Signing & Capabilities**:

- **Bundle Identifier:** `com.praeventio.guard` (matches `appId` in `capacitor.config.ts`). If your Apple Developer org owns a different reverse-DNS prefix, update both this field AND `capacitor.config.ts` simultaneously — they MUST match or signing fails.
- **Team:** select your Apple Developer team from the dropdown.
- **Automatically manage signing:** leave checked for development. For App Store distribution, switch to a manual provisioning profile generated on developer.apple.com.

### 2.8 Build & run

```bash
# Simulator (HealthKit support is partial on simulator; M-series Mac required for HK on simulator)
npx cap run ios

# Or open Xcode and Cmd+R against a connected device
npx cap open ios
```

---

## 3. Daily workflow

Once the project is set up, the loop is:

```bash
# 1. Edit web code
# 2. Rebuild dist/
npm run build

# 3. Push the web bundle into the Xcode project
npx cap sync ios

# 4. Run on device or simulator
npx cap run ios       # CLI
# or open the workspace in Xcode and hit Cmd+R
```

Live-reload (the `server.url` block in `capacitor.config.ts`) only fires when `NODE_ENV !== 'production'`. **Strip the `server` block before any release build** — Apple rejects binaries that load remote HTTP origins on launch.

---

## 4. TestFlight distribution

1. In Xcode > Product > **Archive** (must be on a "Generic iOS Device" target, not a simulator).
2. When the Organizer window opens, select the new archive > **Distribute App** > **App Store Connect** > **Upload**.
3. Wait ~10-30 minutes for App Store Connect to process the binary.
4. In App Store Connect > TestFlight, add internal testers (up to 100 Apple IDs in your dev team) — they install via the TestFlight iOS app.
5. For external testers (up to 10,000), submit the build for **Beta App Review** — this is a lighter-weight review than App Store proper, usually approved within 24h.

---

## 5. App Store review checklist (HealthKit-specific)

Apple's app review team rejects HealthKit apps for these reasons frequently — pre-empt them:

- [ ] **Both** `NSHealthShareUsageDescription` AND `NSHealthUpdateUsageDescription` are present, even if you only read. (If you truly never write, you can omit `Update` — but the plugin's `requestAuthorization` accepts a `write` array, so safest is to include both.)
- [ ] Each usage string is **1-2 sentences** explaining (a) what data is accessed, (b) what the app does with it, (c) implicitly that the data stays on-device or is processed under the user's consent. Vague strings like "Read health data" trigger automatic rejection.
- [ ] HealthKit capability is enabled on the **Distribution** provisioning profile (not just Development) — check at developer.apple.com > Certificates, IDs & Profiles > your App ID.
- [ ] App Privacy disclosures in App Store Connect declare:
  - **Health & Fitness data:** Heart rate, Steps, Active energy burned, Sleep — purpose: App Functionality, Analytics. Linked to identity? **No** (data stays on-device or is processed as aggregate metrics).
  - **Sensitive Info:** Health and Fitness > **Health**.
- [ ] Privacy policy URL submitted with the app explicitly mentions HealthKit and confirms the data is not sold or shared.
- [ ] If you implement **HealthKit background delivery** (we don't yet), declare `UIBackgroundModes` > `processing` in Info.plist and explain the use in the review notes.

---

## 6. Bloques copy-paste

### 6.1 Info.plist (full)

Paste these keys inside the top-level `<dict>` of `ios/App/App/Info.plist`. Do **not** create a new `<plist>` wrapper — the file already has one. The wording below is honest, specific, and references the user's right to revoke (which Apple's reviewer looks for).

```xml
<key>NSHealthShareUsageDescription</key>
<string>Praeventio Guard usa los datos de salud de tu Apple Watch o iPhone (frecuencia cardíaca, pasos, calorías, sueño) para detectar fatiga y riesgos ergonómicos en tu jornada de trabajo. La data permanece en tu dispositivo; solo procesamos métricas agregadas. Puedes revocar el permiso en Configuración > Privacidad > Salud.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>Praeventio Guard puede registrar entrenamientos de pausa activa y eventos de seguridad en tu app Salud de Apple, si tú lo apruebas explícitamente. Esto es opcional y desactivable en Configuración > Privacidad > Salud.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>Praeventio Guard usa tu ubicación durante la jornada para detectar zonas de riesgo (geofencing), cargar la normativa local (Chile, Perú, Colombia, etc.) y dimensionar rutas de evacuación. La ubicación NUNCA se comparte con terceros y puedes revocar el permiso en cualquier momento desde Configuración.</string>

<key>NSCameraUsageDescription</key>
<string>Praeventio Guard usa la cámara para análisis de postura ergonómica REBA/RULA on-device (procesamiento local con MediaPipe) y captura de evidencia fotográfica de incidentes/condiciones de trabajo. Las imágenes no se suben sin tu confirmación explícita.</string>

<key>NSMicrophoneUsageDescription</key>
<string>Praeventio Guard usa el micrófono opcionalmente para mediciones de ruido ambiental contra el protocolo PREXOR (DS 594). Solo se activa cuando inicias una medición explícita y puedes revocar el permiso en Configuración.</string>

<key>NSBluetoothAlwaysUsageDescription</key>
<string>Praeventio Guard usa Bluetooth para conectar wearables certificados (pulsómetros, sensores de gases) que el supervisor de prevención de riesgos haya emparejado. El emparejamiento es opt-in y puedes desconectar el dispositivo en cualquier momento.</string>

<key>NSBluetoothPeripheralUsageDescription</key>
<string>Praeventio Guard usa Bluetooth para comunicarse con sensores de seguridad emparejados por tu supervisor de prevención de riesgos.</string>

<key>NSContactsUsageDescription</key>
<string>Praeventio Guard puede acceder a tus contactos para configurar contactos de emergencia (Modo SOS / Hombre Caído). Es opcional y solo se usa con tu confirmación explícita.</string>

<key>NSMotionUsageDescription</key>
<string>Praeventio Guard usa los sensores de movimiento del iPhone para detectar caídas, posturas peligrosas y fatiga durante la jornada laboral. El procesamiento es 100% on-device.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Praeventio Guard usa la galería para adjuntar evidencia fotográfica a reportes de incidentes o checklists de seguridad. Solo accede a las fotos que tú selecciones.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>Praeventio Guard puede guardar reportes de incidentes y certificados de capacitación en tu galería para que tengas tu propia copia.</string>
```

> **Note on `NSBluetoothAlwaysUsageDescription` vs `NSBluetoothPeripheralUsageDescription`:** since iOS 13 Apple recommends `Always`. The deprecated `Peripheral` key is included as a belt-and-suspenders for older iOS versions and to silence App Store Connect warnings.

### 6.2 App.entitlements (full)

Create `ios/App/App/App.entitlements` with this exact content. The HealthKit capability toggle in Xcode (section 2.6) writes the same XML into this file — you only need to create it manually if you're scripting the project setup.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.healthkit</key>
    <true/>
    <key>com.apple.developer.healthkit.access</key>
    <array/>
    <key>aps-environment</key>
    <string>production</string>
</dict>
</plist>
```

Notes:

- `com.apple.developer.healthkit.access` is an **empty array**. That's intentional — it disables Clinical Health Records (FHIR) access. We don't read FHIR.
- `aps-environment` set to `production` enables Push Notifications. For development builds Xcode auto-substitutes `development` via the build configuration. If you maintain a separate `App.Debug.entitlements`, set that one to `<string>development</string>`.
- For Sign in with Apple (if added later), append `<key>com.apple.developer.applesignin</key><array><string>Default</string></array>`.

### 6.3 capacitor.config.ts — current ios block (no edits needed)

The `@perfood/capacitor-healthkit` plugin does NOT take a `plugins.CapacitorHealthkit` config block (verified against `node_modules/@perfood/capacitor-healthkit/README.md` and the published v1.3.2 API). The existing `ios:` block in `capacitor.config.ts` already sets sane defaults (`backgroundColor`, `contentInset`, `limitsNavigationsToAppBoundDomains`). **No change is required for this round.**

If a future plugin version (v2 alpha is in development) introduces init options, add them under `plugins.CapacitorHealthkit` and re-document here.

---

## 7. Troubleshooting

### HealthKit permission dialog doesn't appear

- Verify `NSHealthShareUsageDescription` is in `Info.plist`. Apple silently no-ops `requestAuthorization` if the key is missing (no error, no dialog).
- Verify the HealthKit capability is enabled on the target (`Signing & Capabilities` tab in Xcode).
- HealthKit only works on **real devices and Apple Silicon simulators (Xcode 14+)**. Intel Mac simulators return `isHealthDataAvailable() == false`.
- If the dialog showed once and the user denied, it never re-prompts. Direct the user to **Settings > Privacy > Health > Praeventio Guard** to flip the toggles back on.

### `pod install` fails with "incompatible architectures"

- Ensure CocoaPods is 1.13+ (`pod --version`).
- On Apple Silicon Macs, run `arch -x86_64 pod install` inside `ios/App/` if you hit ffi-related crashes (rare since Pods 1.12).

### App rejected from App Store: "vague usage strings"

- See the wording above; each string explicitly answers *what data, why, and how to revoke*.
- App Store reviewers test `requestAuthorization` blindly — make sure the dialog appears even if the user has never opened the relevant feature in the app yet.

### App rejected: "missing Health App Privacy disclosure"

- App Store Connect > App Privacy > Edit. Declare every type listed in section 5 above.

### `npx cap sync ios` reports "ios platform not added"

- You skipped section 2.2. Run `npx cap add ios` first. The platform must exist locally; it is **not** committed to this repo until macOS bootstraps it.

### Live-reload (`server.url`) doesn't load on device

- Confirm the device is on the **same Wi-Fi** as your dev machine.
- Replace `10.0.2.2` (Android emulator alias) with your Mac's LAN IP — `10.0.2.2` does not resolve on iOS. Edit `capacitor.config.ts`:
  ```ts
  server: { url: 'http://192.168.1.42:5173', cleartext: true }
  ```
- iOS App Transport Security blocks `cleartext: true` unless you also add `NSAppTransportSecurity` > `NSAllowsArbitraryLoads` to `Info.plist` for development builds. Strip both before release.

---

## 8. Checklist before tagging the first iOS release

- [ ] `ios/` directory committed to git (after `npx cap add ios` runs successfully).
- [ ] `ios/App/App/Info.plist` contains every key in section 6.1.
- [ ] `ios/App/App/App.entitlements` matches section 6.2.
- [ ] HealthKit capability visible under Signing & Capabilities in Xcode.
- [ ] Bundle identifier matches `com.praeventio.guard` in `capacitor.config.ts`.
- [ ] `server` block in `capacitor.config.ts` is gated by `NODE_ENV` (already is — verify it's empty when `NODE_ENV=production`).
- [ ] App Privacy disclosures filled out in App Store Connect (section 5).
- [ ] Privacy policy URL public and live; references HealthKit by name.
- [ ] Tested on a **real iPhone**, not just simulator — HealthKit data shape differs.
- [ ] Tested permission revocation flow (deny in dialog -> verify graceful fallback to noop adapter, no crashes).

---

## 9. Cross-references

- `src/services/health/healthKitAdapter.ts` — TypeScript adapter; comments at the top of the file restate the native iOS config requirement.
- `HEALTH_CONNECT_MIGRATION.md` — Android/Health Connect counterpart and the broader migration plan.
- `capacitor.config.ts` — appId, ios block, plugin registry. Bundle ID and `iosKeychainPrefix` (for `CapacitorSQLite` encryption) live here.
- Apple docs: <https://developer.apple.com/documentation/healthkit/protecting_user_privacy>
- Plugin: <https://github.com/perfood/capacitor-healthkit>
