// Product decision (2026-10-20): Guardian Praeventio is an ad-free product.
// Ads are especially inappropriate around safety training and emergency UI.
// This is a static contract test so a future change cannot silently
// re-introduce AdMob/AdSense wiring, permissions, or boot-time initialization.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), 'utf8');

describe('AdMob/AdSense removal contract', () => {
  it('removes the ad service and the post-training ad modal', () => {
    expect(existsSync(resolve(root, 'src/services/adService.ts'))).toBe(false);
    expect(
      existsSync(resolve(root, 'src/components/shared/PostTrainingAdModal.tsx')),
    ).toBe(false);
  });

  it('does not re-introduce ad wiring in boot, training, manifest, or package', () => {
    expect(read('src/App.tsx')).not.toMatch(/initAdMob|adService/);
    expect(read('src/pages/Training.tsx')).not.toMatch(
      /PostTrainingAdModal|prepareInterstitial|canShowAd|recordAdShown|adService/,
    );

    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@capacitor-community/admob']).toBeUndefined();
    expect(pkg.devDependencies?.['@capacitor-community/admob']).toBeUndefined();

    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).not.toMatch(
      /com\.google\.android\.gms\.ads\.APPLICATION_ID|ca-app-pub-/,
    );
  });
});
