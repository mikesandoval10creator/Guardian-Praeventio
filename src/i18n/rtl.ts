/**
 * RTL helpers for Praeventio Guard.
 *
 * Sprint 28 B2 — global launch foundation. Centralises the RTL locale list
 * and provides idempotent helpers so any caller (LanguageProvider, App
 * boot, tests) can keep `<html dir>` in sync with the active locale.
 */

/**
 * Locale tags that require right-to-left text direction.
 *
 * Keep this list narrow on purpose — only locales with shipped translation
 * resources should be here. Adding a tag here without adding the matching
 * `locales/<tag>/common.json` will flip the direction at boot for users
 * whose browsers report that locale and produce a confusing empty UI.
 */
export const RTL_LOCALES: readonly string[] = ['ar', 'he', 'fa', 'ur'] as const;

/**
 * Returns true when the given BCP-47 tag should be rendered right-to-left.
 * Matches the language subtag, so `ar-SA` → true even though the exact tag
 * is not in `RTL_LOCALES`.
 */
export function isRtlLocale(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const lang = tag.toLowerCase().split('-')[0];
  return RTL_LOCALES.some((rtl) => rtl.toLowerCase().split('-')[0] === lang);
}

/**
 * Map an i18next locale tag to the BCP-47 value that should appear on the
 * `<html lang>` attribute. The i18n system uses bare `'es'` for the
 * Spanish-CL baseline, but SEO/a11y benefit from the full region subtag
 * (`es-CL`).
 */
export function toHtmlLang(tag: string | null | undefined): string | null {
  if (!tag) return null;
  if (tag === 'es') return 'es-CL';
  return tag;
}

/**
 * Apply the correct `dir` and `lang` attributes on `<html>` for the given
 * locale. Idempotent: calling it twice with the same locale is a no-op.
 * Safe to call from SSR / tests where `document` may be undefined.
 */
export function applyHtmlDir(tag: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const dir = isRtlLocale(tag) ? 'rtl' : 'ltr';
  if (document.documentElement.getAttribute('dir') !== dir) {
    document.documentElement.setAttribute('dir', dir);
  }
  const htmlLang = toHtmlLang(tag);
  if (htmlLang && document.documentElement.getAttribute('lang') !== htmlLang) {
    document.documentElement.setAttribute('lang', htmlLang);
  }
}
