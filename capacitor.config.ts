import type { CapacitorConfig } from '@capacitor/cli';

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
  },
  ios: {
    backgroundColor: '#18181b',
    contentInset: 'automatic',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
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
