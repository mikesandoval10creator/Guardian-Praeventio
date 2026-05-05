import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import i18n, { loadLocale } from '../i18n';
import { applyHtmlDir } from '../i18n/rtl';

/**
 * Supported locales for Praeventio Guard.
 *
 * - `'es'` is the Spanish-CL baseline (default + ultimate fallback). Every
 *   key in every namespace MUST have an `es` translation; downstream
 *   locales fall back to `es` if a key is missing.
 * - `'es-MX' | 'es-PE' | 'es-AR'` are LATAM Spanish variants — mostly the
 *   same content as `es`, with regional terminology and currency hints.
 * - `'pt-BR'` is professional Brazilian Portuguese (target market: Brazilian
 *   construction / mining customers).
 * - `'en'` is full English for international evaluators (US/UK markets).
 * - Sprint 28 B2 — global launch foundation: `fr`, `de`, `it`, `ja`,
 *   `zh-CN`, `ar` (RTL) ship as stubs; their resources are lazy-loaded by
 *   `loadLocale()` only when the user picks them.
 */
export const SUPPORTED_LOCALES = [
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
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Human-readable native names for the locale picker. Listed in the order
 * the picker should display them: launch markets first, then global.
 */
export const LOCALE_DISPLAY: Record<SupportedLocale, { native: string; flag: string }> = {
  es: { native: 'Español', flag: '🇨🇱' },
  'es-MX': { native: 'Español (México)', flag: '🇲🇽' },
  'es-PE': { native: 'Español (Perú)', flag: '🇵🇪' },
  'es-AR': { native: 'Español (Argentina)', flag: '🇦🇷' },
  'pt-BR': { native: 'Português', flag: '🇧🇷' },
  en: { native: 'English', flag: '🇺🇸' },
  fr: { native: 'Français', flag: '🇫🇷' },
  de: { native: 'Deutsch', flag: '🇩🇪' },
  it: { native: 'Italiano', flag: '🇮🇹' },
  ja: { native: '日本語', flag: '🇯🇵' },
  'zh-CN': { native: '中文', flag: '🇨🇳' },
  ar: { native: 'العربية', flag: '🇸🇦' },
};

export const DEFAULT_LOCALE: SupportedLocale = 'es';

/** localStorage key for the user's chosen locale (survives logout). */
export const LOCALE_STORAGE_KEY = 'praeventio_locale';

/**
 * Map an arbitrary BCP-47 tag to a supported locale, or null if the
 * language family is not shipped.
 *
 * Rules:
 * - Exact match → return as-is.
 * - Spanish family (`es-*`) with an unknown region → fall back to `'es'`.
 * - Portuguese family (`pt-*`) → always `'pt-BR'` (only Portuguese variant
 *   we ship).
 * - English family (`en-*`) → always `'en'` (region-agnostic).
 * - Anything else → `null` (caller decides next fallback step).
 */
export function normalizeLocale(tag: string | null | undefined): SupportedLocale | null {
  if (!tag) return null;

  // Exact supported tag wins.
  if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) {
    return tag as SupportedLocale;
  }

  const lowered = tag.toLowerCase();
  if (lowered.startsWith('es-') || lowered === 'es') {
    return 'es';
  }
  if (lowered.startsWith('pt-') || lowered === 'pt') {
    return 'pt-BR';
  }
  if (lowered.startsWith('en-') || lowered === 'en') {
    return 'en';
  }
  // Sprint 28 B2 — global locales. Region-agnostic: `fr-CA` → `fr` etc.
  if (lowered.startsWith('fr-') || lowered === 'fr') return 'fr';
  if (lowered.startsWith('de-') || lowered === 'de') return 'de';
  if (lowered.startsWith('it-') || lowered === 'it') return 'it';
  if (lowered.startsWith('ja-') || lowered === 'ja') return 'ja';
  if (lowered.startsWith('zh-') || lowered === 'zh') return 'zh-CN';
  if (lowered.startsWith('ar-') || lowered === 'ar') return 'ar';

  return null;
}

interface ResolveOptions {
  storedLocale: string | null;
  userLocale: string | null;
  navigatorLanguage: string | null;
}

