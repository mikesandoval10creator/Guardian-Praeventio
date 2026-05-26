/**
 * Online/offline orchestrator for AI inference.
 *
 * Fase 1 (Sprint 20, Bucket Kappa, T-1.4) — wired to the real Gemini
 * backend in T-1.4.1 (Sprint 20 fourth wave, Bucket Xi). Single entry
 * point that decides whether a query should go to the server LLM
 * (`POST /api/ask-guardian`, served by `src/server/routes/gemini.ts`)
 * or to the on-device SLM (`slmAdapter`).
 *
 * Decision rule, in order:
 *   1. `opts.forceOffline === true`  → SLM (debug / tests)
 *   2. `opts.forceOnline === true`   → server-side path
 *   3. `navigator.onLine === false`  → SLM
 *   4. otherwise                     → server-side path
 *
 * The server-side path (`callOnlineBackend`) does ONE fetch against
 * `/api/ask-guardian`, attaches the Firebase ID token when an authed
 * user is available (mirroring `Asesor.tsx` / `AsesorChat.tsx`), and
 * wraps the JSON response into the same `SLMResponse` shape the SLM
 * adapter returns. Any network or non-2xx outcome falls back to the
 * on-device SLM so the caller still gets *some* answer — the orchestrator
 * is the only place that knows about both halves of the system, so it's
 * the only correct place for that fallback.
 *
 * Why we do not import Sentry here: the rest of the SLM namespace is
 * Sentry-instrumented at higher layers (Bucket Mu owns the
 * `withSentryScope` wrappers). Adding a Sentry call inside the
 * orchestrator would double-report the same fetch failure.
 *
 * What this module is deliberately NOT:
 *   - It does NOT enqueue offline sessions — that's `offlineQueue.ts`.
 *   - It does NOT reconcile pending sessions when the network returns —
 *     that's `reconciliation.ts` / `reconciliationRunner.ts`.
 *   - It does NOT touch UI state (toasts, badges) — call sites do that.
 */

import { complete as slmComplete } from './slmAdapter';
import type { SLMQuery, SLMResponse } from './types';

/**
 * Endpoint path. Kept as a constant so tests can spy on `fetch` calls
 * without having to duplicate the literal in two places.
 */
const ASK_GUARDIAN_ENDPOINT = '/api/ask-guardian';

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
 * Issue one POST to `/api/ask-guardian` and translate the JSON shape
 * into an `SLMResponse`.
 *
 * Returns `null` if the call fails (network error, non-2xx, malformed
 * body). The caller is expected to fall back to the SLM in that case.
 *
 * Latency is captured client-side from the call site's perspective —
 * it includes RTT + server time, which is exactly what we want to
 * surface to UI / telemetry. `tokensGenerated` is set to 0 because the
 * /ask-guardian response shape doesn't currently carry that count;
 * leaving it at 0 (rather than guessing from `text.length`) signals
 * "unknown" and matches the documented contract that this field
 * reflects the *actual* number of generated tokens.
 */
async function callOnlineBackend(
  query: SLMQuery,
): Promise<SLMResponse | null> {
  const start = Date.now();
  try {
    // Plan v2 B3 — apiAuthHeaders() inyecta `E2E ...` o `Bearer ...`
    // según MODE. Dynamic import mantiene el módulo import-safe en SSR
    // / unit tests que no bootstrap Firebase (mismo motivo que
    // tryGetIdToken antes; ahora delegado a `lib/apiAuth`).
    const { apiAuthHeaders } = await import('../../lib/apiAuth');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await apiAuthHeaders()),
    };

    const res = await fetch(ASK_GUARDIAN_ENDPOINT, {
      method: 'POST',
      headers,
      // The endpoint accepts `{ query, projectId?, stream?, ... }` —
      // we send only `query` here. `stream:false` is the implicit default
      // server-side and gives us a JSON body to parse below.
      body: JSON.stringify({ query: query.prompt }),
    });

    if (!res.ok) {
      // 4xx (auth, rate limit) and 5xx alike → caller falls back to SLM.
      return null;
    }

    // The server returns `{ response: string, contextUsed?: boolean,
    // envContextUsed?: boolean }` (see src/server/routes/gemini.ts).
    // Some legacy paths under the same endpoint also return `answer` —
    // we honor either shape so a future server tweak doesn't crash us.
    const data = (await res.json()) as {
      response?: string;
      answer?: string;
    };
    const text = data.response ?? data.answer ?? '';
    return {
      text,
      latencyMs: Date.now() - start,
      tokensGenerated: 0,
      backend: 'gemini',
    };
  } catch {
    // Network error, abort, JSON parse failure, etc. — caller falls
    // back to the SLM. We deliberately swallow the underlying error
    // here: the orchestrator's contract is "always resolve with an
    // SLMResponse", and the SLM fallback is the better signal than a
    // thrown network error.
    return null;
  }
}

/**
 * Run a single inference call, choosing online or offline transparently.
 *
 * The return type is `SLMResponse` for both paths so call sites have a
 * uniform shape to depend on; the online path wraps the Gemini response
 * into the same shape with `backend: 'gemini'`.
 *
 * If the online path is selected but the fetch fails for any reason
 * (network error, 4xx/5xx, malformed JSON), the orchestrator transparently
 * falls back to the on-device SLM so the caller always gets a usable
 * answer. The offline path never falls back online — by definition it's
 * the path you take when the network is gone.
 */
export async function ask(
  query: SLMQuery,
  opts: OrchestratorOptions = {},
): Promise<SLMResponse> {
  const offline = shouldUseOffline(opts);

  if (offline) {
    const resp = await slmComplete(query);
    void trackQueryOffline(resp);
    return resp;
  }

  const remote = await callOnlineBackend(query);
  if (remote !== null) {
    void trackQueryOnline(remote);
    return remote;
  }

  // Online path failed (network / 4xx / 5xx / parse). Fall back to
  // the on-device SLM so the caller still gets an answer. We do NOT
  // enqueue this exchange to the offline queue here — that's the
  // responsibility of the call site that observes `backend !== 'gemini'`
  // and decides the answer needs reconciliation.
  const fallback = await slmComplete(query);
  void trackQueryOffline(fallback);
  return fallback;
}

// Analytics tracking is fire-and-forget at this seam. The orchestrator is
// the only place that knows online vs offline truthfully, so wiring here
// avoids per-call-site duplication. Dynamic import keeps this module's
// existing zero-dep contract under SSR / unit tests.
async function trackQueryOnline(resp: SLMResponse): Promise<void> {
  try {
    const { analytics } = await import('../analytics');
    analytics.track('slm.query.online', {
      query_kind: 'general',
      latency_ms: resp.latencyMs,
      prompt_token_count: 0,
      success: true,
      model_id: resp.backend,
    });
  } catch { /* never break inference flow */ }
}

async function trackQueryOffline(resp: SLMResponse): Promise<void> {
  try {
    const { analytics } = await import('../analytics');
    analytics.track('slm.query.offline', {
      query_kind: 'general',
      latency_ms: resp.latencyMs,
      model_id: resp.backend,
      prompt_token_count: 0,
    });
  } catch { /* never break inference flow */ }
}
