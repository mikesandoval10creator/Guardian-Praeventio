// Praeventio Guard — ESLint flat config (ESLint 9+).
//
// H7 (cierre Fase A, 2026-05-21): el archivo previo sólo cubría
// `firestore.rules`. Esto extiende la cobertura a `src/**/*.{ts,tsx,js}` +
// `server.ts` con typescript-eslint + react-hooks (ambos ya en devDeps).
//
// Política de severidad (alineada con plan integrado Fase A.2):
//   • `error` se reserva para bugs reales (rules-of-hooks, no-redeclare,
//     no-undef, etc.). Romper el build queda para Fase F (cuando el
//     repo esté a 0 warnings).
//   • `warn` para deuda conocida que se irá limpiando en sprints
//     incrementales (`no-explicit-any` — 56 archivos pendientes,
//     `no-unused-vars` excepto args con prefix `_`, etc.).
//   • El script `npm run lint` NO pasa `--max-warnings=0` todavía;
//     se promoverá a strict gate en Fase F.
//
// Para correr solo las reglas Firestore: `npm run lint:rules`.

import js from '@eslint/js';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // ── 0. Ignores globales (flat config los respeta antes de cualquier rule) ──
  {
    ignores: [
      'node_modules/**',
      // Agent scratch output (worktrees + agents-output) — no es código fuente.
      '.claude/**',
      'dist/**',
      'build/**',
      'out/**',
      'coverage/**',
      '.stryker-tmp/**',
      'playwright-report/**',
      'test-results/**',
      'public/**',
      'android/**',
      'ios/**',
      'fastlane/**',
      'tools/**/dist/**',
      'packages/*/dist/**',
      'packages/*/node_modules/**',
      // Scripts standalone CJS/MJS — ejecutables Node, no comparten config TS.
      'scripts/**/*.cjs',
      'scripts/**/*.mjs',
      'bin/**/*.mjs',
      'src/__tests__/scripts/**/*.cjs',
      // Generated / vendored.
      '**/*.min.js',
      '**/*.bundle.js',
      'src/i18n/locales/**/*.json',
      // Type declarations vendoreadas.
      'src/types/vendor/**',
    ],
  },

  // ── 1. JS recommended base ───────────────────────────────────────────────
  js.configs.recommended,

  // ── 1b. Ajustes sobre la base JS ─────────────────────────────────────────
  {
    rules: {
      // AUDIT-2026-06: `catch {}` vacío es el idioma best-effort establecido
      // del repo (analytics, prefetch, vibration, etc.) — los 43 sitios son
      // todos catch. La regla sigue atrapando if/else/loops vacíos.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // AUDIT-2026-06: `no-useless-assignment` produce falsos positivos
      // documentados con el patrón `let ok = false; try { ok = await … }
      // finally {…}` (no modela code paths de excepciones). Ese patrón es
      // EXACTAMENTE el de nuestros flujos de firma biométrica
      // (AcknowledgmentBanner, PurchaseOrderSignModal, StoppageResumeModal,
      // verify middlewares) — "arreglar" código correcto para callar la
      // regla sería churn de riesgo en paths de seguridad. Off con causa.
      'no-useless-assignment': 'off',
    },
  },

  // ── 2. TypeScript recommended (flat configs) ─────────────────────────────
  ...tseslint.configs.recommended,

  // ── 1c. Ejecutables Node CJS fuera de scripts/ (loadtest, tests/dr) ──────
  {
    files: ['loadtest/**/*.cjs', 'tests/**/*.cjs'],
    rules: {
      // CJS ejecutable: require() es el sistema de módulos, no una elección.
      '@typescript-eslint/no-require-imports': 'off',
    },
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
      },
    },
  },


  // ── 3. Reglas TS/TSX del proyecto + react-hooks ──────────────────────────
  {
    files: ['src/**/*.{ts,tsx}', 'server.ts', 'packages/*/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // React hooks — rules-of-hooks es bug; exhaustive-deps es warning.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript — relax a warn para no romper build hasta Fase F.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          minimumDescriptionLength: 5,
        },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      // `let` con re-asignación inferida — no es bug.
      'prefer-const': 'warn',
      // No-undef no aplica a TS (lo cubre tsc); ESLint ts-eslint lo apaga.
      'no-undef': 'off',
      // No-redeclare lo cubre TS — apagamos el de eslint base para evitar
      // falsos positivos con overloads.
      'no-redeclare': 'off',
      // Permitir console.warn / console.error pero advertir sobre console.log.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // ── 4. Relax aun más en tests + scripts internos ─────────────────────────
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'src/__tests__/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': 'off',
      // Specs node (tests/dr) cargan módulos CJS hermanos vía require().
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ── 5. Firebase Firestore rules (sigue siendo gate independiente) ────────
  firebaseRulesPlugin.configs['flat/recommended'],
  {
    files: ['firestore.rules'],
    rules: {
      // Custom rules específicas a firestore.rules van aquí.
      //
      // KNOWN/EXPECTED: exactly 4× `no-open-reads` warnings — `normatives`,
      // `dea_locations`, `community_glossary`, `global_templates`. All four
      // are DELIBERATE anonymous-read collections (§UX-anonymous 2026-05-21
      // Instagram-model + ADR 0021 life-safety public AED map), each
      // justified inline in firestore.rules and exercised by rules tests
      // (e.g. src/rules-tests/deaLocations.rules.test.ts).
      //
      // They CANNOT be suppressed per-line: the plugin's parseForESLint
      // (v0.0.2) returns an ESTree stub with `comments: []`, so ESLint never
      // sees inline `eslint-disable` directives in .rules files.
      //
      // Do NOT set `no-open-reads` to "off" — the warning feeds the
      // open-reads allowlist ratchet (scripts/check-open-reads-ratchet.cjs,
      // baseline scripts/open-reads-ratchet-baseline.json, CLAUDE.md #25):
      // `npm run lint:rules` filters the 4 baselined collections and turns
      // any NEW open read into a HARD FAIL (exit 1) — stronger than warn.
      // Raw, unfiltered ESLint output: `npm run lint:rules:raw`.
    },
  },
];
