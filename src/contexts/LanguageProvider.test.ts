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
    // Sprint 28 B2 expanded supported locales (fr-FR is now valid). Use a
    // truly unrecognized BCP-47 tag so the precedence assertion stays robust
    // as new locales are added.
    const got = resolveInitialLanguage({
      storedLocale: 'xx-XX', // unsupported
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
    // Sprint 28 B2 expanded supported locales from 6 to 16 (added fr/de/it/
    // ja/zh-CN/zh-TW/ar/ko/hi/ru). Use unrecognized BCP-47 tags here so the
    // test stays honest as new locales land.
    expect(normalizeLocale('xx-XX')).toBeNull();
    expect(normalizeLocale('qq')).toBeNull();
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale('')).toBeNull();
  });
});

describe('LanguageProvider — SUPPORTED_LOCALES contract', () => {
  // Sprint 28 B2 expanded the rollout from 6 (es family + pt-BR + en) to
  // 16 locales for global launch (UK/CA/AU + APAC + RU). We assert the
  // exact list so additions/removals are intentional and reviewable.
  it('ships exactly the 16 locales documented in the global launch plan', () => {
    expect(SUPPORTED_LOCALES).toEqual([
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
    ]);
  });

  it("'es' is the default and always present (Spanish-CL fallback contract)", () => {
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(SUPPORTED_LOCALES[0]).toBe('es');
  });
});