/**
 * Resolve the initial language for an app boot.
 *
 * Detection order (highest priority first):
 *   1. localStorage value (the user explicitly picked this locale before)
 *   2. user document `locale` field (synced across devices)
 *   3. navigator.language (browser/OS preference)
 *   4. fallback `'es'` (Spanish-CL default)
 *
 * Each candidate is normalized via `normalizeLocale` — unsupported families
 * are skipped to the next step rather than overriding a more reliable hint.
 */
export function resolveInitialLanguage({
  storedLocale,
  userLocale,
  navigatorLanguage,
}: ResolveOptions): SupportedLocale {
  return (
    normalizeLocale(storedLocale) ??
    normalizeLocale(userLocale) ??
    normalizeLocale(navigatorLanguage) ??
    DEFAULT_LOCALE
  );
}

interface LanguageContextValue {
  language: SupportedLocale;
  setLanguage: (lang: SupportedLocale) => Promise<void>;
  supportedLocales: readonly SupportedLocale[];
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
  /**
   * Locale read from the user's Firestore document (if signed in). Pass
   * `null`/`undefined` for anonymous boots — the provider will fall back
   * to navigator.language and finally to `'es'`.
   */
  userLocale?: string | null;
  /**
   * Hook for the caller to persist the chosen locale to its own backing
   * store (e.g. `users/{uid}.locale` in Firestore). The provider already
   * writes to localStorage and i18next; this is the cross-device hook.
   * Errors are swallowed so a Firestore outage cannot crash the UI.
   */
  onLanguagePersist?: (lang: SupportedLocale) => Promise<void> | void;
}

export function LanguageProvider({
  children,
  userLocale = null,
  onLanguagePersist,
}: LanguageProviderProps) {
  const [language, setLanguageState] = useState<SupportedLocale>(() => {
    let storedLocale: string | null = null;
    try {
      storedLocale = typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
        : null;
    } catch {
      // localStorage may throw in private mode / SSR — fall through.
    }
    const navigatorLanguage = typeof navigator !== 'undefined' ? navigator.language : null;
    return resolveInitialLanguage({ storedLocale, userLocale, navigatorLanguage });
  });

  // If the user document loads/changes after mount and we are still on the
  // default fallback, honour their saved preference.
  useEffect(() => {
    if (!userLocale) return;
    const normalized = normalizeLocale(userLocale);
    if (!normalized) return;
    let storedLocale: string | null = null;
    try {
      storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      storedLocale = null;
    }
    // Only adopt the user-doc locale if there is no localStorage override
    // (localStorage represents the most recent explicit user choice).
    if (!storedLocale && normalized !== language) {
      setLanguageState(normalized);
    }
  }, [userLocale, language]);

  // Keep i18next in sync with our state. Lazy-load any global locale before
  // switching, and apply the correct `<html dir>` for RTL languages.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadLocale(language);
      } catch (err) {
        // Swallow — fallback chain will still serve the right text.
        // eslint-disable-next-line no-console
        console.warn('[LanguageProvider] loadLocale failed:', err);
      }
      if (cancelled) return;
      if (i18n.language !== language) {
        await i18n.changeLanguage(language);
      }
      applyHtmlDir(language);
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  const setLanguage = useCallback(
    async (lang: SupportedLocale) => {
      setLanguageState(lang);
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, lang);
      } catch {
        // Ignore — storage may be disabled.
      }
      try {
        await loadLocale(lang);
        await i18n.changeLanguage(lang);
        applyHtmlDir(lang);
      } catch (err) {
        // i18next can fail to load a locale chunk — log but don't throw.
        // eslint-disable-next-line no-console
        console.warn('[LanguageProvider] i18n.changeLanguage failed:', err);
      }
      if (onLanguagePersist) {
        try {
          await onLanguagePersist(lang);
        } catch (err) {
          // Firestore write failure must not break the UI; localStorage
          // already has the latest value so the next boot will be correct.
          // eslint-disable-next-line no-console
          console.warn('[LanguageProvider] onLanguagePersist failed:', err);
        }
      }
    },
    [onLanguagePersist],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, supportedLocales: SUPPORTED_LOCALES }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
