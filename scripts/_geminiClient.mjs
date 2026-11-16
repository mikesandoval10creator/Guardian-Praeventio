/**
 * Shared Gemini Developer API client helper for standalone Node scripts.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `@google/genai` v3.0.0 changed the default Gemini Developer API version
 * from `v1beta` to `v1`. The models this project calls
 * (`gemini-3-flash-preview`, `gemini-3.1-pro-preview`, …) are `-preview`
 * SKUs that upstream documents as available only on `v1beta`, and there is
 * an open upstream bug where `v1` rejects the SDK's own request body
 * (`systemInstruction`, `responseMimeType`):
 *
 *   https://github.com/googleapis/js-genai/issues/1746
 *
 * The TypeScript application code goes through
 * `src/services/ai/geminiClientFactory.ts`, which pins `apiVersion`.
 * These `.mjs` scripts cannot import that TypeScript module directly, so
 * they share this tiny JS mirror of the same pin.
 *
 * The two must stay in sync. `src/services/ai/geminiClientFactory.test.ts`
 * asserts the TypeScript constant; the mirror here is asserted by
 * `scripts/_geminiClient.test.mjs` — keep both in the same commit.
 */

/** The API version every Gemini Developer API call in this repo uses. */
export const GEMINI_API_VERSION = 'v1beta';

/**
 * Build a `GoogleGenAI` client pinned to {@link GEMINI_API_VERSION}.
 *
 * @param {{ apiKey: string }} options
 * @param {typeof import('@google/genai').GoogleGenAI} GoogleGenAI
 *   The SDK class, injected so this module stays importable in contexts
 *   where the SDK is not installed (e.g. dry-run mode).
 */
export function createGeminiClient(GoogleGenAI, options) {
  return new GoogleGenAI({
    apiKey: options.apiKey,
    apiVersion: GEMINI_API_VERSION,
  });
}
