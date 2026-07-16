// Vitest gate for scripts/check-open-reads-ratchet.cjs — the Firestore
// open-reads allowlist ratchet. The plugin rule
// `@firebase/security-rules/no-open-reads` warns on every `allow read: if
// true`, but its parser exposes no comments to ESLint, so per-line
// eslint-disable is impossible. This gate pins the EXACT set of deliberate
// anonymous-read collections (baseline) and turns any NEW open read from a
// warning into a hard failure — stronger than the raw warn.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ratchet = require('../../../scripts/check-open-reads-ratchet.cjs') as {
  mapOpenReads: (rulesText: string, lines: number[]) => string[];
  collectLive: () => { openReads: string[]; others: Array<{ severity: number }> };
  RULE_ID: string;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts', 'open-reads-ratchet-baseline.json'), 'utf8'),
) as { rule: string; allowed_count: number; allowed: string[] };

describe('open-reads line→collection mapper (heuristic brace-stack parser)', () => {
  const SYNTHETIC = [
    /* 1 */ "rules_version = '2';",
    /* 2 */ 'service cloud.firestore {',
    /* 3 */ '  match /databases/{database}/documents {',
    /* 4 */ '    match /public_a/{docId} {',
    /* 5 */ '      allow read: if true;',
    /* 6 */ '    }',
    /* 7 */ '    match /parents/{parentId} {',
    /* 8 */ '      match /children/{childId} {',
    /* 9 */ '        allow read: if true;',
    /* 10 */ '      }',
    /* 11 */ '      // a comment with a brace { should not break depth',
    /* 12 */ '      allow read: if true;',
    /* 13 */ '    }',
    /* 14 */ '    match /public_b/{docId=**} {',
    /* 15 */ '      allow read: if true;',
    /* 16 */ '    }',
    /* 17 */ '  }',
    /* 18 */ '}',
  ].join('\n');

  it('maps a top-level collection', () => {
    expect(ratchet.mapOpenReads(SYNTHETIC, [5])).toEqual(['/public_a/{docId}']);
  });

  it('maps a nested match to the full chain', () => {
    expect(ratchet.mapOpenReads(SYNTHETIC, [9])).toEqual([
      '/parents/{parentId}/children/{childId}',
    ]);
  });

  it('does NOT leak a closed sibling match (line after nested block closes)', () => {
    // Line 12 sits in /parents AFTER /children closed — the naive
    // "nearest preceding match" heuristic gets this wrong; the stack must not.
    expect(ratchet.mapOpenReads(SYNTHETIC, [12])).toEqual(['/parents/{parentId}']);
  });

  it('handles wildcard segments and comment braces', () => {
    expect(ratchet.mapOpenReads(SYNTHETIC, [15])).toEqual(['/public_b/{docId=**}']);
  });
});

describe('open-reads allowlist ratchet (deliberate anonymous reads only)', () => {
  // One shared live pass — spawns the real ESLint CLI on the real
  // firestore.rules (same execution path as `npm run lint:rules`).
  const LIVE = ratchet.collectLive();
  const BASE = new Set(baseline.allowed);
  const LIVE_SET = new Set(LIVE.openReads);

  // ── THE GATE ────────────────────────────────────────────────────────────
  it('no NEW open-read collection beyond the baseline', () => {
    const added = LIVE.openReads.filter((c) => !BASE.has(c));
    expect(
      added,
      `New open read(s) in firestore.rules — an \`allow read: if true\` outside ` +
        `the deliberate-public allowlist. Justify inline (no PII, write-gated, ` +
        `rules tests) + regenerate \`node scripts/check-open-reads-ratchet.cjs --write\`, ` +
        `or revert: ${added.join(', ')}`,
    ).toEqual([]);
  }, 60_000);

  it('baseline has no stale entries (tightened reads must be regenerated out)', () => {
    const resolved = baseline.allowed.filter((c) => !LIVE_SET.has(c));
    expect(
      resolved,
      `These collections no longer read-open — regenerate: ` +
        `\`node scripts/check-open-reads-ratchet.cjs --write\`: ${resolved.join(', ')}`,
    ).toEqual([]);
  }, 60_000);

  it('baseline arithmetic is consistent and sorted', () => {
    expect(baseline.rule).toBe(ratchet.RULE_ID);
    expect(baseline.allowed_count).toBe(baseline.allowed.length);
    expect([...baseline.allowed].sort()).toEqual(baseline.allowed);
  });

  it('every allowlisted open read is one of the 4 documented public collections', () => {
    // Belt-and-braces: the allowlist itself is pinned. Growing it is a
    // deliberate act that must touch THIS test (PR scope gate #24 already
    // protects scripts/*-baseline.json).
    expect(baseline.allowed).toEqual([
      '/community_glossary/{termId}',
      '/dea_locations/{deaLocationId}',
      '/global_templates/{templateId}',
      '/normatives/{normativeId}',
    ]);
  });
});
