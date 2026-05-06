// Praeventio Guard — Sprint 35 DR dry-run.
//
// Dedicated vitest config for the DR dryrun spec. Kept separate from the
// main `vitest.config.ts` because:
//   1. The main config restricts `include` to `src/**`. DR specs live
//      under `tests/dr/` (mirrors `tests/e2e/` convention).
//   2. The DR spec needs a *very* long timeout (RTO target = 5 min, the
//      assertion fires AFTER restore completes).
//   3. We do NOT want this in the default `npm test` — it requires an
//      external Firestore emulator, takes ~5 min, and is opt-in only.
//
// Run via `npm run test:dr` (boots emulator + spec) or, for fast local
// iteration with an emulator already running:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   GOOGLE_CLOUD_PROJECT=demo-dr \
//   npx vitest run --config vitest.dr.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/dr/**/*.spec.ts'],
    // RTO target = 5 min; allow 10 min so a slow CI runner can still
    // surface the failure rather than time out ambiguously.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    globals: false,
    // DR spec is single-process by design — no shared state issues, but
    // also no benefit to parallelism (one emulator).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
