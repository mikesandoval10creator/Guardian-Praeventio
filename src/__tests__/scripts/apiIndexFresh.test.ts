// Vitest gate for scripts/gen-api-index.cjs — keeps docs/API-INDEX.md (the
// "where does real data live" route catalog) in sync with the actual mounted
// routes. Runs in the default suite (CI "Tests"): a PR that adds/moves a route
// without regenerating the index turns this red. Regenerate with
// `npm run gen:api-index` and commit docs/API-INDEX.md.
//
// Requiring the .cjs does NOT run its CLI (guarded by require.main).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const gen = require('../../../scripts/gen-api-index.cjs') as {
  generate: () => { content: string; mounts: number; totalRoutes: number; missingFiles: number };
  OUT: string;
};

describe('api-index freshness (route catalog must match the code)', () => {
  const fresh = gen.generate();

  it('detects a non-trivial number of mounted routes (regex still works)', () => {
    expect(fresh.mounts).toBeGreaterThan(100);
    expect(fresh.totalRoutes).toBeGreaterThan(400);
  });

  it('docs/API-INDEX.md exists and is up to date with server.ts', () => {
    expect(existsSync(gen.OUT)).toBe(true);
    const committed = readFileSync(gen.OUT, 'utf8');
    expect(committed.trim()).toBe(fresh.content.trim());
  });

  it('has no broken router imports (import points to a missing file)', () => {
    expect(fresh.missingFiles).toBe(0);
  });
});
