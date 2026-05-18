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
    exclude: ['src/rules-tests/**', 'node_modules/**', 'dist/**', 'coverage/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
