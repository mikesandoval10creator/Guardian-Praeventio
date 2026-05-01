import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import i18n from '../i18n';

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
 */
export const SUPPORTED_LOCALES = ['es', 'es-MX', 'es-PE', 'es-AR', 'pt-BR', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

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

  // Keep i18next in sync with our state.
  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
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
        await i18n.changeLanguage(lang);
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
