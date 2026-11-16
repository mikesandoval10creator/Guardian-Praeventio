import { GoogleGenAI } from '@google/genai';
/**
 * Single factory for `@google/genai` clients.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `@google/genai` v3.0.0 changed the default Gemini Developer API version
 * from `v1beta` to `v1`:
 *
 *   https://github.com/googleapis/js-genai/blob/main/CHANGELOG.md#3000
 *
 * Several of the model SKUs this application actually calls are `-preview`
 * aliases that are NOT served on `v1`:
 *
 *   - `gemini-3.1-pro-preview`     (AI_MODEL_CHAT, AI_MODEL_REASONING, AI_MODEL_VISION)
 *   - `gemini-3-flash-preview`    (AI_MODEL_FAST)
 *   - `gemini-3.1-flash-preview`  (AI_MODEL_FAST_LONGFORM)
 *   - `gemini-3.1-flash-image-preview` (AI_MODEL_VISION_FAST)
 *
 * See `src/config/aiModels.ts` for the full registry. The upstream changelog
 * states the affected aliases "exist only on `v1beta`", so letting the SDK
 * default to `v1` turns every one of those calls into a runtime 404 /
 * model-not-found error that no unit test can catch (the whole suite mocks
 * the SDK).
 *
 * The SDK resolves the version in this order:
 *   1. `apiVersion` passed to the `GoogleGenAI` constructor (highest priority)
 *   2. `GOOGLE_GENAI_API_VERSION` environment variable
 *   3. the SDK's built-in default (`v1` since v3.0.0)
 *
 * We pin the version HERE, in code, rather than relying on (2) — an
 * environment variable that is missing in one deployment silently changes
 * every AI call's behaviour, and nothing in the repo would record that
 * requirement. Operators can still override via (1) is NOT available here
 * by design; if a future model rollout needs `v1`, the change belongs in
 * this file, reviewed and tested, not in an env file.
 *
 * Vertex AI is deliberately NOT routed through this factory: the Vertex
 * adapter uses a different SDK (`@google-cloud/vertexai`) and Vertex clients
 * are unaffected by the Developer API default change (they default to
 * `v1beta1`). See `src/services/ai/vertexAdapter.ts`.
 */

/**
 * The API version every Gemini Developer API call in Praeventio uses.
 *
 * `v1beta` is required because the default model registry (`aiModels.ts`)
 * points at `-preview` SKUs that are only served on `v1beta`.
 *
 * Do not change this to `v1` until every model in `GEMINI_MODEL_IDS` is
 * confirmed to be available on `v1` — and until the preview aliases have
 * been retired. That is a product + model-lifecycle decision, not a
 * dependency bump.
 */
export const GEMINI_API_VERSION = 'v1beta';

/**
 * Options accepted by {@link createGeminiClient}.
 *
 * `apiKey` is required and must be a non-empty string — the SDK throws on
 * an empty key, and every call site in this repo already guards with the
 * `GEMINI_API_KEY is not configured` error before constructing a client.
 */
export interface GeminiClientOptions {
  apiKey: string;
}

/**
 * Build a `GoogleGenAI` client pinned to {@link GEMINI_API_VERSION}.
 *
 * This is the ONLY sanctioned way to construct a Gemini Developer API
 * client in this repository. Direct `new GoogleGenAI(...)` calls bypass
 * the pinned API version and will silently target `v1` on `@google/genai`
 * v3+, breaking every `-preview` model call.
 */
export function createGeminiClient(options: GeminiClientOptions): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: options.apiKey,
    apiVersion: GEMINI_API_VERSION,
  });
}
