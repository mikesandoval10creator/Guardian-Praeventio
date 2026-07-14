// Store-build gate — the DEV SERVER must never reach the store.
//
// `capacitor.config.ts` gates the live-reload block behind `!isProd`:
//
//   ...(!isProd && { server: { url: 'http://10.0.2.2:5173', cleartext: true } })
//
// `npx cap sync` bakes the RESOLVED config into
// `android/app/src/main/assets/capacitor.config.json`, which is what actually
// ships inside the APK. Sync without NODE_ENV=production and the store build
// points its WebView at the Android-emulator host alias (10.0.2.2): the app
// opens BLANK on a real device, with cleartext HTTP enabled on top.
//
// Two layers, both pinned here:
//   • the CONFIG LOGIC   — production must produce no server block (below);
//   • the BUILT ARTIFACT — scripts/check-store-build-config.cjs, run after
//     `cap sync` and before packaging (its pure checker is exercised below).
//
// The Android build runs locally (ADR-0006), so this gate is the only thing
// standing between a careless `cap sync` and a broken store release.

import { describe, it, expect, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findStoreBuildProblems } = require('../../../scripts/check-store-build-config.cjs');

/** Import capacitor.config.ts fresh under a given NODE_ENV. */
async function loadCapacitorConfig(nodeEnv: string) {
  vi.resetModules();
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const mod = await import('../../../capacitor.config');
    return mod.default as {
      server?: { url?: string; cleartext?: boolean };
      android?: {
        webContentsDebuggingEnabled?: boolean;
        allowMixedContent?: boolean;
      };
    };
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('capacitor.config.ts — store build must never embed the dev server', () => {
  it('production: NO server block at all (no dev url, no cleartext)', async () => {
    const cfg = await loadCapacitorConfig('production');
    expect(cfg.server).toBeUndefined();
  });

  it('production: WebView debugging and mixed content are OFF', async () => {
    const cfg = await loadCapacitorConfig('production');
    expect(cfg.android?.webContentsDebuggingEnabled).toBe(false);
    expect(cfg.android?.allowMixedContent).toBe(false);
  });

  it('production config is store-safe per the build guard', async () => {
    const cfg = await loadCapacitorConfig('production');
    expect(findStoreBuildProblems(cfg)).toEqual([]);
  });

  it('dev: live-reload still points at the emulator host (we did not break dev)', async () => {
    const cfg = await loadCapacitorConfig('development');
    expect(cfg.server?.url).toContain('10.0.2.2');
  });
});

describe('findStoreBuildProblems (the artifact guard)', () => {
  it('flags a dev server baked into the synced config', () => {
    const problems = findStoreBuildProblems({
      server: { url: 'http://10.0.2.2:5173', cleartext: true },
      android: { webContentsDebuggingEnabled: true, allowMixedContent: false },
    });
    expect(problems).toContain('server.url = "http://10.0.2.2:5173"');
    expect(problems).toContain('server.cleartext = true');
    expect(problems).toContain('android.webContentsDebuggingEnabled = true');
  });

  it('flags allowMixedContent', () => {
    expect(findStoreBuildProblems({ android: { allowMixedContent: true } })).toContain(
      'android.allowMixedContent = true',
    );
  });

  it('passes a clean store config', () => {
    expect(
      findStoreBuildProblems({
        appId: 'com.praeventio.guard',
        android: { webContentsDebuggingEnabled: false, allowMixedContent: false },
      }),
    ).toEqual([]);
  });

  it('tolerates a missing/garbage config without crashing', () => {
    expect(findStoreBuildProblems(null)).toEqual([]);
    expect(findStoreBuildProblems(undefined)).toEqual([]);
  });
});
