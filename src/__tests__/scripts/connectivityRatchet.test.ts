// Vitest gate for scripts/check-connectivity-ratchet.cjs — the connectivity
// ratchet. Runs in the default suite (CI "Tests"), so a PR that adds a NEW
// orphan feature (a component/hook/page built but never mounted/routed) turns
// the check red, and one that CONNECTS a baselined orphan without regenerating
// the baseline also fails (forcing the count to ratchet down).
//
// CommonJS guard pulled in via createRequire; requiring it does not run main().

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ratchet = require('../../../scripts/check-connectivity-ratchet.cjs') as {
  scan: (files?: string[]) => string[];
  listSrcFiles: () => string[];
  exportsOf: (src: string) => string[];
  isCandidate: (key: string) => boolean;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts', 'connectivity-ratchet-baseline.json'), 'utf8'),
) as { count: number; orphans: string[] };

// One shared scan pass (a full src/ read) — keeps the suite well under timeout.
const LIVE = ratchet.scan();
const BASE = new Set(baseline.orphans);
const LIVE_SET = new Set(LIVE);

describe('connectivity ratchet (everything built must be connected)', () => {
  it('exportsOf extracts component/hook symbols, ignores lowercase', () => {
    expect(ratchet.exportsOf('export function FooCard() {}')).toContain('FooCard');
    expect(ratchet.exportsOf('export const useThing = () => {}')).toContain('useThing');
    expect(ratchet.exportsOf('export const helper = 1')).not.toContain('helper');
    // UPPER_SNAKE consts are NOT features (a util module is not an orphan UI).
    expect(ratchet.exportsOf('export const SCHEMATIC_DIMS = {}')).not.toContain('SCHEMATIC_DIMS');
    // PascalCase with an acronym prefix still counts (MOCStatusPanel).
    expect(ratchet.exportsOf('export function MOCStatusPanel() {}')).toContain('MOCStatusPanel');
  });

  it('isCandidate flags components/hooks/pages only', () => {
    expect(ratchet.isCandidate('src/components/x/Y.tsx')).toBe(true);
    expect(ratchet.isCandidate('src/hooks/useX.ts')).toBe(true);
    expect(ratchet.isCandidate('src/services/x.ts')).toBe(false);
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('no NEW orphan feature appears beyond the baseline', () => {
    const added = LIVE.filter((f) => !BASE.has(f));
    expect(
      added,
      `New orphan(s) — mount in a page/route (everything built must be connected), or justify + regenerate \`node scripts/check-connectivity-ratchet.cjs --write\`: ${added.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline has no stale entries (connected orphans must be regenerated out)', () => {
    const resolved = baseline.orphans.filter((f) => !LIVE_SET.has(f));
    expect(
      resolved,
      `These orphans are now connected — regenerate: \`node scripts/check-connectivity-ratchet.cjs --write\`: ${resolved.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline count matches the orphan list length', () => {
    expect(baseline.count).toBe(baseline.orphans.length);
  });
});
