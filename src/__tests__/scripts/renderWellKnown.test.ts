// Tests for scripts/render-well-known.mjs.
//
// render-well-known.mjs runs in `prebuild` and regenerates
// public/.well-known/* from build-time env vars. The security-critical
// invariant: the Android signing-cert SHA-256 is read from
// process.env.ANDROID_CERT_SHA256 FAIL-CLOSED — there is no hardcoded
// fallback, so a missing/malformed value must abort the build (throw)
// rather than silently shipping an assetlinks.json with the wrong cert.
//
// The fs and env are injectable, so each test runs against an in-memory
// virtual filesystem with a synthetic environment. No real keystore, no
// disk writes, deterministic across machines.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '..', '..', '..', 'scripts', 'render-well-known.mjs');

const mod = await import(scriptPath);
const {
  resolveAndroidSha,
  buildAssetlinks,
  buildSecurityTxt,
  render,
  WELL_KNOWN_DIR,
} = mod as typeof import('../../../scripts/render-well-known.mjs');

// A real-shaped 32-byte colon-hex fingerprint (NOT the project's prod cert).
const REAL_SHA =
  '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1E:1B:53:8A:1B:0F:9C:F1:1B:DD:64';

const AASA_FIXTURE = JSON.stringify(
  {
    applinks: {
      apps: [],
      details: [{ appID: 'TEAMID.com.praeventio.guard', paths: ['/sos'] }],
    },
    webcredentials: { apps: ['TEAMID.com.praeventio.guard'] },
  },
  null,
  2,
);

/** Minimal in-memory async fs mimicking the subset render() touches. */
function makeFakeFs(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    writeFile: async (p: string, c: string) => {
      store[p] = c;
    },
    readFile: async (p: string) => {
      if (!(p in store)) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
      return store[p];
    },
  };
}

const ASSETLINKS = path.join(WELL_KNOWN_DIR, 'assetlinks.json');
const AASA = path.join(WELL_KNOWN_DIR, 'apple-app-site-association');
const SECURITY_TXT = path.join(WELL_KNOWN_DIR, 'security.txt');

describe('resolveAndroidSha (no hardcoded fallback)', () => {
  it('returns null when absent and not required (web/dev/CI builds)', () => {
    // Absent → honest "unconfigured" state, NOT a fabricated cert. The caller
    // writes empty fingerprints. This is what unblocks ordinary web/CI builds.
    expect(resolveAndroidSha(undefined)).toBeNull();
    expect(resolveAndroidSha('')).toBeNull();
    expect(resolveAndroidSha('   ')).toBeNull();
  });

  it('throws when absent AND required (release fail-closed)', () => {
    expect(() => resolveAndroidSha(undefined, { required: true })).toThrow(/no está definido/);
    expect(() => resolveAndroidSha('', { required: true })).toThrow(/no está definido/);
  });

  it('throws on placeholder values (a provided-but-wrong cert is always an error)', () => {
    expect(() => resolveAndroidSha('REPLACE_WITH_REAL_SHA256')).toThrow(/placeholder/i);
    expect(() => resolveAndroidSha('YOUR_CERT_HERE')).toThrow(/placeholder/i);
    expect(() => resolveAndroidSha('PLACEHOLDER')).toThrow(/placeholder/i);
  });

  it('throws on malformed fingerprints even when not required (too short, wrong separators, 31 bytes)', () => {
    expect(() => resolveAndroidSha('garbage')).toThrow(/formato inválido/);
    expect(() => resolveAndroidSha('3D:AC:D9')).toThrow(/formato inválido/);
    // 31 bytes instead of 32 — the old loose regex (>=47 chars) wrongly accepted this.
    const thirtyOne = Array(31).fill('AB').join(':');
    expect(() => resolveAndroidSha(thirtyOne)).toThrow(/formato inválido/);
    // A 64-hex string WITHOUT colons must be rejected.
    expect(() => resolveAndroidSha('A'.repeat(64))).toThrow(/formato inválido/);
  });

  it('accepts a valid 32-byte colon-hex fingerprint and upper-cases it', () => {
    expect(resolveAndroidSha(REAL_SHA.toLowerCase())).toBe(REAL_SHA);
    expect(resolveAndroidSha(` ${REAL_SHA} `)).toBe(REAL_SHA);
  });
});

