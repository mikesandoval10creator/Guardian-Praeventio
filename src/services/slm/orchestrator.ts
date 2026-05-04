/**
 * Online/offline orchestrator for AI inference.
 *
 * Fase 1 (Sprint 20, Bucket Kappa, T-1.4). Single entry point that
 * decides whether a query should go to the server LLM (Gemini, via
 * `geminiAdapter`) or to the on-device SLM (`slmAdapter`).
 *
 * Decision rule, in order:
 *   1. `opts.forceOffline === true`  → SLM (debug / tests)
 *   2. `opts.forceOnline === true`   → server-side path
 *   3. `navigator.onLine === false`  → SLM
 *   4. otherwise                     → server-side path
 *
 * Stub-network path: the production wiring to `geminiAdapter` is left as
 * a TODO in T-1.4.1 because the existing `getAiAdapter()` surface returns
 * a generic `AiGenerateResponse` (not an `SLMResponse`), and the prompt-
 * shape mapping has to be coordinated with the prompt-engineering pass
 * shipping in a separate ticket. For now the online path falls through
 * to the SLM as well, which keeps this module testable end-to-end
 * without a network mock and preserves the contract that `ask()`
 * always resolves with an `SLMResponse`.
 *
 * What this module is deliberately NOT:
 *   - It does NOT enqueue offline sessions — that's `offlineQueue.ts`.
 *   - It does NOT reconcile pending sessions when the network returns —
 *     that's `reconciliation.ts`.
 *   - It does NOT touch UI state (toasts, badges) — call sites do that.
 */

import { complete as slmComplete } from './slmAdapter';
import type { SLMQuery, SLMResponse } from './types';

/**
 * Optional overrides for the online/offline decision.
 *
 * In production both fields stay `undefined` and the orchestrator follows
 * `navigator.onLine`. Tests and the in-app debug menu can flip either
 * boolean to pin behaviour.
 */
export interface OrchestratorOptions {
  /**
   * Force the offline (SLM) code path regardless of `navigator.onLine`.
   * Wins over `forceOnline` if both are set.
   */
  forceOffline?: boolean;
  /**
   * Force the online (server LLM) code path regardless of `navigator.onLine`.
   * Useful for the debug menu when developers want to validate the
   * server path on a flaky connection.
   */
  forceOnline?: boolean;
}

/**
 * Resolve whether the current call should travel the offline path.
 *
 * Pulled out so the test suite can pin behaviour deterministically and
 * so the rule itself is auditable as one expression rather than nested
 * inside `ask()`.
 */
function shouldUseOffline(opts: OrchestratorOptions): boolean {
  if (opts.forceOffline === true) return true;
  if (opts.forceOnline === true) return false;
  // navigator.onLine is the canonical browser signal. `false` means the
  // browser is sure we have no connectivity; `true` means "probably yes"
  // (it doesn't actively probe). We treat undefined / SSR as online so
  // node tests don't accidentally run the offline branch.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  return false;
}

/**
 * Run a single inference call, choosing online or offline transparently.
 *
 * The return type is `SLMResponse` for both paths so call sites have a
 * uniform shape to depend on; the online path will (in T-1.4.1) wrap
 * the Gemini response into the same shape.
 *
 * Throws whatever the underlying adapter throws — the orchestrator does
 * not retry or wrap errors, by design. The caller decides whether to
 * fall back, retry, or surface to the user.
 */
export async function ask(
  query: SLMQuery,
  opts: OrchestratorOptions = {},
): Promise<SLMResponse> {
  const offline = shouldUseOffline(opts);

  if (offline) {
    return slmComplete(query);
  }

  // TODO T-1.4.1: wire to existing geminiAdapter / askGuardian endpoint.
  //   const adapter = getAiAdapter();
  //   const r = await adapter.generate({ prompt: query.prompt, ... });
  //   return { text: r.text, latencyMs: ..., tokensGenerated: ..., backend: 'wasm-simd' };
  //
  // For now both paths fall through to the SLM so the orchestrator
  // surface stays testable without a network mock.
  return slmComplete(query);
}
