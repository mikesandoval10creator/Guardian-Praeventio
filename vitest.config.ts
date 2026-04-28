import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to node for backend/service tests; switch to jsdom for component tests.
    // React 19 component tests need `document` / `window`, backend tests don't.
    environment: 'node',
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
      ['src/**/*.test.ts', 'node'],
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
  },
});