describe('buildAssetlinks', () => {
  it('embeds the fingerprint in the Digital Asset Links shape', () => {
    const out = buildAssetlinks(REAL_SHA);
    expect(out[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(out[0].target.namespace).toBe('android_app');
    expect(out[0].target.package_name).toBe('com.praeventio.guard');
    expect(out[0].target.sha256_cert_fingerprints).toEqual([REAL_SHA]);
  });
});

describe('buildSecurityTxt', () => {
  it('renders the contact email into an RFC 9116 body', () => {
    const txt = buildSecurityTxt('contacto@praeventio.net');
    expect(txt).toContain('Contact: mailto:contacto@praeventio.net');
    expect(txt).toMatch(/^Contact:/);
  });
});

describe('render (e2e with injected fs + env)', () => {
  it('writes HONEST empty-fingerprint assetlinks + warns when ANDROID_CERT_SHA256 is absent (non-release)', async () => {
    const warnings: string[] = [];
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    const result = await render({
      env: {},
      fsImpl,
      log: () => {},
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      },
    });
    // Absent cert → honest empty fingerprints, NOT a fabricated/hardcoded cert,
    // and NOT a hard build failure (web/dev/CI builds proceed).
    expect(result.androidSha).toBeNull();
    const written = JSON.parse(fsImpl.store[ASSETLINKS]);
    expect(written[0].target.sha256_cert_fingerprints).toEqual([]);
    expect(warnings.join(' ')).toMatch(/ANDROID_CERT_SHA256/);
  });

  it('FAILS CLOSED: throws + writes nothing when cert absent AND REQUIRE_ANDROID_CERT=1 (release)', async () => {
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    await expect(
      render({ env: { REQUIRE_ANDROID_CERT: '1' }, fsImpl, log: () => {}, warn: () => {} }),
    ).rejects.toThrow(/ANDROID_CERT_SHA256/);
    // The release build aborts before any artifact is written.
    expect(fsImpl.store[ASSETLINKS]).toBeUndefined();
  });

  it('FAILS CLOSED: throws on a malformed ANDROID_CERT_SHA256', async () => {
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    await expect(
      render({ env: { ANDROID_CERT_SHA256: 'not-a-fingerprint' }, fsImpl, log: () => {}, warn: () => {} }),
    ).rejects.toThrow(/formato inválido/);
    expect(fsImpl.store[ASSETLINKS]).toBeUndefined();
  });

  it('writes a correct assetlinks.json from a valid env fingerprint', async () => {
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    const result = await render({
      env: { ANDROID_CERT_SHA256: REAL_SHA, SECURITY_CONTACT_EMAIL: 'sec@praeventio.net' },
      fsImpl,
      log: () => {},
      warn: () => {},
    });
    expect(result.androidSha).toBe(REAL_SHA);
    const written = JSON.parse(fsImpl.store[ASSETLINKS]);
    expect(written[0].target.sha256_cert_fingerprints).toEqual([REAL_SHA]);
    // security.txt picked up the override email.
    expect(fsImpl.store[SECURITY_TXT]).toContain('sec@praeventio.net');
  });

  it('never emits the old hardcoded prod fingerprint from a fallback (absent env)', async () => {
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    await render({ env: {}, fsImpl, log: () => {}, warn: () => {} });
    // The previously hardcoded prod fingerprint must never appear: absent env
    // yields empty fingerprints, never a baked-in fallback cert.
    const PROD_LITERAL = '3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0';
    expect(fsImpl.store[ASSETLINKS]).not.toContain(PROD_LITERAL);
  });

  it('leaves AASA at honest TEAMID + warns when APPLE_TEAM_ID is absent', async () => {
    const warnings: string[] = [];
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    const result = await render({
      env: { ANDROID_CERT_SHA256: REAL_SHA },
      fsImpl,
      log: () => {},
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      },
    });
    expect(result.appleTeamId).toBeNull();
    expect(warnings.join(' ')).toMatch(/APPLE_TEAM_ID/);
    // AASA fixture untouched — still the honest placeholder.
    expect(fsImpl.store[AASA]).toContain('TEAMID.com.praeventio.guard');
  });

  it('fills the AASA appID when a valid APPLE_TEAM_ID is provided', async () => {
    const fsImpl = makeFakeFs({ [AASA]: AASA_FIXTURE });
    const result = await render({
      env: { ANDROID_CERT_SHA256: REAL_SHA, APPLE_TEAM_ID: 'ABCDE12345' },
      fsImpl,
      log: () => {},
      warn: () => {},
    });
    expect(result.appleTeamId).toBe('ABCDE12345');
    const aasa = JSON.parse(fsImpl.store[AASA]);
    expect(aasa.applinks.details[0].appID).toBe('ABCDE12345.com.praeventio.guard');
    expect(aasa.webcredentials.apps).toEqual(['ABCDE12345.com.praeventio.guard']);
  });
});
