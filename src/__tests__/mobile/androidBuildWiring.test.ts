// SPDX-License-Identifier: MIT
// AUDIT-2026-06 B21 — pin the Android build wiring for life-safety plugins.
//
// What broke in prod and must never regress silently:
//   • `packages/capacitor-mesh` had real Kotlin BLE code but was NOT an npm
//     dependency, so `cap update` never wrote it into
//     android/capacitor.settings.gradle → on device `registerPlugin('Mesh')`
//     fell back to the web simulator and offline SOS-over-mesh did nothing.
//   • The lone-worker foreground-service plugin (capawesome) was installed
//     in package.json but missing from capacitor.settings.gradle, while
//     AndroidManifest.xml declared its <service> → class absent from APK.
//   • AndroidManifest.xml lacked ACCESS_FINE/COARSE_LOCATION and CAMERA —
//     the geolocation plugin does not declare them, so SOS GPS and the QR
//     scanner were dead on device.
//
// These are plain-text config files, so the cheapest honest test is to pin
// their contents. If `npx cap update` ever regenerates the gradle files
// without the mesh package (e.g. someone removes the file: dependency),
// this fails loudly instead of shipping an APK with a silent web fallback.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('android build wiring — life-safety plugins (B21)', () => {
  const settings = read('android/capacitor.settings.gradle');
  const buildGradle = read('android/app/capacitor.build.gradle');

  it.each([
    // [gradle project, why it is life-critical]
    [':praeventio-capacitor-mesh', 'offline SOS over BLE mesh'],
    [':capawesome-team-capacitor-android-foreground-service', 'lone-worker check-in FGS'],
    [':praeventio-capacitor-proximity', 'man-down proximity sensing'],
    [':capacitor-geolocation', 'SOS GPS'],
    [':capacitor-push-notifications', 'critical incident push'],
  ])('capacitor.settings.gradle includes %s (%s)', (project) => {
    expect(settings).toContain(`include '${project}'`);
    expect(buildGradle).toContain(`implementation project('${project}')`);
  });

  it('mesh project points at the local workspace package', () => {
    expect(settings).toContain("new File('../packages/capacitor-mesh/android')");
  });

  it('proximity project points at the auditable local workspace package', () => {
    expect(settings).toContain(
      "new File('../packages/capacitor-proximity/android')"
    );
  });

  it('package.json declares the mesh plugin as a file: dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@praeventio/capacitor-mesh']).toBe(
      'file:packages/capacitor-mesh'
    );
  });

  it('package.json declares the proximity plugin as a file: dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@praeventio/capacitor-proximity']).toBe(
      'file:packages/capacitor-proximity'
    );
    expect(pkg.dependencies['@capgo/capacitor-proximity']).toBeUndefined();
  });
});

describe('AndroidManifest — permissions the plugins do not provide (B21)', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it.each([
    ['android.permission.ACCESS_FINE_LOCATION', 'SOS / lone-worker GPS'],
    ['android.permission.ACCESS_COARSE_LOCATION', 'geolocation fallback'],
    ['android.permission.CAMERA', 'QR scanner + on-device biometrics'],
    ['android.permission.ACCESS_BACKGROUND_LOCATION', 'tracking while backgrounded'],
    ['android.permission.POST_NOTIFICATIONS', 'FGS + critical push (SDK 33+)'],
    ['android.permission.FOREGROUND_SERVICE_LOCATION', 'lone-worker FGS type'],
    // Mic via WebView getUserMedia({audio:true}) — same class of bug as CAMERA
    // above. Capacitor's BridgeWebChromeClient.onPermissionRequest maps
    // AUDIO_CAPTURE to BOTH of these and calls request.deny() unless every
    // permission in the array is granted; Android denies any permission the
    // manifest does not declare. Missing either one ⇒ mic dead on device
    // (NoiseMonitor decibels, CrisisChat emergency voice, voice assistant).
    ['android.permission.RECORD_AUDIO', 'NoiseMonitor / CrisisChat voice / voice assistant'],
    ['android.permission.MODIFY_AUDIO_SETTINGS', 'requested alongside RECORD_AUDIO by the Capacitor bridge'],
  ])('declares %s (%s)', (permission) => {
    expect(manifest).toContain(`<uses-permission android:name="${permission}" />`);
  });

  it('keeps allowBackup=false (rule #17 — adb backup exfiltration)', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it('the declared FGS service class ships in the APK (plugin included in gradle)', () => {
    // AndroidManifest declares the capawesome service class; if the plugin
    // is not compiled in, Android crashes on service start. The settings
    // check above plus this assertion tie the two files together.
    expect(manifest).toContain(
      'io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService'
    );
    expect(read('android/capacitor.settings.gradle')).toContain(
      "new File('../node_modules/@capawesome-team/capacitor-android-foreground-service/android')"
    );
  });

  it('BLE permissions come from the mesh plugin manifest (merger), which must declare them', () => {
    const meshManifest = read(
      'packages/capacitor-mesh/android/src/main/AndroidManifest.xml'
    );
    for (const p of [
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    ]) {
      expect(meshManifest).toContain(p);
    }
  });
});
