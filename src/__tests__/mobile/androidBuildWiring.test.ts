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

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("android build wiring — life-safety plugins (B21)", () => {
  const settings = read("android/capacitor.settings.gradle");
  const buildGradle = read("android/app/capacitor.build.gradle");

  it.each([
    // [gradle project, why it is life-critical]
    [":praeventio-capacitor-mesh", "offline SOS over BLE mesh"],
    [
      ":praeventio-capacitor-mandown",
      "native Android ManDown foreground sensor",
    ],
    [
      ":capawesome-team-capacitor-android-foreground-service",
      "lone-worker check-in FGS",
    ],
    [":praeventio-capacitor-proximity", "man-down proximity sensing"],
    [":capacitor-geolocation", "SOS GPS"],
    [":capacitor-push-notifications", "critical incident push"],
  ])("capacitor.settings.gradle includes %s (%s)", (project) => {
    expect(settings).toContain(`include '${project}'`);
    expect(buildGradle).toContain(`implementation project('${project}')`);
  });

  it("mesh project points at the local workspace package", () => {
    expect(settings).toContain(
      "new File('../packages/capacitor-mesh/android')",
    );
  });

  it("proximity project points at the auditable local workspace package", () => {
    expect(settings).toContain(
      "new File('../packages/capacitor-proximity/android')",
    );
  });

  it("package.json declares the mesh plugin as a file: dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@praeventio/capacitor-mesh"]).toBe(
      "file:packages/capacitor-mesh",
    );
  });

  it("package.json declares the proximity plugin as a file: dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@praeventio/capacitor-proximity"]).toBe(
      "file:packages/capacitor-proximity",
    );
    expect(pkg.dependencies["@capgo/capacitor-proximity"]).toBeUndefined();
  });
});

describe("AndroidManifest — permissions the plugins do not provide (B21)", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  it.each([
    ["android.permission.ACCESS_FINE_LOCATION", "SOS / lone-worker GPS"],
    ["android.permission.ACCESS_COARSE_LOCATION", "geolocation fallback"],
    ["android.permission.CAMERA", "QR scanner + on-device biometrics"],
    [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "tracking while backgrounded",
    ],
    ["android.permission.POST_NOTIFICATIONS", "FGS + critical push (SDK 33+)"],
    ["android.permission.FOREGROUND_SERVICE_LOCATION", "lone-worker FGS type"],
    // Mic via WebView getUserMedia({audio:true}) — same class of bug as CAMERA
    // above. Capacitor's BridgeWebChromeClient.onPermissionRequest maps
    // AUDIO_CAPTURE to BOTH of these and calls request.deny() unless every
    // permission in the array is granted; Android denies any permission the
    // manifest does not declare. Missing either one ⇒ mic dead on device
    // (NoiseMonitor decibels, CrisisChat emergency voice, voice assistant).
    [
      "android.permission.RECORD_AUDIO",
      "NoiseMonitor / CrisisChat voice / voice assistant",
    ],
    [
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "requested alongside RECORD_AUDIO by the Capacitor bridge",
    ],
  ])("declares %s (%s)", (permission) => {
    expect(manifest).toContain(
      `<uses-permission android:name="${permission}" />`,
    );
  });

  it("keeps allowBackup=false (rule #17 — adb backup exfiltration)", () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it("the declared FGS service class ships in the APK (plugin included in gradle)", () => {
    // AndroidManifest declares the capawesome service class; if the plugin
    // is not compiled in, Android crashes on service start. The settings
    // check above plus this assertion tie the two files together.
    expect(manifest).toContain(
      "io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService",
    );
    expect(read("android/capacitor.settings.gradle")).toContain(
      "new File('../node_modules/@capawesome-team/capacitor-android-foreground-service/android')",
    );
  });

  it("BLE permissions come from the mesh plugin manifest (merger), which must declare them", () => {
    const meshManifest = read(
      "packages/capacitor-mesh/android/src/main/AndroidManifest.xml",
    );
    for (const p of [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_ADVERTISE",
      "android.permission.BLUETOOTH_CONNECT",
    ]) {
      expect(meshManifest).toContain(p);
    }
  });
});

