// Vitest gate for scripts/check-convention-guard.cjs — the CLAUDE.md #3/#19
// convention ratchet.
//
// This test IS the CI gate (it runs in the default vitest suite, unlike the
// `.cjs` guard tests which vitest does not discover). If a new route mutates
// Firestore without an `audit_logs` write and isn't baselined, the live scan
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
const guard = require('../../../scripts/check-convention-guard.cjs') as {
  scan: () => { rule3: string[]; rule19Tracked: string[] };
  routeName: (f: string) => string;
  listRouteFiles: () => string[];
  MUTATE_RE: RegExp;
  AUDIT_RE: RegExp;
  TXN_RE: RegExp;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'scripts', 'convention-guard-baseline.json'),
    'utf8',
  ),
) as {
  rule3_pending: Record<string, string>;
  rule3_exempt: Record<string, string>;
  rule19_pending: Record<string, string>;
};

describe('convention-guard (CLAUDE.md #3/#19 ratchet)', () => {
  it('discovers the real route files', () => {
    const files = guard.listRouteFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(
      files.every((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')),
    ).toBe(true);
  });

  it('routeName strips the routes dir + extension', () => {
    const visitors = guard.listRouteFiles().find((f) => f.endsWith('visitors.ts'));
    expect(visitors).toBeDefined();
    expect(guard.routeName(visitors!)).toBe('visitors');
  });

  it('MUTATE_RE / AUDIT_RE behave on synthetic input', () => {
    expect(guard.MUTATE_RE.test('await ref.update({ x: 1 })')).toBe(true);
    expect(guard.MUTATE_RE.test('new WorkPermitAdapter(db, t, p)')).toBe(true);
    expect(guard.MUTATE_RE.test("const s = await ref.get()")).toBe(false);
    expect(guard.AUDIT_RE.test("await auditServerEvent(req, 'a', 'b')")).toBe(true);
    expect(guard.AUDIT_RE.test("collection('audit_logs').add({})")).toBe(true);
    expect(guard.AUDIT_RE.test('just reads stuff')).toBe(false);
  });

  it('scan() returns a non-empty audit-missing set, all baselined', () => {
    // Robust against campaign progress: as routes are fixed, scan() and the
    // baseline shrink in lockstep — so we assert the relationship, not names.
    const { rule3 } = guard.scan();
    expect(rule3.length).toBeGreaterThan(0);
    const tracked = new Set([
      ...Object.keys(baseline.rule3_pending),
      ...Object.keys(baseline.rule3_exempt),
    ]);
    expect(rule3.every((r) => tracked.has(r))).toBe(true);
  });

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('every live rule#3 violation is baselined (no new un-tracked violations)', () => {
    const { rule3 } = guard.scan();
    const allowed = new Set([
      ...Object.keys(baseline.rule3_pending),
      ...Object.keys(baseline.rule3_exempt),
    ]);
    const unbaselined = rule3.filter((r) => !allowed.has(r));
    expect(
      unbaselined,
      `New mutating route(s) without audit_logs. Add auditServerEvent after the ` +
        `write (CLAUDE.md #3), or baseline them with a reason: ${unbaselined.join(', ')}`,
    ).toEqual([]);
  });

  it('baseline.rule3_pending has no stale entries (fixed routes must be removed)', () => {
    const { rule3 } = guard.scan();
    const live = new Set(rule3);
    const stale = Object.keys(baseline.rule3_pending).filter((r) => !live.has(r));
    expect(
      stale,
      `These routes now audit — remove from baseline.rule3_pending: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
