import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Vitest config dedicada a tests de stores Firestore client-side
// contra el emulator real (Plan 2026-05-23 Fase C).
//
// Decisión usuario 2026-05-23: tests de los 14 stores Sprint K se
// hacen contra `firestore-emulator` (no mocks). Mocks ya cubrieron
// las garantías del factory (createProjectScopedStore.test.ts 21 cases
// + contract 38 cases); el emulator agrega cobertura de:
//   - Round-trips reales (latencia mínima, side effects de listeners)
//   - Persistencia entre tests (clears explícitos en setup)
//   - Comportamiento de merge:true en setDoc
//   - Ordering + limit reales (mocks no validan el SDK behavior)
//
// Pattern verificado en `vitest.rules.config.ts` (`rules-tests` job CI
// existente). La diferencia clave: estos tests usan `firebase-admin`
// (bypass de rules) porque testean lógica de stores, no rules.
//
// La default `vitest.config.ts` EXCLUYE `*.firestore.test.ts` para que
// el sweep general (`npm test`) no intente correrlos sin emulator.
//
// CI: el workflow `firestore-stores` (ver `.github/workflows/ci.yml`)
// hace `firebase emulators:exec --only firestore --project praeventio-test
// "npx vitest run --config vitest.firestore.config.ts"`.

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
    name: 'firestore-stores',
    // Convención: cualquier archivo `*.firestore.test.ts` corre acá.
    include: ['src/**/*.firestore.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'coverage/**', 'src/rules-tests/**'],
    environment: 'node',
    setupFiles: ['./src/test/firestore-emulator-setup.ts'],
    globals: false,
    // El emulator es de proceso único — paralelización por threads
    // generaba write-conflicts intermitentes en runs anteriores. Forks
    // serial es estable. (vitest 4 movió poolOptions a top-level del
    // test config — los nested `poolOptions.forks` fueron deprecados.)
    pool: 'forks',
    forks: {
      singleFork: true,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
