// Tests for scripts/fill-android-assetlinks.mjs.
//
// We avoid spawning real keytool — `runKeytool` is injectable. The fs is also
// injectable, so each test runs against an in-memory virtual file. This keeps
// the suite deterministic across machines (no JDK required to run vitest).

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '..', '..', '..', 'scripts', 'fill-android-assetlinks.mjs');

const mod = await import(scriptPath);
const {
  parseArgs,
  extractSha256,
  applyFingerprint,
  validateAssetlinks,
  main,
} = mod as typeof import('../../../scripts/fill-android-assetlinks.mjs');

const REAL_SHA =
  '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1E:1B:53:8A:1B:0F:9C:F1:1B:DD:64';

const PLACEHOLDER_JSON = JSON.stringify(
  [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.praeventio.guard',
        sha256_cert_fingerprints: ['REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD'],
      },
    },
  ],
  null,
  2,
);

/**
 * Minimal in-memory fs that mimics the subset the script touches.
 */
function makeFakeFs(initial: Record<string, string>) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    read: (p: string) => {
      if (!(p in store)) throw new Error(`ENOENT ${p}`);
      return store[p];
    },
    write: (p: string, c: string) => {
      store[p] = c;
    },
    exists: (p: string) => p in store,
  };
}

describe('parseArgs', () => {
  it('parses --flag value and --flag=value pairs', () => {
    expect(parseArgs(['--keystore', '/tmp/x.jks', '--alias=foo'])).toEqual({
      keystore: '/tmp/x.jks',
      alias: 'foo',
    });
  });
  it('treats boolean flags without a value as true', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ 'dry-run': true });
  });
});

describe('extractSha256', () => {
  it('finds the SHA-256 in real keytool -list -v output', () => {
    const out = `
      Certificate fingerprints:
               SHA1: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
               SHA256: ${REAL_SHA}
               Signature algorithm name: SHA256withRSA
    `;
    expect(extractSha256(out)).toBe(REAL_SHA);
  });

  it('upper-cases lower-case hex digits', () => {
    const out = `SHA256: 14:6d:e9:83:c5:73:06:50:d8:ee:b9:95:2f:34:fc:64:16:a0:83:42:e6:1e:1b:53:8a:1b:0f:9c:f1:1b:dd:64`;
    expect(extractSha256(out)).toBe(REAL_SHA);
  });

  it('returns null when no SHA-256 is present', () => {
    expect(extractSha256('nothing here')).toBeNull();
    expect(extractSha256('')).toBeNull();
  });

  it('also accepts the "SHA-256" hyphenated label some JDKs emit', () => {
    const out = `SHA-256: ${REAL_SHA}`;
    expect(extractSha256(out)).toBe(REAL_SHA);
  });
});

describe('applyFingerprint', () => {
  it('replaces the placeholder', () => {
    const json = JSON.parse(PLACEHOLDER_JSON);
    const out = applyFingerprint(json, REAL_SHA);
    expect(out[0].target.sha256_cert_fingerprints).toEqual([REAL_SHA]);
  });

  it('is idempotent — re-applying same SHA does not duplicate', () => {
    const json = JSON.parse(PLACEHOLDER_JSON);
    const once = applyFingerprint(json, REAL_SHA);
    const twice = applyFingerprint(once, REAL_SHA);
    expect(twice[0].target.sha256_cert_fingerprints).toEqual([REAL_SHA]);
  });

  it('does NOT mutate its input', () => {
    const json = JSON.parse(PLACEHOLDER_JSON);
    applyFingerprint(json, REAL_SHA);
    expect(json[0].target.sha256_cert_fingerprints[0]).toBe(
      'REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD',
    );
  });

  it('appends a second fingerprint when {append: true}', () => {
    const other = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    const json = applyFingerprint(JSON.parse(PLACEHOLDER_JSON), REAL_SHA);
    const appended = applyFingerprint(json, other, { append: true });
    expect(appended[0].target.sha256_cert_fingerprints).toEqual([REAL_SHA, other]);
  });

  it('rejects a malformed top-level structure', () => {
    expect(() => applyFingerprint({} as never, REAL_SHA)).toThrow();
    expect(() => applyFingerprint([], REAL_SHA)).toThrow();
  });
});

describe('validateAssetlinks', () => {
  it('flags lingering placeholders', () => {
    const v = validateAssetlinks(JSON.parse(PLACEHOLDER_JSON));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/placeholder/);
  });

  it('passes for a fully-filled file', () => {
    const filled = applyFingerprint(JSON.parse(PLACEHOLDER_JSON), REAL_SHA);
    const v = validateAssetlinks(filled);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('rejects non-colon-hex fingerprints', () => {
    const bad = applyFingerprint(JSON.parse(PLACEHOLDER_JSON), REAL_SHA);
    bad[0].target.sha256_cert_fingerprints = ['not-a-fingerprint'];
    const v = validateAssetlinks(bad);
    expect(v.ok).toBe(false);
  });
});

describe('main (e2e with injected fs + keytool stub)', () => {
  const FILE = 'public/.well-known/assetlinks.json';

  it('exits 1 when file is missing', async () => {
    const fs = makeFakeFs({});
    const code = await main(['--sha256', REAL_SHA, '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(1);
  });

  it('writes the SHA when --sha256 is passed directly', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_JSON + '\n' });
    const code = await main(['--sha256', REAL_SHA, '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(fs.store[FILE]).toContain(REAL_SHA);
    expect(fs.store[FILE]).not.toContain('REPLACE_WITH_REAL_SHA256');
  });

  it('does NOT write on --dry-run', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_JSON + '\n' });
    const before = fs.store[FILE];
    const code = await main(['--sha256', REAL_SHA, '--file', FILE, '--dry-run'], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(fs.store[FILE]).toBe(before);
  });

  it('rolls back (leaves file untouched) when keytool output has no SHA', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_JSON + '\n' });
    const before = fs.store[FILE];
    const code = await main(
      ['--keystore', '/x.jks', '--alias', 'a', '--storepass', 'p', '--file', FILE],
      {
        read: fs.read,
        write: fs.write,
        exists: fs.exists,
        keytool: () => 'no fingerprint here',
        log: () => {},
        err: () => {},
        env: {},
      },
    );
    expect(code).toBe(2);
    expect(fs.store[FILE]).toBe(before);
  });

  it('uses keytool stub output when no --sha256 override is supplied', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_JSON + '\n' });
    const code = await main(
      ['--keystore', '/x.jks', '--alias', 'a', '--storepass', 'p', '--file', FILE],
      {
        read: fs.read,
        write: fs.write,
        exists: fs.exists,
        keytool: () => `SHA256: ${REAL_SHA}`,
        log: () => {},
        err: () => {},
        env: {},
      },
    );
    expect(code).toBe(0);
    expect(fs.store[FILE]).toContain(REAL_SHA);
  });

  it('is idempotent — second run on an already-filled file is a no-op', async () => {
    const filled = JSON.stringify(
      applyFingerprint(JSON.parse(PLACEHOLDER_JSON), REAL_SHA),
      null,
      2,
    ) + '\n';
    const fs = makeFakeFs({ [FILE]: filled });
    let wrote = false;
    const code = await main(['--sha256', REAL_SHA, '--file', FILE], {
      read: fs.read,
      write: (p: string, c: string) => {
        wrote = true;
        fs.store[p] = c;
      },
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(wrote).toBe(false);
  });

  it('rejects --sha256 that is not in colon-hex form', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_JSON + '\n' });
    const code = await main(['--sha256', 'garbage', '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(1);
  });
});
