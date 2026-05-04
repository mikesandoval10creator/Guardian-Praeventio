/**
 * Generates a cryptographically secure random UUID, falling back to a
 * Math.random-based ID if `crypto.randomUUID` is unavailable. The
 * fallback is intentionally NOT cryptographically secure — it's only
 * for environments where the modern API is missing (very old jsdom
 * versions in test runs, IE-style fallbacks).
 *
 * Code that previously inlined `typeof crypto !== 'undefined' &&
 * crypto?.randomUUID ? crypto.randomUUID() : ...fallback` should
 * import this helper instead. This consolidates the feature-detect
 * + fallback into one auditable place that's properly tested.
 *
 * Why a deliberately non-secure fallback?
 *   We do NOT want to mask the missing API by polyfilling with a
 *   crypto-strong shim. If a runtime is missing WebCrypto, surfacing
 *   that as a degraded id (`fallback-…`) makes it obvious in logs and
 *   in any audit trail that the environment is non-standard. A silent
 *   crypto-strong polyfill would hide that signal and could mislead
 *   later threat-model reviews into believing all ids in a queue were
 *   produced by `crypto.randomUUID`.
 *
 * Why feature-detect at all?
 *   `crypto.randomUUID` lands in Node ≥14.17/≥15.6 and every modern
 *   browser, but Praeventio runs in a number of constrained sandboxes
 *   (older jsdom in CI legacy paths, embedded WebViews). A defensive
 *   detect costs one branch and removes a class of "undefined is not a
 *   function" crashes that previously surfaced only in production.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Math.random fallback — NOT cryptographically secure. Only used
  // when running in environments without the WebCrypto API.
  return 'fallback-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}
