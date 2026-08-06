// Vitest gate for scripts/security-review.cjs — the local security auditor.
//
// Bug ticket: 39aaa66d-73fe-8134-8321-d1c755ead1f8
//   "Auditor de seguridad interno no confiable (marca todo allow-read:true como Critical)"
//
// Symptom: `checkFirestoreRulesCoverage()` used a flat regex
// `/allow\s+(read|write)\s*:\s*if\s+true/.test(rules)` and flagged ANY
// match as Critical. Four collections are DELIBERATELY anonymous-readable
// (DEA / normatives / community_glossary / global_templates — see
// scripts/open-reads-ratchet-baseline.json) so the auditor produced noise
// on every run, defeating its purpose.
//
// Fix contract: extract `evaluateOpenReads(rulesText, allowedList)` as a
// pure function. It maps each `allow read: if true` to its enclosing
// collection path (heuristic brace-stack parse, mirrors
// check-open-reads-ratchet.cjs) and returns Critical findings only for
// paths NOT in the allowlist. `checkFirestoreRulesCoverage` now consumes
// the baseline JSON instead of hardcoding the four collections.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const reviewer = require('../../../scripts/security-review.cjs') as {
  evaluateOpenReads: (
    rulesText: string,
    allowed: string[],
  ) => Array<{ path: string; line: number }>;
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const baseline = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts', 'open-reads-ratchet-baseline.json'), 'utf8'),
) as { allowed: string[] };

const SYNTHETIC = [
  /* 1  */ "rules_version = '2';",
  /* 2  */ 'service cloud.firestore {',
  /* 3  */ '  match /databases/{database}/documents {',
  /* 4  */ '    // DELIBERATE: 4 allowlisted collections (paths mirror firestore.rules)',
  /* 5  */ '    match /normatives/{normativeId} {',
  /* 6  */ '      allow read: if true;',
  /* 7  */ '    }',
  /* 8  */ '    match /dea_locations/{deaLocationId} {',
  /* 9  */ '      allow read: if true;',
  /* 10 */ '    }',
  /* 11 */ '    match /community_glossary/{termId} {',
  /* 12 */ '      allow read: if true;',
  /* 13 */ '    }',
  /* 14 */ '    match /global_templates/{templateId} {',
  /* 15 */ '      allow read: if true;',
  /* 16 */ '    }',
  /* 17 */ '    // BUG: a NEW anonymous-readable collection',
  /* 18 */ '    match /private_user_pii/{uid} {',
  /* 19 */ '      allow read: if true;',
  /* 20 */ '      allow write: if true;',
  /* 21 */ '    }',
  /* 22 */ '    // CONTROL: still auth-gated',
  /* 23 */ '    match /projects/{projectId} {',
  /* 24 */ '      allow read: if request.auth != null;',
  /* 25 */ '    }',
  /* 26 */ '  }',
  /* 27 */ '}',
].join('\n');

describe('security-review.cjs — evaluateOpenReads (open-read allowlist)', () => {
  it('does NOT flag allowlisted collections as Critical', () => {
    const findings = reviewer.evaluateOpenReads(SYNTHETIC, baseline.allowed);
    const paths = findings.map((f) => f.path);
    expect(paths).not.toContain('/normatives/{id}');
    expect(paths).not.toContain('/dea_locations/{id}');
    expect(paths).not.toContain('/community_glossary/{termId}');
    expect(paths).not.toContain('/global_templates/{templateId}');
  });

  it('flags a NEW open-read collection that is NOT in the baseline', () => {
    const findings = reviewer.evaluateOpenReads(SYNTHETIC, baseline.allowed);
    const paths = findings.map((f) => f.path);
    expect(paths).toContain('/private_user_pii/{uid}');
  });

  it('reports the actual source line of the offending read', () => {
    const findings = reviewer.evaluateOpenReads(SYNTHETIC, baseline.allowed);
    const pii = findings.find((f) => f.path === '/private_user_pii/{uid}');
    expect(pii?.line).toBe(19);
  });

  it('flags a NEW open-WRITE collection even when read is gated (write exposure)', () => {
    const rulesWithOpenWrite = [
      /* 1  */ "rules_version = '2';",
      /* 2  */ 'service cloud.firestore {',
      /* 3  */ '  match /databases/{database}/documents {',
      /* 4  */ '    match /projects/{id} {',
      /* 5  */ '      allow read: if request.auth != null;',
      /* 6  */ '      allow write: if true;',
      /* 7  */ '    }',
      /* 8  */ '  }',
      /* 9  */ '}',
    ].join('\n');
    const findings = reviewer.evaluateOpenReads(rulesWithOpenWrite, baseline.allowed);
    expect(findings.map((f) => f.path)).toContain('/projects/{id}');
    expect(findings.find((f) => f.path === '/projects/{id}')?.line).toBe(6);
  });

  it('returns empty when rules have no open reads or writes', () => {
    const safe = [
      /* 1 */ "rules_version = '2';",
      /* 2 */ 'service cloud.firestore {',
      /* 3 */ '  match /databases/{database}/documents {',
      /* 4 */ '    match /projects/{id} {',
      /* 5 */ '      allow read, write: if request.auth != null;',
      /* 6 */ '    }',
      /* 7 */ '  }',
      /* 8 */ '}',
    ].join('\n');
    expect(reviewer.evaluateOpenReads(safe, baseline.allowed)).toEqual([]);
  });

  it('does NOT flag comments that contain "allow read: if true" as code', () => {
    const withComment = [
      /* 1 */ "rules_version = '2';",
      /* 2 */ 'service cloud.firestore {',
      /* 3 */ '  match /databases/{database}/documents {',
      /* 4 */ '    match /projects/{id} {',
      /* 5 */ '      // NOTE: never use `allow read: if true` for PII',
      /* 6 */ '      allow read: if request.auth != null;',
      /* 7 */ '    }',
      /* 8 */ '  }',
      /* 9 */ '}',
    ].join('\n');
    expect(reviewer.evaluateOpenReads(withComment, baseline.allowed)).toEqual([]);
  });

  it('uses baseline.allowed as source of truth (no hardcoded list)', () => {
    const customAllow = ['/normatives/{normativeId}'];
    const findings = reviewer.evaluateOpenReads(SYNTHETIC, customAllow);
    const paths = findings.map((f) => f.path);
    // Only normatives is allowed; the other 3 deliberate + 1 new are flagged.
    expect(paths).not.toContain('/normatives/{normativeId}');
    expect(paths).toContain('/dea_locations/{deaLocationId}');
    expect(paths).toContain('/community_glossary/{termId}');
    expect(paths).toContain('/global_templates/{templateId}');
    expect(paths).toContain('/private_user_pii/{uid}');
  });
});
