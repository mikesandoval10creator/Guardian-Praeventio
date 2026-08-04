// SPDX-License-Identifier: MIT
// Android Play Store release contract — versionCode must be monotonically
// injectable by CI, and the Android test template must point at the real app
// package. Google Play rejects a second AAB if versionCode stays static.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Android Play Store versionCode contract', () => {
  const appBuildGradle = read('android/app/build.gradle');
  const mobileReleaseWorkflow = read('.github/workflows/mobile-release.yml');

  it('does not hard-code release versionCode in Gradle', () => {
    expect(appBuildGradle).toContain('System.getenv("VERSION_CODE")');
    expect(appBuildGradle).toContain('?.toInteger() ?: 1');
    expect(appBuildGradle).not.toMatch(/^\s*versionCode\s+1\s*$/m);
  });

  it('injects GitHub run number as VERSION_CODE for Android release builds', () => {
    expect(mobileReleaseWorkflow).toContain('VERSION_CODE: ${{ github.run_number }}');
    expect(mobileReleaseWorkflow).toContain('bundle exec fastlane android "$LANE"');
  });
});

describe('Android instrumentation template package contract', () => {
  const appBuildGradle = read('android/app/build.gradle');
  const instrumentedTest = read(
    'android/app/src/androidTest/java/com/praeventio/guard/ExampleInstrumentedTest.java',
  );

  it('uses the real Play Store application id in Gradle and the generated Android test', () => {
    expect(appBuildGradle).toContain('applicationId "com.praeventio.guard"');
    expect(instrumentedTest).toContain('package com.praeventio.guard;');
    expect(instrumentedTest).toContain('assertEquals("com.praeventio.guard", appContext.getPackageName())');
  });
});
