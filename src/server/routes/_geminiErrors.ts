// Praeventio Guard — Phase 5 · F2: /api/gemini dispatch error classification.
//
// Pure, dependency-free so it can be unit-tested without importing the heavy
// gemini route (firebase-admin, limiters, GoogleGenAI). The dispatcher uses it
// inline to pick the right HTTP status for a failed Gemini RPC.

/**
 * True when a dispatch error means the UPSTREAM Gemini response was
 * unparseable or empty — a bad *gateway* condition (HTTP 502), not an internal
 * server bug (500).
 *
 * - `parseGeminiJson` (src/services/gemini/parsing.ts) throws
 *   `Error('gemini_empty_response')` when the model returns no text
 *   (safety-blocked, non-STOP finish, empty completion).
 * - A malformed (non-JSON) body makes `JSON.parse` throw a `SyntaxError`.
 *
 * Mapping both to 502 lets a client distinguish "the AI returned garbage,
 * retry" from "our server broke", without leaking internals (convention #8).
 * Matches `SyntaxError` instances and any error-shaped object whose `message`
 * is exactly `gemini_empty_response` (duck-typed so it survives async/import
 * boundaries that can strip the prototype).
 */
export function isUpstreamGeminiParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error as { message?: string } | null)?.message === 'gemini_empty_response'
  );
}