describe("Android Gradle release signing — Play Store AAB", () => {
  const appBuildGradle = read("android/app/build.gradle");
  const androidGitignore = read("android/.gitignore");

  it("wires buildTypes.release to signingConfigs.release", () => {
    expect(appBuildGradle).toMatch(/signingConfigs\s*\{[\s\S]*release\s*\{/);
    expect(appBuildGradle).toMatch(
      /buildTypes\s*\{[\s\S]*release\s*\{[\s\S]*signingConfig\s+signingConfigs\.release/,
    );
  });

  it("loads release signing credentials from keystore.properties or environment variables", () => {
    expect(appBuildGradle).toContain('rootProject.file("keystore.properties")');
    for (const token of [
      "KEYSTORE_PATH",
      "ANDROID_KEYSTORE_PASSWORD",
      "KEY_ALIAS",
      "KEY_PASSWORD",
    ]) {
      expect(appBuildGradle).toContain(token);
    }
  });

  it("does not allow local signing material to be committed accidentally", () => {
    const activeIgnoreLines = androidGitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(activeIgnoreLines).toContain("*.jks");
    expect(activeIgnoreLines).toContain("*.keystore");
    expect(activeIgnoreLines).toContain("keystore.properties");
  });
});

describe("Android native SDK floor — Health Connect Play Store compatibility", () => {
  const variablesGradle = read("android/variables.gradle");

  it("keeps minSdkVersion at 26 because Health Connect connect-client requires API 26", () => {
    expect(variablesGradle).toContain("minSdkVersion = 26");
  });
});

// MASVS-NETWORK-1 — no cleartext, dev-only trust overrides. The app carries
// clinical + location PII, so a release build must never fall back to http and
// must never trust a user-injected CA.
describe("AndroidManifest — network security config (MASVS-NETWORK-1)", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const nsc = read("android/app/src/main/res/xml/network_security_config.xml");

  it("the manifest points <application> at the network security config", () => {
    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
  });

  it("the manifest never force-enables cleartext globally", () => {
    expect(manifest).not.toContain('android:usesCleartextTraffic="true"');
  });

  it("cleartext is disabled by default (base-config)", () => {
    expect(nsc).toContain('cleartextTrafficPermitted="false"');
  });

  it("keeps the dev live-reload loopback working (10.0.2.2 cleartext exception)", () => {
    // capacitor.config dev server is http://10.0.2.2:5173 (removed for store
    // builds); 10.0.2.2 is non-routable in prod so this cannot weaken release.
    expect(nsc).toContain("10.0.2.2");
  });

  it("confines user-CA trust to <debug-overrides> — release never trusts a user CA", () => {
    const beforeDebug = nsc.split("<debug-overrides>")[0];
    expect(beforeDebug).not.toContain('src="user"');
    expect(nsc).toContain("<debug-overrides>");
  });
});

// MASVS-NETWORK-2 — certificate pinning for the production API host. The app
// carries clinical + location PII, so a release build MUST reject any TLS
// handshake to app.praeventio.net whose leaf or intermediate is not one of the
// pre-vetted SPKI SHA-256 pins committed to this file.
describe("AndroidManifest — certificate pinning for app.praeventio.net (MASVS-NETWORK-2)", () => {
  const nsc = read("android/app/src/main/res/xml/network_security_config.xml");

  // Extract the pinned <domain-config> once for every check below.
  const domainConfigs = nsc.match(/<domain-config[\s\S]*?<\/domain-config>/g) ?? [];
  const pinnedDomain = domainConfigs.find((block) =>
    // Match the exact <domain> child element of <domain-config>, not a
    // substring (CodeQL js/incomplete-url-substring-sanitization):
    //   <domain includeSubdomains="false">app.praeventio.net</domain>
    // The regex anchor on </domain> ensures no trailing host suffix can match.
    /<domain[^>]*>app\.praeventio\.net<\/domain>/.test(block),
  );

  it("declares a <pin-set> for app.praeventio.net (the production API host)", () => {
    // The pinned domain must be configured in a domain-config block — not
    // base-config (which would over-pin every host including Firebase /
    // Play Services) and not <debug-overrides> (debug-only).
    expect(pinnedDomain, "no <domain-config> includes app.praeventio.net").toBeDefined();
    expect(pinnedDomain).toMatch(/<pin-set[\s\S]*<\/pin-set>/);
  });

  it("the pinned domain-config has cleartext disabled (HTTPS-only)", () => {
    expect(pinnedDomain).toBeDefined();
    // We tolerate either explicit cleartextTrafficPermitted="false" or an
    // absence (default is false). Reject ONLY the dangerous "true".
    expect(pinnedDomain).not.toMatch(/cleartextTrafficPermitted="true"/);
  });

  it("declares at least two pins (RFC 7469 §4.2.2: leaf + backup)", () => {
    // A single pin bricks the app on the next cert rotation because the OS
    // has no fallback. Android enforces this only as a soft warning, so we
    // hard-pin it here. Backup pin can be the intermediate CA, the root, or
    // an offline pre-issued next-rotation key.
    const pinMatches =
      nsc.match(/<pin digest="SHA-256">[^<]+<\/pin>/g) ?? [];
    expect(pinMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("every pin uses SHA-256 (no weaker digest)", () => {
    const pinDigests = nsc.match(/<pin digest="([^"]+)">/g) ?? [];
    expect(pinDigests.length).toBeGreaterThan(0);
    for (const d of pinDigests) {
      expect(d).toBe('<pin digest="SHA-256">');
    }
  });

  it("pin-set values are real SPKI SHA-256 base64 digests OR explicit placeholders documented in mobile-signing-runbook §4", () => {
    // The earlier "declares a <pin-set> for app.praeventio.net" test already
    // fails if pinnedDomain is undefined; this is its data-level companion.
    // Force the type-narrow assertion here so the rest of the test can use
    // pinnedDomain without optional chaining noise.
    expect(pinnedDomain).toBeDefined();
    const pinned = pinnedDomain as string;
    // Pin-set ships with two literal placeholder strings (PIN_*_REPLACE_AT_PROD_DEPLOY)
    // so the schema compiles in dev. The release job
    // (scripts/check-cert-pinning-ratchet.cjs) refuses to ship a build with
    // those placeholders. Locally we accept EITHER:
    //   (a) A real SPKI SHA-256 digest = 43 chars of base64 (no padding '='), OR
    //   (b) The documented placeholder, which must match a known token so the
    //       ratchet can detect and reject it deterministically.
    // Any other malformed value is a regression.
    const pinValues = pinned.match(/<pin digest="SHA-256">([^<]+)<\/pin>/g) ?? [];
    expect(pinValues.length).toBeGreaterThanOrEqual(2);

    const SPKI_RE = /^[A-Za-z0-9+/]{43}$/; // 43 chars base64, no padding
    const ALLOWED_PLACEHOLDERS = new Set([
      "PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY",
      "PIN_SHA256_BACKUP_REPLACE_AT_PROD_DEPLOY",
    ]);

    for (const tag of pinValues) {
      const value = tag.match(/>([^<]+)</)?.[1] ?? "";
      const isReal = SPKI_RE.test(value);
      const isDocumentedPlaceholder = ALLOWED_PLACEHOLDERS.has(value);
      expect(
        isReal || isDocumentedPlaceholder,
        `pin value "${value}" is neither a 43-char base64 SPKI digest nor a documented placeholder`,
      ).toBe(true);
    }

    // Belt + suspenders: the ratchet script and this test must agree on what
    // counts as a placeholder. If you change one, change the other.
    if (nsc.includes("PIN_SHA256_LEAF_REPLACE_AT_PROD_DEPLOY")) {
      // OK — release gate will catch it. Log so a developer running tests sees
      // why the suite is green despite placeholders.
      // eslint-disable-next-line no-console
      console.warn(
        "[cert-pinning] placeholder pin present — release build will be refused. See mobile-signing-runbook §4.",
      );
    }
  });
});

// MASVS-LIFE-SAFETY — Android foreground-service health permissions.
//
// The lone-worker check-in FGS runs with `foregroundServiceType="location|health"`
// and the native mandown plugin reads accelerometer at SENSOR_DELAY_GAME inside
// the FGS. Together those require:
//   - HIGH_SAMPLING_RATE_SENSORS  (Android 12+, mandatory for 'health' FGS)
//   - BODY_SENSORS_BACKGROUND     (API 33–35, runtime body-sensor in background)
//   - READ_HEALTH_DATA_IN_BACKGROUND (API 36+, supersedes BODY_SENSORS_BACKGROUND)
//   - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (Xiaomi/Huawei/Samsung OEM battery
//     savers terminate foreground services unless the app is on the OS
//     exemption list)
//
// All four MUST be present in the host-app manifest, with the correct
// maxSdkVersion gates so old permissions don't bleed onto new OS versions
// and vice versa.
describe("AndroidManifest — FGS health background permissions (MASVS-LIFE-SAFETY)", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  it("declares HIGH_SAMPLING_RATE_SENSORS (Android 12+ FGS 'health' prerequisite)", () => {
    // The native mandown plugin already declares this in its own manifest;
    // the host app must also declare it so the merge keeps the contract
    // regardless of plugin manifest order.
    expect(manifest).toContain(
      'android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"',
    );
  });

  it("declares BODY_SENSORS_BACKGROUND with maxSdkVersion=35 (API 33–35 only)", () => {
    // Required because the FGS reads body sensors in background. Capped at
    // API 35 because API 36 deprecates it in favour of
    // READ_HEALTH_DATA_IN_BACKGROUND (declared separately below).
    expect(manifest).toMatch(
      /android\.permission\.BODY_SENSORS_BACKGROUND[\s\S]{0,200}android:maxSdkVersion="35"/,
    );
    // Negative check: must NOT be applied to API 36+ (where it's deprecated).
    expect(manifest).not.toMatch(
      /BODY_SENSORS_BACKGROUND[\s\S]{0,200}android:maxSdkVersion="3[6-9]"/,
    );
  });

  it("declares READ_HEALTH_DATA_IN_BACKGROUND with tools:targetApi=36 (API 36+ replacement)", () => {
    expect(manifest).toContain(
      'android:name="android.permission.READ_HEALTH_DATA_IN_BACKGROUND"',
    );
    // The tools:targetApi=36 attribute keeps AGP / lint quiet on older
    // API levels where the permission doesn't exist yet.
    expect(manifest).toMatch(
      /READ_HEALTH_DATA_IN_BACKGROUND[\s\S]{0,200}tools:targetApi="36"/,
    );
  });

  it("declares REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (OEM battery-saver gate)", () => {
    // Without this, the FGS is killed within minutes of screen-off on
    // Xiaomi / Huawei / Samsung. The LoneWorker page has a runtime CTA
    // (src/pages/LoneWorker.tsx) that opens the Settings intent — the
    // manifest declaration is what lets that CTA work.
    expect(manifest).toContain(
      'android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"',
    );
  });

  it("native mandown plugin manifest keeps HIGH_SAMPLING_RATE_SENSORS (defense-in-depth)", () => {
    // The plugin declares it; if someone removes the file: dependency or
    // strips the plugin manifest, the FGS 'health' contract breaks. This
    // test fires locally before the APK is even built.
    const meshManifest = read(
      "packages/capacitor-mandown/android/src/main/AndroidManifest.xml",
    );
    expect(meshManifest).toContain(
      'android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS"',
    );
  });
});
