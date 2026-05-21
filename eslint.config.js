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

  // ── 2. TypeScript recommended (flat configs) ─────────────────────────────
  ...tseslint.configs.recommended,

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
    },
  },

  // ── 5. Firebase Firestore rules (sigue siendo gate independiente) ────────
  firebaseRulesPlugin.configs['flat/recommended'],
  {
    files: ['firestore.rules'],
    rules: {
      // Custom rules específicas a firestore.rules van aquí.
    },
  },
];
