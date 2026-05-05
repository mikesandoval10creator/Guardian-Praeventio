/**
 * i18next bootstrap for Praeventio Guard.
 *
 * Behaviour:
 *   - Initialised eagerly on first import (side-effectful, like the legacy
 *     `src/lib/i18n.ts`). Importing this file is enough to set up
 *     `useTranslation`.
 *   - Detection order delegated to `i18next-browser-languagedetector`:
 *     localStorage first, then navigator. The `LanguageProvider` context
 *     adds the Firestore-user-doc layer on top.
 *   - Sprint 28 B2 — global launch foundation:
 *     · Core launch locales (`es`, `es-MX`, `es-PE`, `es-AR`, `pt-BR`,
 *       `en`) are bundled statically — already present in production and
 *       small enough that we keep them eager (~12 KB total).
 *     · New locales (`fr`, `de`, `it`, `ja`, `zh-CN`, `ar`) are lazy-loaded
 *       via dynamic `import()` only when the user actually picks them.
 *       This keeps the initial bundle small and lets a country grow its
 *       chunk without affecting boot times worldwide.
 *   - Fallback chain: every variant falls back to its family root, then to
 *     `en`, then to `es`. So `es-MX` → `es` → `en`, `pt-BR` → `pt` → `en`,
 *     `ar` → `en` → `es`. A missing key never renders an empty string.
 *   - RTL: `LanguageProvider` watches the active locale and flips
 *     `<html dir>` via `applyHtmlDir()` (see `./rtl.ts`) when switching to
 *     `ar`/`he`/`fa`/`ur`.
 *
 * If you need to add a new locale: drop a `common.json` under
 * `src/i18n/locales/<tag>/` and add the tag to `SUPPORTED_LOCALES` in
 * `src/contexts/LanguageProvider.tsx`. If the language uses non-Western
 * digits or RTL script, also add the tag to `RTL_LOCALES` in
 * `src/i18n/rtl.ts`.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import esCommon from './locales/es/common.json';
import esMXCommon from './locales/es-MX/common.json';
import esPECommon from './locales/es-PE/common.json';
import esARCommon from './locales/es-AR/common.json';
import ptBRCommon from './locales/pt-BR/common.json';
import enCommon from './locales/en/common.json';

/**
 * Eagerly-bundled resources. Only the launch locales live here.
 * Stub locales (`fr`, `de`, ...) are loaded lazily by `loadLocale`.
 */
export const resources = {
  es: { common: esCommon, translation: esCommon },
  'es-MX': { common: esMXCommon, translation: esMXCommon },
  'es-PE': { common: esPECommon, translation: esPECommon },
  'es-AR': { common: esARCommon, translation: esARCommon },
  'pt-BR': { common: ptBRCommon, translation: ptBRCommon },
  en: { common: enCommon, translation: enCommon },
} as const;

/**
 * Locales that are NOT eagerly bundled. Calling `loadLocale(tag)` triggers
 * a `import()` and registers the resources with i18next on first use.
 *
 * Vite builds each entry into its own chunk thanks to the static
 * `import('./locales/<tag>/common.json')` form.
 */
const LAZY_LOCALES = ['fr', 'de', 'it', 'ja', 'zh-CN', 'ar', 'ko', 'hi', 'zh-TW', 'ru'] as const;
type LazyLocale = (typeof LAZY_LOCALES)[number];

const lazyLoaders: Record<LazyLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  fr: () => import('./locales/fr/common.json'),
  de: () => import('./locales/de/common.json'),
  it: () => import('./locales/it/common.json'),
  ja: () => import('./locales/ja/common.json'),
  'zh-CN': () => import('./locales/zh-CN/common.json'),
  ar: () => import('./locales/ar/common.json'),
  ko: () => import('./locales/ko/common.json'),
  hi: () => import('./locales/hi/common.json'),
  'zh-TW': () => import('./locales/zh-TW/common.json'),
  ru: () => import('./locales/ru/common.json'),
};

const loadedLazy = new Set<LazyLocale>();

/**
 * Ensure the resources for a locale are present in i18next. Eager locales
 * are a no-op; lazy locales are imported (once) and registered under both
 * `common` and `translation` namespaces to match the eager bundles.
 */
export async function loadLocale(tag: string): Promise<void> {
  if ((Object.keys(resources) as string[]).includes(tag)) return;
  if (!(LAZY_LOCALES as readonly string[]).includes(tag)) return;
  const lazy = tag as LazyLocale;
  if (loadedLazy.has(lazy)) return;
  const mod = await lazyLoaders[lazy]();
  const data = (mod as { default: Record<string, unknown> }).default ?? mod;
  i18n.addResourceBundle(lazy, 'common', data, true, true);
  i18n.addResourceBundle(lazy, 'translation', data, true, true);
  loadedLazy.add(lazy);
}

/**
 * Test-only hook: returns the set of lazy locales already loaded into the
 * i18next resource store. Used by `i18n.test.ts` to assert that boot does
 * not eagerly pull every language.
 */
export function getLoadedLazyLocales(): readonly string[] {
  return Array.from(loadedLazy);
}

/**
 * BCP-47 fallback chains. Keep aligned with `SUPPORTED_LOCALES` and the
 * `normalizeLocale` helper in `LanguageProvider.tsx`.
 *
 *   - LATAM Spanish variants → `es` → `en`
 *   - `pt-BR` → `en` → `es`
 *   - `en` → `es`
 *   - All new global locales → `en` → `es`
 *   - `default` → `es` (Spanish-CL baseline, the original product locale)
 */
const fallbackChains = {
  'es-MX': ['es', 'en'],
  'es-PE': ['es', 'en'],
  'es-AR': ['es', 'en'],
  'pt-BR': ['en', 'es'],
  en: ['es'],
  fr: ['en', 'es'],
  de: ['en', 'es'],
  it: ['en', 'es'],
  ja: ['en', 'es'],
  'zh-CN': ['en', 'es'],
  ar: ['en', 'es'],
  ko: ['en', 'es'],
  hi: ['en', 'es'],
  // Sprint 31 SS — APAC tier global. zh-TW cae a zh-CN primero
  // (95% del léxico SST coincide), luego en/es como red de seguridad.
  'zh-TW': ['zh-CN', 'en', 'es'],
  ru: ['en', 'es'],
  default: ['es'],
} as const;

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: fallbackChains,
      // Listed for browser-language detection. Lazy locales must be here
      // too or the detector will reject them.
      supportedLngs: [
        'es',
        'es-MX',
        'es-PE',
        'es-AR',
        'pt-BR',
        'en',
        'fr',
        'de',
        'it',
        'ja',
        'zh-CN',
        'ar',
        'ko',
        'hi',
        'zh-TW',
        'ru',
      ],
      // Don't auto-fetch missing chunks — `loadLocale()` registers lazy
      // locales explicitly when the user picks one.
      load: 'currentOnly',
      defaultNS: 'common',
      ns: ['common'],
      interpolation: {
        // React already escapes everything we render.
        escapeValue: false,
      },
      detection: {
        // localStorage first so an explicit user choice survives across
        // sessions. `LanguageProvider` writes to the same key
        // (`praeventio_locale`).
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'praeventio_locale',
        caches: ['localStorage'],
      },
      // Quieter test runs — vitest tests asserting on translated strings
      // would otherwise flood with i18next warnings on missing keys.
      returnNull: false,
    });
}

export default i18n;
