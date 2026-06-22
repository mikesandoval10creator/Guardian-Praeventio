import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// Round 15 (I3 / A6 audit fix) — `environmentMatchGlobs` is REMOVED in
// Vitest 4 (we run 4.1.5). The previous config kept it as a dead option:
// it parsed silently but had ZERO effect. Now that jsdom is installed
// and component tests are arriving, the supported v4 mechanism is the
// per-file pragma `// @vitest-environment jsdom` at the top of each
// `.test.tsx` file. Backend (.test.ts) tests stay on the default `node`
// environment via the top-level `environment: 'node'` below.
//
// The alternative (`test.projects` workspaces) splits the run across
// separate runners — heavier, but supports per-environment setup files.
// For our single-setup case the per-file pragma is lighter and keeps
// this config flat.

// vitest 4 / vite 7 reject `#!/usr/bin/env node` shebangs in `.mjs`
// scripts (SyntaxError: Invalid or unexpected token). Node's loader
// tolerates them natively — this plugin strips the shebang so the
// vite-node transform stays happy when tests import .mjs scripts as
// fixtures (e.g. fillAndroidAssetlinks / fillIosAasa tests).
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
      // Sprint 30 Bucket II — see vite.config.ts for context.
      '@praeventio/capacitor-mesh': path.resolve(
        __dirname,
        'packages/capacitor-mesh/src/index.ts',
      ),
    },
  },
  test: {
    // Backend/service tests run under node by default. React component
    // tests must put `// @vitest-environment jsdom` at the top of the
    // file (Vitest docs → "Environment" → per-file).
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // `*.firestore.test.ts` corre via `vitest.firestore.config.ts` contra
    // el emulator. Excluido acá para que `npm test` (sweep general) no
    // intente correrlos sin emulator. Plan 2026-05-23 Fase C.1.
    exclude: [
      'src/rules-tests/**',
      'src/**/*.firestore.test.ts',
      'node_modules/**',
      'dist/**',
      'coverage/**',
    ],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Align the local default with CI (`test:ci` passes --test-timeout=30000).
    // The 5s default is too tight for the heavy ratchet / module-import smoke
    // tests under full-suite concurrency: a synchronous test that blows the
    // timeout can't be aborted, so vitest force-kills its fork ("Worker exited
    // unexpectedly") and the pool hangs to the 30-min CI cap. Headroom here +
    // the single-pass anyRatchet scan keep those tests well under the limit.
    testTimeout: 30_000,
    // AUDIT-2026-06 — the CI "Tests" job intermittently completed all tests
    // and then hung to the 30-min cap (3 occurrences on 2026-06-10 alone):
    // module-level intervals / Firestore Admin listeners left open by an
    // imported module keep a worker's event loop alive forever. A bounded
    // teardown lets vitest kill lingering workers instead of waiting.
    teardownTimeout: 10_000,
    // 2026-06-22 fix/vitest-pool-hang: activate vitest's built-in
    // AsyncHook-based leak detector. When a test file leaves async resources
    // alive (TCP sockets, timers, Firestore listeners, MQTT adapters), this
    // reports the culprit with a stack trace instead of silently hanging for
    // 14+ minutes until the CI watchdog force-kills the runner.
    // Individual leakers fixed in the same PR:
    //   • src/server/routes/healthDeep.test.ts — setTimeout(10_000) slow probe
    //   • src/services/observability/resilienceHealthMonitor.test.ts — setTimeout(5000)
    //   • src/server/triggers/mqttTelemetryBridge.test.ts — handle.stop() missing
    detectAsyncLeaks: true,
    // Coverage instrumentation (Plan v3 Fase 1.0 — 2026-05-29). Provider
    // pinned to the exact vitest version. `all: true` counts source files
    // with NO importing test too, so the denominator is the honest "what
    // the app actually has", not just files a test happened to touch.
    // Thresholds are intentionally absent here — they get added as a
    // ratchet (scripts/check-coverage-ratchet.cjs) AFTER the baseline is
    // measured, so this run never fails for being below an aspirational 90.
    coverage: {
      provider: 'v8',
      // Emit the report even when some tests fail — during the coverage-lift
      // work the suite is occasionally red mid-edit, and we still want to see
      // the number move. (vitest defaults this to false.)
      reportOnFailure: true,
      all: true,
      include: ['src/**/*.{ts,tsx}', 'server.ts'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/__tests__/**',
        'src/test/**',
        'src/rules-tests/**',
        'src/**/*.firestore.test.ts',
        'src/**/__mocks__/**',
        'src/**/*.d.ts',
        'src/vite-env.d.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
