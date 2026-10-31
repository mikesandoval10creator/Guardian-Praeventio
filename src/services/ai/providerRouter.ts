// Praeventio Guard — per-action AI provider routing (self-hosted | Gemini).
//
// WHY: independence from Gemini quotas/membership. Each whitelisted /api/gemini
// action can be routed to a self-hosted OpenAI-compatible endpoint
// (vLLM/Ollama serving MiMo-7B or any open-weights model) while everything
// else keeps the current Gemini path, and the existing resilient ladder
// (RAG → canned, src/services/gemini/geminiSlmFallback.ts) stays the last
// resort. The dispatcher in `src/server/routes/gemini.ts` — the single
// chokepoint for all whitelisted RPCs — consults this module per request.
//
// RESOLUTION (per action name):
//   1. Action listed in AI_PROVIDER_ACTIONS_GEMINI (explicit escape hatch).
//   2. Action listed in AI_PROVIDER_ACTIONS_SELFHOSTED → 'selfhosted'.
//   3. Otherwise AI_PROVIDER_DEFAULT ('gemini' unless set to 'selfhosted').
// Configuration availability never overrides an explicit routing selection.
//
// FAILURE CHAIN for a self-hosted attempt:
//   selfhosted fails/breaker-open/not-configured/unsupported
//     → ONLY AI_SELFHOSTED_FALLBACK_GEMINI='1': explicit legacy opt-in
//     → otherwise: existing deterministic baseline or internal canned tier,
//       else honest 503. No implicit external embedding/RAG fallback.
//
// BREAKER ISOLATION: the self-hosted provider records outcomes on its OWN key
// (`selfhosted`) of the shared keyed breaker (`geminiCircuit`), giving it the
// exact same state machine (5 failures/60s → open, 5 min → half-open probe)
// while keeping state fully isolated from the `gemini` key: a broken local
// model never trips the Gemini breaker, and vice versa. Both keys surface in
// GET /api/admin/circuit-state via `geminiCircuit.snapshot()`.
//
// OBSERVABILITY: every routed call records provider + outcome + latency into
// in-process counters (`getAiProviderStats`, exposed on the admin
// circuit-state endpoint) and a structured log line. No prompt content, no
// PII, no endpoint URL is ever logged here.

import { logger } from '../../utils/logger.js';
import { geminiCircuit } from '../../server/middleware/geminiCircuit.js';
import {
  type SelfHostedConfig,
  getSelfHostedConfig,
  selfHostedChat,
  isSelfHostedProviderError,
} from './selfHostedProvider.js';
import { SELF_HOSTED_ACTION_SPECS, hasSelfHostedActionSpec } from './selfHostedActions.js';

export { hasSelfHostedActionSpec };

export type AiProviderName = 'gemini' | 'selfhosted';

/** Backend-only boundary for resolving provider credentials per tenant. */
export interface LlmCredentialResolver {
  resolve(tenantId: string, provider: AiProviderName): SelfHostedConfig | null;
}

/** Temporary compatibility resolver backed by the existing process environment. */
export const envCredentialResolver: LlmCredentialResolver = {
  resolve(_tenantId, provider) {
    return provider === 'selfhosted' ? getSelfHostedConfig() : null;
  },
};

/** Breaker key for the self-hosted endpoint — isolated from 'gemini'. */
export const SELFHOSTED_CIRCUIT_KEY = 'selfhosted';

