// Tests for scripts/fill-ios-aasa.mjs.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '..', '..', '..', 'scripts', 'fill-ios-aasa.mjs');

const mod = await import(scriptPath);
const { parseArgs, applyTeamId, validateAasa, main } =
  mod as typeof import('../../../scripts/fill-ios-aasa.mjs');

const REAL_TEAM = 'A1B2C3D4E5';

const PLACEHOLDER_AASA = JSON.stringify(
  {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'TEAMID.com.praeventio.guard',
          paths: ['/sos', '/sos/*'],
        },
      ],
    },
    webcredentials: { apps: ['TEAMID.com.praeventio.guard'] },
  },
  null,
  2,
);

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
  it('handles --team-id A1B2C3D4E5', () => {
    expect(parseArgs(['--team-id', REAL_TEAM])).toEqual({ 'team-id': REAL_TEAM });
  });
});

describe('applyTeamId', () => {
  it('replaces the TEAMID. prefix in appID and webcredentials.apps', () => {
    const out = applyTeamId(JSON.parse(PLACEHOLDER_AASA), REAL_TEAM);
    expect(out.applinks.details[0].appID).toBe(`${REAL_TEAM}.com.praeventio.guard`);
    expect(out.webcredentials.apps[0]).toBe(`${REAL_TEAM}.com.praeventio.guard`);
  });

  it('is idempotent — second pass with same team id is a no-op', () => {
    const once = applyTeamId(JSON.parse(PLACEHOLDER_AASA), REAL_TEAM);
    const twice = applyTeamId(once, REAL_TEAM);
    expect(twice).toEqual(once);
  });

  it('does NOT mutate the input', () => {
    const json = JSON.parse(PLACEHOLDER_AASA);
    applyTeamId(json, REAL_TEAM);
    expect(json.applinks.details[0].appID).toBe('TEAMID.com.praeventio.guard');
  });

  it('handles the alternative appIDs (plural) shape', () => {
    const json = {
      applinks: {
        details: [
          { appIDs: ['TEAMID.com.a', 'TEAMID.com.b'], paths: ['/x'] },
        ],
      },
    };
    const out = applyTeamId(json, REAL_TEAM);
    expect(out.applinks.details[0].appIDs).toEqual([
      `${REAL_TEAM}.com.a`,
      `${REAL_TEAM}.com.b`,
    ]);
  });
});

describe('validateAasa', () => {
  it('rejects when TEAMID. is still anywhere in the JSON', () => {
    const v = validateAasa(JSON.parse(PLACEHOLDER_AASA));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/TEAMID/);
  });

  it('passes for a fully filled file', () => {
    const filled = applyTeamId(JSON.parse(PLACEHOLDER_AASA), REAL_TEAM);
    expect(validateAasa(filled).ok).toBe(true);
  });

  it('flags appID prefixes that are not 10 alphanumeric chars', () => {
    const bad = {
      applinks: { details: [{ appID: 'SHORT.com.x', paths: ['/x'] }] },
    };
    expect(validateAasa(bad).ok).toBe(false);
  });
});

describe('main (e2e)', () => {
  const FILE = 'public/.well-known/apple-app-site-association';

  it('exits 1 without --team-id', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_AASA + '\n' });
    const code = await main(['--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(1);
  });

  it('exits 1 on a malformed team id', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_AASA + '\n' });
    const code = await main(['--team-id', 'TOO-SHORT', '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(1);
  });

  it('writes when given a valid team id', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_AASA + '\n' });
    const code = await main(['--team-id', REAL_TEAM, '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(fs.store[FILE]).toContain(`${REAL_TEAM}.com.praeventio.guard`);
    expect(fs.store[FILE]).not.toContain('TEAMID.');
  });

  it('honors --dry-run', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_AASA + '\n' });
    const before = fs.store[FILE];
    const code = await main(
      ['--team-id', REAL_TEAM, '--file', FILE, '--dry-run'],
      {
        read: fs.read,
        write: fs.write,
        exists: fs.exists,
        log: () => {},
        err: () => {},
        env: {},
      },
    );
    expect(code).toBe(0);
    expect(fs.store[FILE]).toBe(before);
  });

  it('is idempotent on already-filled files', async () => {
    const filled =
      JSON.stringify(applyTeamId(JSON.parse(PLACEHOLDER_AASA), REAL_TEAM), null, 2) +
      '\n';
    const fs = makeFakeFs({ [FILE]: filled });
    let wrote = false;
    const code = await main(['--team-id', REAL_TEAM, '--file', FILE], {
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

  it('accepts lowercase team-id and upper-cases it', async () => {
    const fs = makeFakeFs({ [FILE]: PLACEHOLDER_AASA + '\n' });
    const code = await main(['--team-id', 'a1b2c3d4e5', '--file', FILE], {
      read: fs.read,
      write: fs.write,
      exists: fs.exists,
      log: () => {},
      err: () => {},
      env: {},
    });
    expect(code).toBe(0);
    expect(fs.store[FILE]).toContain('A1B2C3D4E5.com.praeventio.guard');
  });
});
