/**
 * Legacy i18n entry point — kept for backward compatibility.
 *
 * BEFORE Round 15 this file owned the inline `messages.es` / `messages.en`
 * resource maps and the `i18n.init(...)` call. Round 15 (R15 / I1) moved
 * the source of truth to `src/i18n/`:
 *
 *   - `src/i18n/index.ts`          — i18next bootstrap + resource registry
 *   - `src/i18n/locales/<lang>/`   — per-locale `common.json` bundles
 *
 * Migration path for callers:
 *
 *   - Components using `useTranslation()` from `react-i18next` keep
 *     working with no changes — they pick up the new bundles automatically
 *     because `src/i18n/index.ts` runs `initReactI18next` on first import.
 *   - `main.tsx` now imports `./i18n` directly (top-level side effect),
 *     but importing this file ALSO works (re-exports the same instance)
 *     so any in-tree caller that did `import './lib/i18n'` keeps working.
 *
 * Do not add new translation strings here — edit the JSON bundles under
 * `src/i18n/locales/`. Adding a new locale: see the documentation block
 * at the top of `src/i18n/index.ts`.
 */
export { default } from '../i18n';
export { resources } from '../i18n';
