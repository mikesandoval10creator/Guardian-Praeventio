// Praeventio Guard — shared "degraded but usable" signal for Gemini actions.
//
// Some Gemini actions are LIFE-SAFETY (e.g. emergency-plan generation): the
// worker must ALWAYS get a usable response, never an error screen. But when the
// upstream Gemini *request itself* fails (transient 503, network outage, a
// transport-level safety block), silently returning a fallback as a normal
// result would hide the outage from the shared Gemini circuit breaker. The
// breaker drives the resilient failover (ADR 0019) — in a real outage it must
// trip so traffic fails over to the on-device SLM instead of every RPC hammering
// a dead upstream.
//
// `GeminiDegradedError` reconciles both: an action throws it carrying a
// deterministic fallback. The `/api/gemini` dispatcher records a breaker
// FAILURE (so the breaker opens and the SLM path engages) yet still returns the
// carried fallback to the caller with HTTP 200, so the worker is never left
// without a plan.

export class GeminiDegradedError extends Error {
  /** Usable fallback the dispatcher returns to the caller despite the failure. */
  readonly degradedResult: unknown;

  constructor(message: string, degradedResult: unknown, options?: { cause?: unknown }) {
    super(message);
    this.name = 'GeminiDegradedError';
    this.degradedResult = degradedResult;
    if (options?.cause !== undefined) {
      // Preserve the original upstream error for logging/Sentry.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Robust check that survives module-boundary duplication (the dispatcher
 * dynamically imports the backend, so a second class identity can appear).
 * Mirrors the `instanceof` + name-fallback pattern used for ProjectMembershipError.
 */
export function isGeminiDegradedError(
  err: unknown,
): err is GeminiDegradedError & { degradedResult: unknown } {
  return (
    err instanceof GeminiDegradedError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'GeminiDegradedError' &&
      'degradedResult' in (err as object))
  );
}
