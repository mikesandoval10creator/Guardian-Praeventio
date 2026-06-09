// Praeventio Guard — Phase 5 / Directive #2: server-side Gemini -> degraded fallback.
//
// The on-device SLM (src/services/slm/*) is BROWSER-ONLY: slmAdapter.complete
// spins a Web Worker (new Worker(new URL('./worker/slmWorker.ts', import.meta.url))),
// slmRuntime loads onnxruntime-web (WebGPU/WASM) from the IndexedDB cache, and the
// orchestrator keys off navigator.onLine. None of that exists in the Express
// process (verified: zero imports of src/services/slm under src/server). ADR 0019
// §2 names the SERVER-realizable degraded path explicitly:
// "SLM on-device -> RAG canonico -> respuesta 'canned' con disclaimer". The
// resilientAiOrchestrator already encodes exactly that ladder; here we run the
// SERVER-RUNNABLE tiers (zettelkasten/normative RAG -> canned) so that when a
// Gemini text action returns empty / is unavailable / errors, the worker still
// gets a REAL degraded answer instead of a dry 502.
//
// This is wired ONLY for the representative TEXT actions below (each returns
// `string | undefined`, so `undefined` == "Gemini returned empty"). Structured
// JSON actions are intentionally excluded: their schemas cannot be synthesized
// from canned text without fabricating, and they already have their own typed
// baselines (e.g. baselineEmergencyPlan / GeminiDegradedError). For those the
// honest 502 stands.

import { answer, detectDomain } from '../ai/resilientAiOrchestrator.js';
import type {
  AiDomain,
  AiResponse,
  TierAdapter,
} from '../ai/resilientAiOrchestrator.js';
import { safeNormativeQuery } from '../rag/safeNormativeQuery.js';

/**
 * Per-action descriptor: how to pull the user-facing prompt text out of the
 * positional `args` array the dispatcher forwards, and (optionally) a fixed
 * domain. When `domain` is omitted the orchestrator's keyword `detectDomain`
 * runs over the extracted prompt.
 */
export interface FallbackActionSpec {
  /** Extract the natural-language prompt from the RPC args. Returns '' if none. */
  extractPrompt: (args: unknown[]) => string;
  /** Force a domain; when omitted, detectDomain(prompt) decides. */
  domain?: AiDomain;
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The representative high-value TEXT actions wired end-to-end. All three return
 * `string | undefined` from geminiBackend, so an empty/undefined completion is
 * the canonical "Gemini returned empty" signal.
 *
 *   - getChatResponse(message, context, history?, detailLevel?, domain?)
 *   - getSafetyAdvice(weather)  -> synthesize a prompt from the weather object
 *   - queryBCN(query)           -> normative Q&A, force the 'normative' domain
 */
export const SERVER_SLM_FALLBACK_ACTIONS: Record<string, FallbackActionSpec> = {
  getChatResponse: {
    extractPrompt: (args) => asStr(args[0]),
  },
  queryBCN: {
    extractPrompt: (args) => asStr(args[0]),
    domain: 'normative',
  },
  getSafetyAdvice: {
    // weather = { temp, uv, airQuality? } — build a deterministic prompt so the
    // ladder can route + (if RAG misses) the canned EPP/general advice fires.
    extractPrompt: (args) => {
      const w = (args[0] ?? {}) as { temp?: unknown; uv?: unknown; airQuality?: unknown };
      const t = w.temp ?? 'n/d';
      const uv = w.uv ?? 'n/d';
      const aq = w.airQuality ?? 'n/d';
      return `Consejo de seguridad laboral segun condiciones: temperatura ${t}C, indice UV ${uv}, calidad del aire ${aq}.`;
    },
    domain: 'epp',
  },
};

/** True when this action has a server-side degraded path wired. */
export function hasServerSlmFallback(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(SERVER_SLM_FALLBACK_ACTIONS, action);
}

/**
 * RAG tier adapter (server-runnable). Wraps safeNormativeQuery so a verified
 * normative hit (COSINE >= 0.75, no-hallucination guard) becomes a degraded
 * answer. Returns null on any miss / outage so the orchestrator falls through
 * to the canned tier. Never throws (errors -> null).
 */
export const ragTierAdapter: TierAdapter = async (query) => {
  try {
    const r = await safeNormativeQuery(query.prompt, 3);
    if (r.ok && r.snippet && r.snippet.trim().length > 0) {
      return {
        text: r.snippet,
        confidence: typeof r.bestScore === 'number' ? r.bestScore : 0.75,
        citations: r.matches.map((m) => ({
          kind: 'normative' as const,
          ref: m.title,
          label: m.title,
        })),
      };
    }
    return null;
  } catch {
    // RAG outage -> let the canned tier serve the answer.
    return null;
  }
};

export interface GeminiServerFallbackResult {
  /** The degraded answer text (RAG snippet or canned-by-domain w/ disclaimer). */
  text: string;
  /** Which tier produced it (for telemetry / debug). */
  tier: AiResponse['tier'];
  /** 0..1 quality estimate (high for RAG, low for canned). */
  confidence: number;
}

/**
 * Run the server-side degraded ladder for a wired action. Returns a usable
 * degraded answer, or null if the action is not wired (caller keeps the 502).
 *
 * The ladder is restricted to ['zettelkasten'] (RAG) — if RAG can't verify a
 * match, the orchestrator's built-in last-resort canned tier fires with the
 * FALLBACK_DISCLAIMER prefix. We deliberately do NOT include the 'gemini' tier
 * here: we are already in the path where Gemini failed.
 */
export async function geminiSlmFallback(
  action: string,
  args: unknown[],
): Promise<GeminiServerFallbackResult | null> {
  const spec = SERVER_SLM_FALLBACK_ACTIONS[action];
  if (!spec) return null;

  const prompt = spec.extractPrompt(Array.isArray(args) ? args : []);
  const domain: AiDomain = spec.domain ?? detectDomain(prompt);

  try {
    const resp = await answer(
      { prompt: prompt || ' ', domain },
      { zettelkasten: ragTierAdapter },
      { allowedTiers: ['zettelkasten'], tierTimeoutMs: 3000 },
    );
    // `answer` ALWAYS resolves with a usable text (canned last-resort), so a
    // non-empty result is guaranteed; guard defensively anyway.
    if (resp.text && resp.text.trim().length > 0) {
      return { text: resp.text, tier: resp.tier, confidence: resp.confidence };
    }
    return null;
  } catch {
    // The orchestrator is contractually non-throwing, but if a future change
    // breaks that we must NOT convert the caller's 502 into a 500 crash.
    return null;
  }
}