const parseActionList = (value: string | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Resolve the provider for an action. Pure read of env at call time (so tests
 * and emergency rollbacks via env work without restarting the module).
 */
export function resolveProvider(
  action: string,
  env: NodeJS.ProcessEnv = process.env,
): AiProviderName {
  // Routing expresses operator intent; incomplete configuration must not
  // silently authorize sending the request to a different provider.
  if (parseActionList(env.AI_PROVIDER_ACTIONS_GEMINI).has(action)) return 'gemini';
  if (parseActionList(env.AI_PROVIDER_ACTIONS_SELFHOSTED).has(action)) return 'selfhosted';
  return env.AI_PROVIDER_DEFAULT?.trim() === 'selfhosted' ? 'selfhosted' : 'gemini';
}

/** Default OFF: switching providers requires an explicit operator opt-in. */
export function selfHostedFallsBackToGemini(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_SELFHOSTED_FALLBACK_GEMINI?.trim() === '1';
}

// ── In-process per-provider call counters ───────────────────────────────────

export interface AiProviderCallStats {
  success: number;
  failure: number;
  totalLatencyMs: number;
}

const emptyStats = (): AiProviderCallStats => ({ success: 0, failure: 0, totalLatencyMs: 0 });

const providerStats: Record<AiProviderName, AiProviderCallStats> = {
  gemini: emptyStats(),
  selfhosted: emptyStats(),
};

/**
 * Count + log one provider call. The log line carries provider/outcome/latency
 * and the action NAME only — never prompt content or endpoint details.
 */
export function recordProviderCall(
  provider: AiProviderName,
  outcome: 'success' | 'failure',
  latencyMs: number,
  action?: string,
  tenantId?: string,
): void {
  const stats = providerStats[provider];
  stats[outcome] += 1;
  stats.totalLatencyMs += Math.max(0, latencyMs);
  logger.info('[ai.provider] call', {
    provider,
    outcome,
    latencyMs,
    action,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
}

export interface AiProviderStatsSnapshot {
  success: number;
  failure: number;
  avgLatencyMs: number;
}

/** Snapshot for ops surfaces (admin circuit-state endpoint). */
export function getAiProviderStats(): Record<AiProviderName, AiProviderStatsSnapshot> {
  const snap = {} as Record<AiProviderName, AiProviderStatsSnapshot>;
  for (const provider of Object.keys(providerStats) as AiProviderName[]) {
    const s = providerStats[provider];
    const calls = s.success + s.failure;
    snap[provider] = {
      success: s.success,
      failure: s.failure,
      avgLatencyMs: calls > 0 ? Math.round(s.totalLatencyMs / calls) : 0,
    };
  }
  return snap;
}

/** Test-only — reset the in-process counters. */
export function __resetProviderStatsForTests(): void {
  providerStats.gemini = emptyStats();
  providerStats.selfhosted = emptyStats();
}

// ── Self-hosted dispatch ─────────────────────────────────────────────────────

export type SelfHostedDispatchResult =
  /** Terminal caller cancellation, never permission for another provider. */
  | { status: 'cancelled' }
  | { status: 'ok'; text: string; latencyMs: number }
  /** Config/spec unavailable — caller applies the explicit fallback policy. */
  | { status: 'skipped'; reason: 'not_configured' | 'unsupported' }
  /** Attempted (or breaker-blocked) — caller runs the fallback chain. */
  | { status: 'failed'; reason: 'circuit_open' | 'empty_response' | 'call_failed' | 'not_configured'; latencyMs?: number };

export interface SelfHostedDispatchOptions {
  signal?: AbortSignal;
  /** Injection point for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Verified tenant identifier supplied by the authenticated route. */
  tenantId?: string;
  /** Credential boundary; defaults to the temporary env-backed resolver. */
  credentialResolver?: LlmCredentialResolver;
}

/**
 * Try to serve a whitelisted action from the self-hosted endpoint. Owns the
 * self-hosted breaker bookkeeping and per-call observability. NEVER throws —
 * the dispatcher's behavior on failure (fallback chain) must not depend on
 * error plumbing.
 * Caller cancellation is terminal, neutral to provider health and is NOT
 * permission to run another provider or fabricate a degraded success.
 */
export async function dispatchSelfHostedAction(
  action: string,
  args: unknown[],
  options: SelfHostedDispatchOptions = {},
): Promise<SelfHostedDispatchResult> {
  const callerSignal = options.signal;
  if (callerSignal?.aborted) return { status: 'cancelled' };
  if (!options.credentialResolver && !getSelfHostedConfig()) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  const spec = SELF_HOSTED_ACTION_SPECS[action];
  if (!spec) {
    // Misconfiguration (action routed to selfhosted without a prompt spec):
    // do not fabricate a prompt; the caller must enforce fallback consent.
    logger.warn('[ai.provider] selfhosted_unsupported_action', { action });
    return { status: 'skipped', reason: 'unsupported' };
  }

  // Defense-in-depth: the route also gates via assertGeminiAllowed(..., key),
  // but direct callers must not bypass an open breaker. `isOpen` returns
  // false in half-open, so recovery probes still flow.
  if (geminiCircuit.isOpen(SELFHOSTED_CIRCUIT_KEY)) {
    logger.info('[ai.provider] selfhosted_circuit_open_skip', { action });
    return { status: 'failed', reason: 'circuit_open' };
  }

  const startedAt = Date.now();
  const tenantId = options.tenantId ?? 'unknown';
  const cancelled = (): SelfHostedDispatchResult => {
    logger.info('[ai.provider] selfhosted_cancelled', { action, latencyMs: Date.now() - startedAt, tenant_id: tenantId });
    return { status: 'cancelled' };
  };
  const credentialResolver = options.credentialResolver ?? envCredentialResolver;
  try {
    const config = credentialResolver.resolve(tenantId, 'selfhosted');
    if (callerSignal?.aborted) return cancelled();
    if (!config) return { status: 'failed', reason: 'not_configured' };
    const request = await spec.build(args);
    if (callerSignal?.aborted) return cancelled();
    const response = await selfHostedChat(request, { fetchImpl: options.fetchImpl, config, signal: callerSignal });
    if (callerSignal?.aborted) return cancelled();
    const latencyMs = Date.now() - startedAt;

    if (!response.text || response.text.trim().length === 0) {
      // An empty completion is an upstream MISS — same contract as the
      // Gemini empty-response path: breaker failure + fallback chain.
      geminiCircuit.recordFailure(SELFHOSTED_CIRCUIT_KEY);
      recordProviderCall('selfhosted', 'failure', latencyMs, action, options.tenantId);
      return { status: 'failed', reason: 'empty_response', latencyMs };
    }

    geminiCircuit.recordSuccess(SELFHOSTED_CIRCUIT_KEY);
    recordProviderCall('selfhosted', 'success', latencyMs, action, options.tenantId);
    return { status: 'ok', text: response.text, latencyMs };
  } catch (err) {
    if (callerSignal?.aborted) return cancelled();
    const latencyMs = Date.now() - startedAt;
    geminiCircuit.recordFailure(SELFHOSTED_CIRCUIT_KEY);
    recordProviderCall('selfhosted', 'failure', latencyMs, action, options.tenantId);
    logger.warn('[ai.provider] selfhosted_call_failed', {
      action,
      latencyMs,
      // Typed code only — never the endpoint, credentials or upstream body.
      code: isSelfHostedProviderError(err) ? err.code : 'unknown_error',
    });
    return { status: 'failed', reason: 'call_failed', latencyMs };
  }
}
