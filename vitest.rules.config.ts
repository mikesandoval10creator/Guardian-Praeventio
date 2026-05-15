import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Vitest config dedicada a tests de Firestore Security Rules.
//
// 2026-05-15 (estabilización CI): el workflow `Firestore rules tests`
// rompía en main desde hace 8+ días porque hacía
// `npx vitest run src/rules-tests/` con la config default — y la default
// EXCLUYE `src/rules-tests/**` (decisión correcta: estos tests requieren
// el Firestore emulator corriendo, no se pueden correr en el sweep
// general). Esta config separada invierte el include/exclude para que
// `vitest run --config vitest.rules.config.ts` los ejecute.
export default defineConfig({
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
    // SOLO rules-tests. El sweep general (vitest.config.ts) excluye este path.
    include: ['src/rules-tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Más timeout porque cada test del emulator hace round-trips de red.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
