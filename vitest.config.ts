import { defineConfig } from 'vitest/config';

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
export default defineConfig({
  test: {
    // Backend/service tests run under node by default. React component
    // tests must put `// @vitest-environment jsdom` at the top of the
    // file (Vitest docs → "Environment" → per-file).
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
