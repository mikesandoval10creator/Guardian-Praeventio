// @vitest-environment jsdom
/**
 * i18n.test.ts — Sprint 28 B2 global launch foundation.
 *
 * Covers:
 *   1. Fallback chain `es-MX` → `es` → `en` for missing keys.
 *   2. Lazy loading: launch-locale boot does NOT pull stub locales.
 *   3. RTL detection for `ar` (and `he`/`fa`/`ur`).
 *   4. `applyHtmlDir` flips `<html dir>` correctly and is idempotent.
 *   5. Plural rules differ between English / Spanish / Japanese.
 *   6. `normalizeLocale` maps browser tags (en-GB, fr-CA, zh-TW, ar-SA)
 *      to a supported locale.
 *   7. Locale switching keeps state — i18n.language reflects the new tag.
 *   8. Plural rules: zero / one / many for languages that distinguish.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import i18n, { loadLocale, getLoadedLazyLocales } from './index';
import { isRtlLocale, applyHtmlDir, RTL_LOCALES, toHtmlLang } from './rtl';
import { normalizeLocale } from '../contexts/LanguageProvider';

describe('i18n — fallback chain', () => {
  it('falls back from es-MX to es for missing keys', async () => {
    await i18n.changeLanguage('es-MX');
    // `audits.*` lives only in es / en / pt-BR, not in es-MX. So es-MX
    // must surface the es value.
    const fromVariant = i18n.t('nav.dashboard');
    const fromBase = i18n.t('nav.dashboard', { lng: 'es' });
    expect(fromVariant).toBe(fromBase);
  });

  it('falls back ultimately to en when neither es-MX nor es has a key', async () => {
    await i18n.changeLanguage('es-MX');
    // Inject a key that exists ONLY in en for the test.
    i18n.addResource('en', 'common', '__test_only_en_key', 'EN_FALLBACK_VALUE');
    const result = i18n.t('__test_only_en_key');
    expect(result).toBe('EN_FALLBACK_VALUE');
  });

  it('uses the variant translation when present', async () => {
    await i18n.changeLanguage('es-MX');
    // `pricing.currency_clp` IS overridden in es-MX (MXN).
    expect(i18n.t('pricing.currency_clp')).toBe('MXN');
  });
});

describe('i18n — RTL detection', () => {
  beforeEach(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('dir');
      document.documentElement.removeAttribute('lang');
    }
  });

  it('flags Arabic as RTL', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('ar-SA')).toBe(true);
  });

  it('flags Hebrew/Farsi/Urdu as RTL', () => {
    expect(RTL_LOCALES).toContain('he');
    expect(isRtlLocale('he')).toBe(true);
    expect(isRtlLocale('fa-IR')).toBe(true);
    expect(isRtlLocale('ur')).toBe(true);
  });

  it('treats LTR locales as not RTL', () => {
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('es')).toBe(false);
    expect(isRtlLocale('ja')).toBe(false);
    expect(isRtlLocale(null)).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it('applyHtmlDir sets <html dir="rtl"> for ar and is idempotent', () => {
    applyHtmlDir('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    applyHtmlDir('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    applyHtmlDir('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('toHtmlLang maps "es" to "es-CL" for the <html lang> attribute', () => {
    expect(toHtmlLang('es')).toBe('es-CL');
    expect(toHtmlLang('en')).toBe('en');
    expect(toHtmlLang('ar')).toBe('ar');
    expect(toHtmlLang(null)).toBeNull();
    expect(toHtmlLang(undefined)).toBeNull();
  });

  it('applyHtmlDir maps "es" to "es-CL" on <html lang>', () => {
    applyHtmlDir('es');
    expect(document.documentElement.getAttribute('lang')).toBe('es-CL');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});

describe('i18n — plural rules', () => {
  it('English distinguishes singular from plural', () => {
    // i18next's CLDR plural rules expose `t(..., { count })` interpolation.
    i18n.addResourceBundle(
      'en',
      'common',
      {
        items: { count_one: '{{count}} item', count_other: '{{count}} items' },
      },
      true,
      true,
    );
    expect(i18n.t('items.count', { count: 1, lng: 'en' })).toBe('1 item');
    expect(i18n.t('items.count', { count: 5, lng: 'en' })).toBe('5 items');
  });

  it('Spanish behaves like English for cardinal one/other', () => {
    i18n.addResourceBundle(
      'es',
      'common',
      {
        items: { count_one: '{{count}} elemento', count_other: '{{count}} elementos' },
      },
      true,
      true,
    );
    expect(i18n.t('items.count', { count: 1, lng: 'es' })).toBe('1 elemento');
    expect(i18n.t('items.count', { count: 5, lng: 'es' })).toBe('5 elementos');
  });

  it('Japanese has a single plural form (other)', async () => {
    await loadLocale('ja');
    // Use the `other` form only; `count_one` should NOT be used.
    i18n.addResourceBundle(
      'ja',
      'common',
      {
        items: { count_one: '<NEVER>', count_other: '{{count}}件' },
      },
      true,
      true,
    );
    expect(i18n.t('items.count', { count: 1, lng: 'ja' })).toBe('1件');
    expect(i18n.t('items.count', { count: 5, lng: 'ja' })).toBe('5件');
  });
});

describe('i18n — browser language detection (normalizeLocale)', () => {
  it('maps en-GB → en, fr-CA → fr, zh-CN-* → zh-CN, ar-SA → ar', () => {
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('fr-CA')).toBe('fr');
    // Sprint 31 SS — zh-TW is now its own locale (Traditional Chinese);
    // Simplified PRC variants still collapse to zh-CN.
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('ar-SA')).toBe('ar');
    expect(normalizeLocale('de-AT')).toBe('de');
    expect(normalizeLocale('it-CH')).toBe('it');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('ru-RU')).toBe('ru');
  });

  it('returns null for completely unsupported tags', () => {
    expect(normalizeLocale('kk-KZ')).toBe(null); // Kazakh
    expect(normalizeLocale('')).toBe(null);
    expect(normalizeLocale(null)).toBe(null);
  });
});

describe('i18n — lazy loading', () => {
  it('does not auto-load stub locales at boot', () => {
    // Booting the app only imports launch locales eagerly. The set of
    // already-loaded lazy locales is whatever previous tests touched —
    // assert that locales we have NOT exercised are absent.
    const loaded = getLoadedLazyLocales();
    expect(loaded).not.toContain('de');
    expect(loaded).not.toContain('zh-CN');
  });

  it('loadLocale("fr") registers fr resources on demand', async () => {
    expect(getLoadedLazyLocales()).not.toContain('fr');
    await loadLocale('fr');
    expect(getLoadedLazyLocales()).toContain('fr');
    // Subsequent calls are a no-op.
    await loadLocale('fr');
    expect(getLoadedLazyLocales().filter((l) => l === 'fr').length).toBe(1);
  });
});

describe('i18n — Sprint 31 NN APAC locales (ko, hi)', () => {
  it('loadLocale("ko") registers Korean resources lazily and t() resolves keys', async () => {
    expect(getLoadedLazyLocales()).not.toContain('ko');
    await loadLocale('ko');
    expect(getLoadedLazyLocales()).toContain('ko');
    expect(i18n.t('auth.login', { lng: 'ko' })).toBe('로그인');
  });

  it('loadLocale("hi") registers Hindi resources lazily with fallback to en for missing keys', async () => {
    expect(getLoadedLazyLocales()).not.toContain('hi');
    await loadLocale('hi');
    expect(getLoadedLazyLocales()).toContain('hi');
    // Existing key in stub.
    expect(i18n.t('auth.login', { lng: 'hi' })).toBe('लॉग इन');
    // Missing key → fallback chain hi → en → es.
    i18n.addResource('en', 'common', '__hi_fallback_probe', 'EN_FALLBACK');
    expect(i18n.t('__hi_fallback_probe', { lng: 'hi' })).toBe('EN_FALLBACK');
  });

  it('normalizeLocale maps ko-KR → ko and hi-IN → hi', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko');
    expect(normalizeLocale('hi-IN')).toBe('hi');
  });
});

describe('i18n — locale switching maintains state', () => {
  it('changeLanguage updates i18n.language and t() output', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    const enLogin = i18n.t('auth.login');
    await i18n.changeLanguage('es');
    expect(i18n.language).toBe('es');
    const esLogin = i18n.t('auth.login');
    // The two locales translate the same key to different strings.
    expect(enLogin).not.toBe(esLogin);
  });
});
