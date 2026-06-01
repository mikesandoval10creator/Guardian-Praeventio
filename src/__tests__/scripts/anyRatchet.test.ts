// Vitest gate for scripts/check-any-ratchet.cjs — the `as any` type-safety
// ratchet. Runs in the default suite (CI "Tests"), so a PR that ADDS an
// `as any` to a file beyond its baselined count turns the check red.
//
// CommonJS guard pulled in via createRequire; requiring it does not run main().

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ratchet = require('../../../scripts/check-any-ratchet.cjs') as {
  scan: () => Record<string, number>;
  listSrcFiles: () => string[];
  total: (counts: Record<string, number>) => number;
  AS_ANY_RE: RegExp;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts', 'any-ratchet-baseline.json'), 'utf8'),
) as { total: number; counts: Record<string, number> };

describe('as-any ratchet (type-safety)', () => {
  it('discovers production src files (tests excluded)', () => {
    const files = ratchet.listSrcFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(
      files.every(
        (f) =>
          /\.(ts|tsx)$/.test(f) &&
          !/\.(test|spec)\.(ts|tsx)$/.test(f) &&
          !f.includes(`${path.sep}__tests__${path.sep}`),
      ),
    ).toBe(true);
  });

  it('AS_ANY_RE matches the cast, not unrelated identifiers', () => {
    expect('x as any'.match(/\bas any\b/g)?.length).toBe(1);
    expect('canary anyhow'.match(ratchet.AS_ANY_RE)?.length ?? 0).toBe(0);
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('no file exceeds its baselined `as any` count (no regression)', () => {
    const live = ratchet.scan();
    const base = baseline.counts;
    const increases = Object.entries(live)
      .filter(([f, n]) => n > (base[f] ?? 0))
      .map(([f, n]) => `${f}: ${base[f] ?? 0} → ${n}`);
    expect(
      increases,
      `\`as any\` increased — give the value a real type instead of a cast: ${increases.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline has no stale entries (improved files must be regenerated)', () => {
    const live = ratchet.scan();
    const stale = Object.entries(baseline.counts)
      .filter(([f, n]) => (live[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} → ${live[f] ?? 0}`);
    expect(
      stale,
      `These files improved — regenerate: \`node scripts/check-any-ratchet.cjs --write\`: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline total matches the sum of its per-file counts', () => {
    const sum = ratchet.total(baseline.counts);
    expect(baseline.total).toBe(sum);
  });
});
