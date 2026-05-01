/**
 * LanguageProvider — language detection precedence + persistence.
 *
 * Detection order (highest priority first):
 *   1. localStorage (`praeventio_locale`)
 *   2. user document `locale` field (passed in via `userLocale` prop)
 *   3. navigator.language (mapped to a supported tag)
 *   4. fallback `'es'` (Spanish-CL default)
 *
 * On `setLanguage(lang)`:
 *   - persists to localStorage
 *   - calls `i18n.changeLanguage(lang)`
 *   - invokes `onLanguagePersist?(lang)` so the caller (Firebase user doc)
 *     can write `users/{uid}.locale = lang`.
 *
 * The provider exposes a pure helper `resolveInitialLanguage` so we can
 * unit-test the precedence rules without a React tree (the React layer is
 * a thin context wrapper validated separately by build/typecheck).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveInitialLanguage,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  normalizeLocale,
} from './LanguageProvider';

describe('LanguageProvider — resolveInitialLanguage precedence', () => {
  beforeEach(() => {
    // Reset any spies between cases.
    vi.restoreAllMocks();
  });

  it('returns the localStorage value when it is a supported locale (highest priority)', () => {
    const got = resolveInitialLanguage({
      storedLocale: 'pt-BR',
      userLocale: 'en',
      navigatorLanguage: 'es-AR',
    });
    expect(got).toBe('pt-BR');
  });

  it('falls through to user document when localStorage is missing', () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: 'es-MX',
      navigatorLanguage: 'en-US',
    });
    expect(got).toBe('es-MX');
  });

  it('falls through to navigator.language when both localStorage and user doc are missing', () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: null,
      navigatorLanguage: 'pt-BR',
    });
    expect(got).toBe('pt-BR');
  });

  it("falls back to 'es' when nothing is set (Spanish-CL default)", () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: null,
      navigatorLanguage: null,
    });
    expect(got).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('es');
  });

  it('ignores localStorage values that are not in the supported list', () => {
    const got = resolveInitialLanguage({
      storedLocale: 'fr-FR', // unsupported
      userLocale: 'es-AR',
      navigatorLanguage: 'en',
    });
    expect(got).toBe('es-AR');
  });

  it('maps a bare "pt" navigator hint to "pt-BR" (the only Portuguese variant we ship)', () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: null,
      navigatorLanguage: 'pt',
    });
    expect(got).toBe('pt-BR');
  });

  it('maps a bare "es" navigator hint to the default es (es-CL fallback)', () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: null,
      navigatorLanguage: 'es',
    });
    expect(got).toBe('es');
  });

  it('maps an unknown Spanish region (e.g. "es-ES") to the generic es fallback', () => {
    const got = resolveInitialLanguage({
      storedLocale: null,
      userLocale: null,
      navigatorLanguage: 'es-ES',
    });
    expect(got).toBe('es');
  });
});

describe('LanguageProvider — normalizeLocale', () => {
  it('returns the exact tag if supported', () => {
    expect(normalizeLocale('es-MX')).toBe('es-MX');
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
    expect(normalizeLocale('en')).toBe('en');
  });

  it('strips region for an unsupported region (e.g. en-GB → en)', () => {
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
  });

  it('returns null for unsupported families', () => {
    expect(normalizeLocale('fr-FR')).toBeNull();
    expect(normalizeLocale('zh')).toBeNull();
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale('')).toBeNull();
  });
});

describe('LanguageProvider — SUPPORTED_LOCALES contract', () => {
  it('ships exactly the 6 locales documented in the rollout plan', () => {
    expect(SUPPORTED_LOCALES).toEqual(['es', 'es-MX', 'es-PE', 'es-AR', 'pt-BR', 'en']);
  });

  it("'es' is the default and always present (Spanish-CL fallback contract)", () => {
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(SUPPORTED_LOCALES[0]).toBe('es');
  });
});
