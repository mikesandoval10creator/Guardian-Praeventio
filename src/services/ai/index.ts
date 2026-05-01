/**
 * AI adapter facade — single entry point for picking the right provider.
 *
 * Selection rules (in order of preference, most-specific first):
 *
 *   AI_ADAPTER='vertex-ai'        → vertexAdapter if available, else
 *                                   gemini-consumer if available, else noop
 *   AI_ADAPTER='gemini-consumer'  → geminiAdapter if available, else noop
 *   AI_ADAPTER='noop'             → noopAdapter (explicit opt-out / debug)
 *   unset / unknown               → gemini-consumer (current default)
 *
 * The vertex-ai → gemini-consumer fallback is intentional: today, a config
 * of `AI_ADAPTER=vertex-ai` is forward-looking — operators set it expecting
 * Round 2 to land. Until then we don't want every AI call to throw; we
 * want it to keep working on the consumer endpoint and surface the
 * configuration drift via telemetry (`response.provider === 'gemini-consumer'`
 * when caller asked for `'vertex-ai'` is the smoking gun).
 *
 * If you do NOT want the silent fallback (e.g. data-residency must be
 * Santiago or nothing), set `AI_ADAPTER=vertex-ai` AND check the returned
 * adapter's `name` before calling — or wait for Round 2.
 *
 * Mirrors `getKmsAdapter()` in `src/services/security/kmsAdapter.ts`.
 */

import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
} from './aiAdapter.ts';
import { geminiAdapter } from './geminiAdapter.ts';
import { vertexAdapter } from './vertexAdapter.ts';

export type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
};
export { geminiAdapter, vertexAdapter };

/**
 * Always-available "do nothing" adapter. Returns an empty completion and
 * never throws. Used as the last-resort fallback when neither the
 * preferred nor the secondary adapter is available — call sites that
 * want strict behaviour should check `adapter.name === 'noop'` and
 * branch.
 *
 * Note `isAvailable === false`: the noop adapter is a fallback, not a
 * preference. The facade returns it without consulting `isAvailable`.
 */
export const noopAdapter: AiAdapter = {
  name: 'noop',
  region: 'none',
  isAvailable: false,
  async generate(_request: AiGenerateRequest): Promise<AiGenerateResponse> {
    return { text: '', provider: 'noop' };
  },
};

/**
 * Pick an adapter according to `AI_ADAPTER` and adapter availability.
 *
 * Read `AI_ADAPTER` on every call (NOT cached) so test suites can mutate
 * `process.env.AI_ADAPTER` between tests without restarting the module.
 * The underlying singleton adapters DO cache their own credentials at
 * construction time, which is correct: `GEMINI_API_KEY` should not change
 * mid-process in production.
 */
export function getAiAdapter(): AiAdapter {
  const raw = (process.env.AI_ADAPTER ?? 'gemini-consumer').toLowerCase();
  const preferred: AiProvider =
    raw === 'vertex-ai' || raw === 'gemini-consumer' || raw === 'noop'
      ? (raw as AiProvider)
      : 'gemini-consumer';

  if (preferred === 'noop') {
    return noopAdapter;
  }

  if (preferred === 'vertex-ai') {
    if (vertexAdapter.isAvailable) return vertexAdapter;
    // Fall through to gemini-consumer (silent forward-compat fallback).
    if (geminiAdapter.isAvailable) return geminiAdapter;
    return noopAdapter;
  }

  // preferred === 'gemini-consumer'
  if (geminiAdapter.isAvailable) return geminiAdapter;
  return noopAdapter;
}
