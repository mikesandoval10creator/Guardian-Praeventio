// Governance guard for ADR 0021 — life-safety features are FREE on every tier.
//
// Tier-gating (`requireTier`) may ONLY guard management/scale/convenience
// features. It must NEVER be mounted on a life-safety route — SOS, emergency,
// ManDown, lone-worker, evacuation, brigade, DEA, first-responder, incident/
// hazard reporting. Putting any of those behind a paywall would be both
// unethical for a risk-prevention app and incompatible with the regulatory
// duty of care.
//
// This test fails CI if anyone (human or AI) wires `requireTier` onto a
// life-safety route. See docs/architecture-decisions/0021-life-safety-features
// -free-all-tiers.md.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(process.cwd(), 'src', 'server', 'routes');

/** Route source files (recursive), excluding tests. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Life-safety route FILES — these must never reference requireTier at all.
const LIFE_SAFETY_FILES = new Set([
  'emergency.ts',
  'emergencyBrigade.ts',
  'evacuation.ts',
  'evacuationHeadcount.ts',
  'firstResponderMap.ts',
  'incidentBundle.ts',
  'incidentFlow.ts',
  'incidentTrends.ts',
  'incidents.ts',
  'loneWorker.ts',
  'sif.ts',
]);

// Life-safety PATH fragments — a gated route whose path matches any of these
// is a violation even if it lives in an otherwise-management file.
const LIFE_SAFETY_PATH_PATTERNS = [
  'sos',
  'emergency',
  'evacuat',
  'man-down',
  'mandown',
  'brigade',
  '/dea',
  'incident',
  'lone-worker',
  'loneworker',
  'panic',
  'declare',
  'first-responder',
  'firstresponder',
  'rescue',
  'survival',
];

const ROUTE_CALL_RE = /\.(get|post|put|delete|patch)\(\s*[`'"]([^`'"]+)[`'"]/;

describe('ADR 0021 governance — life-safety routes are never tier-gated', () => {
  const files = routeFiles(ROUTES_DIR);

  it('finds the server route files (sanity)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no life-safety route FILE references requireTier', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const base = file.split('/').pop()!;
      if (!LIFE_SAFETY_FILES.has(base)) continue;
      if (/\brequireTier\s*\(/.test(readFileSync(file, 'utf8'))) {
        offenders.push(base);
      }
    }
    expect(offenders, `life-safety files must not tier-gate (ADR 0021): ${offenders.join(', ')}`).toEqual([]);
  });

  it('no requireTier(...) call guards a life-safety PATH', () => {
    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!/\brequireTier\s*\(/.test(line)) return;
        // Find the enclosing route path: scan backward (incl. this line) for the
        // nearest router.<verb>('<path>'.
        let path: string | null = null;
        for (let i = idx; i >= 0 && i >= idx - 20; i--) {
          const m = lines[i].match(ROUTE_CALL_RE);
          if (m) { path = m[2]; break; }
        }
        if (path === null) return; // not a mounted route line (e.g. an import)
        const lower = path.toLowerCase();
        if (LIFE_SAFETY_PATH_PATTERNS.some((p) => lower.includes(p))) {
          violations.push(`${file.split('/').pop()} → ${path}`);
        }
      });
    }
    expect(violations, `requireTier must not gate life-safety paths (ADR 0021): ${violations.join('; ')}`).toEqual([]);
  });
});
