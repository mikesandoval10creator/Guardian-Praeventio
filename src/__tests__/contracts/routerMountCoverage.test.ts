// SPDX-License-Identifier: MIT
//
// Generic router-mount coverage contract (B1-D1).
//
// The 2026-06-01 block-by-block audit (TODO.md §17) found 20 routers under
// src/server/routes/ that were implemented and unit-tested but NEVER mounted in
// server.ts — so their real consumers (hooks/pages) got 404 in production. The
// per-router unit suites passed because they mount the router on a fresh Express
// app, never asserting the production wiring. serverMountOrder.test.ts pins the
// specific routers found, but a NEW orphan added tomorrow would slip through.
//
// This contract closes the class: every route module that default-exports an
// Express Router MUST be both imported AND mounted (app.use) in server.ts.
// It reads server.ts as text (server.ts boots Express at import time, so it
// cannot be imported here) and cross-references the routes directory.
//
// If you intentionally ship a router that is not mounted (e.g. superseded, or
// mounted by a sub-router), add it to INTENTIONALLY_UNMOUNTED with a reason.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(process.cwd(), 'src', 'server', 'routes');
const SERVER_TS = join(process.cwd(), 'server.ts');

// Routers deliberately not mounted in server.ts. Keep this list SHORT and
// justified — every entry is a documented exception, not a TODO.
const INTENTIONALLY_UNMOUNTED: Record<string, string> = {
  // (empty) — as of 2026-06-01 every default-Router route module is mounted.
};

/** Route modules that default-export an Express Router. */
function routerModules(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .filter((base) => {
      const src = readFileSync(join(ROUTES_DIR, `${base}.ts`), 'utf8');
      return /export\s+default\s+(router|Router|express\.Router)/.test(src);
    });
}

describe('router-mount coverage contract (B1-D1)', () => {
  const server = readFileSync(SERVER_TS, 'utf8');
  const modules = routerModules();

  it('discovers the route modules (sanity)', () => {
    // Guards against a glob/path regression silently emptying the check.
    expect(modules.length).toBeGreaterThan(100);
  });

  it('every default-Router route module is imported AND mounted in server.ts', () => {
    const orphans: string[] = [];

    for (const base of modules) {
      if (base in INTENTIONALLY_UNMOUNTED) continue;

      // 1. imported. Tolerates a combined default+named import spanning lines,
      //    e.g. `import curriculumRouter, {\n  foo,\n} from ".../curriculum.js"`.
      //    `[^;]*?` stays within the single import statement (bounded by `;`).
      const importRe = new RegExp(
        String.raw`import\s+(\w+)[^;]*?from\s+['"\`][^'"\`]*routes/${base}(\.js)?['"\`]`,
      );
      const importMatch = server.match(importRe);
      if (!importMatch) {
        orphans.push(`${base} (never imported)`);
        continue;
      }

      // 2. mounted: the imported identifier appears in an `app.use(...)`
      const ident = importMatch[1];
      const mountRe = new RegExp(String.raw`app\.use\([^)]*\b${ident}\b`);
      if (!mountRe.test(server)) {
        orphans.push(`${base} (imported as ${ident} but never mounted)`);
      }
    }

    expect(
      orphans,
      `Orphaned routers (implemented but not wired into server.ts → 404 in ` +
        `production). Mount them with app.use(...), or if intentional add to ` +
        `INTENTIONALLY_UNMOUNTED with a reason:\n  - ${orphans.join('\n  - ')}`,
    ).toEqual([]);
  });

  it('INTENTIONALLY_UNMOUNTED has no stale entries (all still exist + still unmounted)', () => {
    const stale: string[] = [];
    for (const base of Object.keys(INTENTIONALLY_UNMOUNTED)) {
      if (!modules.includes(base)) {
        stale.push(`${base} (no longer a default-Router module — remove entry)`);
      }
    }
    expect(stale).toEqual([]);
  });
});
