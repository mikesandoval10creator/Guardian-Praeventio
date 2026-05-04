import type { CapacitorConfig } from '@capacitor/cli';

// Sprint 20 mobile-prep validation (Brecha A — Fase 4):
// - appId / appName / webDir are the canonical fields required for `cap add`.
// - `bundledWebRuntime` was removed in Capacitor 4+; the CLI now auto-injects
//   the runtime, so we deliberately do NOT set it. Verified against
//   @capacitor/cli@^8.3.0 in package.json.
// - Native folders (`android/`, `ios/`) are NOT generated yet. See
//   `docs/mobile-build-runbook.md` for the local-build flow and
//   `docs/architecture-decisions/0006-mobile-deferred-to-local-build.md`
//   for the rationale.

const isProd = process.env.NODE_ENV === 'production';

const config: CapacitorConfig = {
  appId: 'com.praeventio.guard',
  appName: 'Praeventio Guard',
  webDir: 'dist',
  // In dev: point to local server so live-reload works on device
  // In prod: uses bundled dist/ — remove the server block before store builds
  ...(!isProd && {
    server: {
      url: 'http://10.0.2.2:5173', // Android emulator → host machine
      cleartext: true,
    }
  }),
  android: {
    backgroundColor: '#18181b',
    allowMixedContent: false,
    webContentsDebuggingEnabled: !isProd,
    // Sprint 21 — Bucket G: Android App Links (auto-verify via
    // /.well-known/assetlinks.json on https://praeventio.app).
    //
    // NOTE: `intentFilters` is NOT part of the Capacitor 8
    // `CapacitorConfig.android` type — Capacitor does not currently
    // expose an API to inject custom intent filters via the config
    // object. The filter below MUST therefore be added MANUALLY to
    // `android/app/src/main/AndroidManifest.xml` AFTER `npx cap add
    // android`. Add it inside the existing `<activity android:name=
    // ".MainActivity" ...>` block:
    //
    //   <intent-filter android:autoVerify="true">
    //     <action android:name="android.intent.action.VIEW" />
    //     <category android:name="android.intent.category.DEFAULT" />
    //     <category android:name="android.intent.category.BROWSABLE" />
    //     <data android:scheme="https"
    //           android:host="praeventio.app" />
    //   </intent-filter>
    //
    // See `docs/deep-linking-runbook.md` for the full activation flow
    // (keystore fingerprint → assetlinks.json → store build).
  },
  ios: {
    backgroundColor: '#18181b',
    contentInset: 'automatic',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
    // Sprint 21 — Bucket G: Universal Links.
    //
    // iOS has no equivalent config field; Universal Links require:
    //   1. The `Associated Domains` capability on the Xcode App target,
    //      with the entitlement value `applinks:praeventio.app`.
    //   2. The AASA file at https://praeventio.app/.well-known/
    //      apple-app-site-association (served by `server.ts`,
    //      content-type `application/json`, no redirects).
    // Both steps are documented in `docs/deep-linking-runbook.md`.
  },
  plugins: {
    // Note: @perfood/capacitor-healthkit (v1.3.2) does NOT accept a
    // `CapacitorHealthkit` config block — it auto-discovers via CocoaPods.
    // All iOS-side config (Info.plist usage strings, HealthKit capability,
    // App.entitlements) lives in the Xcode project under `ios/App/App/`.
    // See IOS_BUILD.md for the full runbook + copy-paste templates.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    // Biometric (TouchID / FaceID / Android fingerprint) — see
    // src/hooks/useBiometricAuth.ts for the 3-tier strategy. The plugin
    // auto-registers via @capacitor/cli; this empty block is here to
    // make the dependency intent explicit and to leave a hook for
    // future Android allowDeviceCredential tuning.
    BiometricAuth: {
      androidBiometryStrength: 'weak',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: true,
      iosKeychainPrefix: 'praeventio-guard',
      iosBiometric: {
        biometricAuth: false,
        biometricTitle: "Biometric login for capacitor sqlite"
      },
      androidIsEncryption: true,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: "Biometric login for capacitor sqlite",
        biometricSubTitle: "Log in using your biometric"
      }
    }
  }
};

export default config;
