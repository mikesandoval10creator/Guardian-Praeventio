// Praeventio Guard — single source of truth for obtaining a Gemini API key.
//
// WHY THIS EXISTS
// ---------------
// Until now, 31 production modules read the key at MODULE SCOPE:
//
//   const API_KEY = process.env.GEMINI_API_KEY;   // evaluated at import time
//
// That captures whatever the environment held when the module was first
// imported. It makes the app impossible to run with a per-user / per-tenant
// credential ("bring your own LLM subscription"), because the value is frozen
// before any request is ever handled.
//
// This module resolves the key at CALL time instead, and is the single seam
// where a per-user credential will be introduced later:
//
//   getGeminiApiKey()              -> process env (today)
//   getGeminiApiKey(requestContext) -> per-user credential (next PR)
//
// CONTRACT
// --------
// - Returns `string | undefined`. An absent key is NOT an error here; the
//   caller decides how to fail (most callers throw a config error, which is
//   the pre-existing behaviour and is preserved).
// - Resolution is deliberately side-effect free and cheap: it reads
//   `process.env` on each call rather than caching, so a secret injected or
//   rotated at runtime is picked up without a restart.
// - The value is never logged, never returned to a client, and never included
//   in an error message.

/**
 * Context that may eventually carry a caller-supplied credential.
 *
 * Today this is an empty interface on purpose: the per-user credential
 * implementation lands in a later PR, and every call site already threads
 * through this type, so adding the field is a non-breaking change here.
 */
export interface GeminiApiKeyContext {
  /** Reserved for the per-user / per-tenant credential (added in a later PR). */
  readonly userApiKey?: string;
}

/**
 * Resolve the Gemini API key for a single call.
 *
 * @param context Optional caller context carrying an explicit credential.
 *   When present and non-empty it takes precedence over the environment.
 * @returns The API key, or `undefined` when none is configured.
 */
export function getGeminiApiKey(context?: GeminiApiKeyContext): string | undefined {
  const explicit = context?.userApiKey?.trim();
  if (explicit) return explicit;

  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  return fromEnv ? fromEnv : undefined;
}

/**
 * Resolve the Gemini API key for a single call, throwing a configuration
 * error when none is available.
 *
 * This preserves the historical behaviour of the migrated call sites
 * (`if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured')`)
 * without duplicating the message in 31 modules.
 */
export function requireGeminiApiKey(context?: GeminiApiKeyContext): string {
  const key = getGeminiApiKey(context);
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  return key;
}
