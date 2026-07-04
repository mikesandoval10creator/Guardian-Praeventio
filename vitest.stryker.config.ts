import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// Praeventio Guard — vitest config used EXCLUSIVELY by Stryker (mutation.yml).
//
// WHY THIS FILE EXISTS (2026-07-02): Stryker's initial dry-run executes the
// ENTIRE vitest suite once under perTest instrumentation to map coverage.
// With vitest.config.ts (full include: ~380 files / ~5.000 tests, jsdom
// page suites, v8 coverage enabled on every run, singleFork serialization)
// that dry-run outgrew dryRunTimeoutMinutes=20 on the 2-core CI runner —
// "Initial test run timed out!" killed the job BEFORE any mutant ran, so
// the Stryker check was chronically red with NO score computed (see run
// 28598377608 job 84799700743).
//
// The 15 mutated modules (stryker.config.json "mutate") are ALL backend:
// server middleware + services (slm, billing, safety, protocols,
// ergonomics, observability). Their real kill-coverage lives in the
// node-environment suites (colocated *.test.ts + src/__tests__/server/**).
// The jsdom page/component suites exercise those modules only through
// vi.mock stubs — they can't kill a single mutant in them, but they cost
// the bulk of the dry-run wall time (jsdom env spin-up + React renders).
//
// So this config:
//   • includes ONLY node-env .test.ts suites relevant to the mutated code,
//   • drops v8 coverage entirely (Stryker does its own instrumentation —
//     computing lcov on every mutant run is pure waste),
//   • keeps the pool/timeout/stability settings aligned with
//     vitest.config.ts so behavior stays comparable.
//
// If you add a NEW module to stryker.config.json "mutate", make sure its
// test files fall inside the include globs below — otherwise its mutants
// will show up as "no coverage" and drag the score down.

const stripShebangPlugin: Plugin = {
  name: 'praeventio:strip-shebang',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.mjs') && !id.endsWith('.cjs')) return null;
    if (!code.startsWith('#!')) return null;
    return {
      code: code.replace(/^#![^\n]*\n/, '// shebang stripped for vitest transform\n'),
      map: null,
    };
  },
};

export default defineConfig({
  plugins: [stripShebangPlugin],
  resolve: {
    alias: {
      '@praeventio/capacitor-mesh': path.resolve(
        __dirname,
        'packages/capacitor-mesh/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    // Node-env suites only — the coverage surface of the 15 mutated
    // backend modules. NO .tsx (jsdom) suites: they mock the mutated
    // modules away and only burn dry-run time.
    include: [
      'src/services/**/*.test.ts',
      'src/server/**/*.test.ts',
      'src/__tests__/server/**/*.test.ts',
      'src/lib/**/*.test.ts',
      'src/utils/**/*.test.ts',
    ],
    exclude: [
      'src/rules-tests/**',
      'src/**/*.firestore.test.ts',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.stryker-tmp/**',
    ],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Same stability rationale as vitest.config.ts (supertest TCP handles
    // destabilize sibling forks) — Stryker runs 4 of these runners in
    // parallel (concurrency: 4), each serialized internally.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    teardownTimeout: 10_000,
    detectAsyncLeaks: true,
    // NOTE: no `coverage` block on purpose — Stryker brings its own
    // instrumentation; v8/lcov output here would be discarded work on
    // every one of the ~2.200 mutant runs.
  },
});
