// Vitest gate for scripts/validate-i18n.cjs — the CLAUDE.md Rule #18
// (locale parity) ratchet.
//
// This test IS the CI gate (it runs in the default vitest suite, unlike the
// `.cjs` guard which only runs via the husky hook / `npm run lint:i18n`). If a
// new `es` key lands without an `en`/`pt-BR` translation, the live scan
// surfaces it here and the "Tests" check goes red.
//
// The guard is CommonJS (invoked from the husky hook), so we pull it in via
// createRequire. Requiring it does NOT run its `main()` — that's gated behind
// `require.main === module`.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const guard = require('../../../scripts/validate-i18n.cjs') as {
  scan: () => { referenceCount: number; missing: Record<string, string[]> };
  undeclaredUsed: () => string[];
  flatten: (
    o: Record<string, unknown>,
    prefix?: string,
    out?: Record<string, unknown>,
  ) => Record<string, unknown>;
  loadKeys: (loc: string) => Set<string> | null;
  REFERENCE: string;
  REQUIRED: string[];
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'scripts', 'i18n-parity-baseline.json'),
    'utf8',
  ),
) as {
  reference: string;
  missing: Record<string, string[]>;
  usedUndeclared?: string[];
};

describe('i18n parity guard (CLAUDE.md #18 ratchet)', () => {
  it('loads a non-trivial reference locale key set', () => {
    const ref = guard.loadKeys(guard.REFERENCE);
    expect(ref).not.toBeNull();
    expect(ref!.size).toBeGreaterThan(1000);
  });

  it('baseline reference matches the guard reference', () => {
    expect(baseline.reference).toBe(guard.REFERENCE);
  });

  it('flatten produces dotted keys for nested objects', () => {
    const out = guard.flatten({ a: { b: { c: 'x' }, d: 'y' }, e: 'z' });
    expect(Object.keys(out).sort()).toEqual(['a.b.c', 'a.d', 'e']);
  });

  // ── THE GATE ──────────────────────────────────────────────────────────────
  it('every launch locale has no NEW untranslated key (all baselined)', () => {
    const { missing } = guard.scan();
    for (const loc of guard.REQUIRED) {
      const base = new Set(baseline.missing[loc] ?? []);
      const newGaps = (missing[loc] ?? []).filter((k) => !base.has(k));
      expect(
        newGaps,
        `New untranslated key(s) in '${loc}' (present in '${guard.REFERENCE}'). ` +
          `Add the translation to src/i18n/locales/${loc}/common.json: ${newGaps.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('baseline has no stale entries (translated keys must be removed)', () => {
    const { missing } = guard.scan();
    for (const loc of guard.REQUIRED) {
      const live = new Set(missing[loc] ?? []);
      const stale = (baseline.missing[loc] ?? []).filter((k) => !live.has(k));
      expect(
        stale,
        `These '${loc}' keys are now translated — remove from baseline.missing.${loc}: ${stale.join(', ')}`,
      ).toEqual([]);
    }
  });
});

// AUDIT-2026-06 B20 — used-but-undeclared ratchet. ~3.1k literal t('key')
// usages reference keys that don't exist in es/common.json at all: every
// locale renders the inline Spanish default and the parity check above is
// blind to them. The baseline list may only SHRINK; new code introducing an
// undeclared literal key turns this red.
describe('i18n used-but-undeclared ratchet (B20)', () => {
  it('no NEW t() usages with keys undeclared in the es reference', () => {
    const live = guard.undeclaredUsed();
    const baselined = new Set(baseline.usedUndeclared ?? []);
    const newOnes = live.filter((k) => !baselined.has(k));
    expect(
      newOnes,
      `Declare these keys in src/i18n/locales/es/common.json (+ en, pt-BR): ${newOnes
        .slice(0, 10)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('ratchet hygiene: baselined keys that got declared should leave the baseline', () => {
    const live = new Set(guard.undeclaredUsed());
    const stale = (baseline.usedUndeclared ?? []).filter((k) => !live.has(k));
    // Aviso no-fatal vía aserción suave: solo exige que no haya MUCHA
    // deriva acumulada (>50 claves ya declaradas sin limpiar el baseline).
    expect(stale.length).toBeLessThanOrEqual(50);
  });
});
