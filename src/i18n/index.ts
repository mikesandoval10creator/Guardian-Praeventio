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
 *   - Resources are bundled statically — every locale ships with the app
 *     because the strings are tiny (~80 keys each, ~12 KB total). Lazy
 *     loading would buy us nothing and complicates SSR/test setups.
 *   - Fallback chain: every non-`es` locale falls back to `es`
 *     (Spanish-CL baseline) so a missing key never renders an empty
 *     string in production.
 *
 * If you need to add a new locale: drop a `common.json` under
 * `src/i18n/locales/<tag>/` and add the tag to `SUPPORTED_LOCALES` in
 * `src/contexts/LanguageProvider.tsx`.
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

export const resources = {
  es: { common: esCommon, translation: esCommon },
  'es-MX': { common: esMXCommon, translation: esMXCommon },
  'es-PE': { common: esPECommon, translation: esPECommon },
  'es-AR': { common: esARCommon, translation: esARCommon },
  'pt-BR': { common: ptBRCommon, translation: ptBRCommon },
  en: { common: enCommon, translation: enCommon },
} as const;

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: {
        // Every variant falls back to its family root, then to es.
        'es-MX': ['es'],
        'es-PE': ['es'],
        'es-AR': ['es'],
        'pt-BR': ['es'],
        en: ['es'],
        default: ['es'],
      },
      supportedLngs: ['es', 'es-MX', 'es-PE', 'es-AR', 'pt-BR', 'en'],
      // Don't auto-load `es` for `es-XX` — every supported variant has its
      // own bundled resources. Letting i18next try to fetch a missing
      // chunk adds noise to the console.
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
