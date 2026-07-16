/**
 * Generates a cryptographically secure random UUID. If `crypto.randomUUID`
 * is unavailable it falls back to a `crypto.getRandomValues`-based id (still
 * crypto-random, far wider support), and only if WebCrypto is entirely absent
 * to a monotonic counter — never Math.random (CLAUDE.md #15). The fallback is
 * prefixed `fallback-` so it stays visible in logs/audits; it's only reached in
 * environments missing the modern API (very old jsdom in test runs, etc.).
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
// Monotonic per-runtime counter — only used by the last-resort fallback (no
// WebCrypto at all) to guarantee two consecutive ids differ without Math.random.
let fallbackCounter = 0;

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Degraded path (no crypto.randomUUID). Prefer crypto.getRandomValues — it has
  // far wider support, so the id stays crypto-random; only when WebCrypto is
  // entirely absent do we fall to a monotonic counter. Either way it is prefixed
  // `fallback-` so logs/audits surface that randomUUID was unavailable. We do NOT
  // use Math.random (CLAUDE.md #15 — and it keeps CodeQL's insecure-randomness
  // data-flow clean for every randomId() caller).
  let rand: string;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    rand = Array.from(bytes, (b) => b.toString(36)).join('');
  } else {
    rand = (fallbackCounter++).toString(36);
  }
  return 'fallback-' + rand + '-' + Date.now().toString(36);
}
