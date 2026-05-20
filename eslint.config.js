// Praeventio Guard — ESLint flat config.
//
// Cierra Bloque 5.6 D2 (TODO §14): hasta 2026-05-20 el `npm run lint` solo
// linteaba `firestore.rules`. Ahora también cubre `src/**/*.{ts,tsx}` +
// `server.ts` con:
//   - @typescript-eslint (typed-rules opcionales OFF inicialmente para
//     evitar millones de warnings que rompen el build; activar gradual).
//   - eslint-plugin-react-hooks (rules-of-hooks + exhaustive-deps).
//
// Estrategia incremental: arrancar con reglas RECOMENDADAS sin
// `--max-warnings 0`. Fix iterativo por dominio hasta llegar a 0.
//
// Para activar typecheck-aware rules:
//   - Descomentar `parserOptions.project` + agregar rules typed (no-unsafe-*).

import js from "@eslint/js";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // 1. Firestore rules (mantenido sin cambios)
  js.configs.recommended,
  firebaseRulesPlugin.configs["flat/recommended"],
  {
    files: ["firestore.rules"],
    rules: {
      // Custom rules can go here
    },
  },

  // 2. TypeScript / TSX — D2 Bloque 5.6 (2026-05-20)
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "server.ts", "scripts/**/*.{ts,mjs,cjs}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // NOTE: enable when ready for typed rules (slower but more accurate):
        // project: ["./tsconfig.json", "./tsconfig.server.json"],
        // tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Browser
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        File: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        ReadableStream: "readonly",
        WritableStream: "readonly",
        TransformStream: "readonly",
        Worker: "readonly",
        SharedWorker: "readonly",
        ServiceWorker: "readonly",
        IndexedDB: "readonly",
        indexedDB: "readonly",
        IDBKeyRange: "readonly",
        crypto: "readonly",
        performance: "readonly",
        // Node
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        // Test
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      // React Hooks correctness — alto valor, pocos falsos positivos.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // TypeScript noise reduction — relajar reglas que generan demasiado
      // ruido sin tests-aware (typed-rules apagadas, ver parserOptions).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off", // mass-sweep C11 lo aborda
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          minimumDescriptionLength: 3,
        },
      ],

      // Base ESLint — silenciar conflicts con TS
      "no-unused-vars": "off", // TS handles it
      "no-undef": "off", // TS handles it
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-async-promise-executor": "warn",
      "no-control-regex": "off",
      "no-misleading-character-class": "warn",
      // no-useless-assignment genera falsos positivos en patrones
      // defensivos `let x = false; try { x = await ... } if (!x)` —
      // el initial value SÍ se usa cuando try lanza. Desactivado.
      "no-useless-assignment": "off",
    },
  },

  // 3. CommonJS scripts (.cjs) — node globals + require permitido
  {
    files: ["**/*.cjs", "scripts/**/*.{cjs,mjs}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "writable",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },

  // 4. Files to ignore globally
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "android/**",
      "ios/**",
      "infra/**/*.py",
      "scripts/**/*.py",
      "**/*.min.js",
      "**/*.bundle.js",
      "playwright-report/**",
      "test-results/**",
      ".telemetry/**",
      "**/*.generated.ts",
    ],
  },
];
