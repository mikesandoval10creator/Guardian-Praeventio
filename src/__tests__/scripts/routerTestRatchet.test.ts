// Vitest gate for scripts/check-router-test-ratchet.cjs — the router behavioral-
// coverage ratchet. Runs in the default suite (CI "Tests"), so a PR that adds a
// NEW Express router without a real-router supertest turns the check red, and
// one that COVERS a baselined router without regenerating the baseline also
// fails (forcing the uncovered count to ratchet down).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ratchet = require('../../../scripts/check-router-test-ratchet.cjs') as {
  scan: (routers?: string[], supertestFiles?: string[]) => string[];
  listRouters: () => string[];
  listSupertestFiles: () => string[];
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts', 'router-test-ratchet-baseline.json'), 'utf8'),
) as { total_routers: number; verified: number; uncovered_count: number; uncovered: string[] };

// One shared scan pass.
const ROUTERS = ratchet.listRouters();
const LIVE = ratchet.scan(ROUTERS);
const BASE = new Set(baseline.uncovered);
const LIVE_SET = new Set(LIVE);

describe('router behavioral-coverage ratchet (verified working = real-router supertest)', () => {
  it('discovers a substantial set of real routers', () => {
    expect(ROUTERS.length).toBeGreaterThan(100);
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('no NEW router lacks a behavioral test beyond the baseline', () => {
    const added = LIVE.filter((f) => !BASE.has(f));
    expect(
      added,
      `New router(s) with no real-router supertest — add a *.router.test.ts (import the real router + request(), 401/200/400), or justify + regenerate \`node scripts/check-router-test-ratchet.cjs --write\`: ${added.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline has no stale entries (now-covered routers must be regenerated out)', () => {
    const resolved = baseline.uncovered.filter((f) => !LIVE_SET.has(f));
    expect(
      resolved,
      `These routers are now tested — regenerate: \`node scripts/check-router-test-ratchet.cjs --write\`: ${resolved.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline arithmetic is consistent (total = verified + uncovered)', () => {
    expect(baseline.uncovered_count).toBe(baseline.uncovered.length);
    expect(baseline.verified + baseline.uncovered_count).toBe(baseline.total_routers);
  });
});
