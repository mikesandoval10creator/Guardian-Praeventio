/**
 * AI adapter facade — single entry point for picking the right provider.
 *
 * Selection rules (in order of preference, most-specific first):
 *
 *   AI_ADAPTER='vertex-ai'        → vertexAdapter if available, else
 *                                   gemini-consumer if available, else noop
 *                                   (caller-driven, see strict mode below)
 *   AI_ADAPTER='gemini-consumer'  → geminiAdapter if available, else noop
 *   AI_ADAPTER='noop'             → noopAdapter (explicit opt-out / debug)
 *   unset / unknown               → gemini-consumer (current default)
 *
 * Tenant-driven LATAM routing
 * ---------------------------
 * `getAiAdapterFor({ dataResidency: 'latam' })` picks vertex-ai if available
 * regardless of `AI_ADAPTER`. This is how the Titanio+ tier residency promise
 * is enforced at call sites that know the tenant context. With strict mode
 * (`AI_RESIDENCY_STRICT=true` or `opts.strict`), an unavailable Vertex
 * THROWS instead of falling back to consumer-Gemini in us-central1 —
 * because for those tenants, "fall back to us-central1" silently breaks
 * the contract sold (audit P1 finding H4).
 *
 * Process-wide LATAM-default routing
 * ----------------------------------
 * `AI_ROUTE_LATAM_TO_VERTEX=true` makes the bare `getAiAdapter()` prefer
 * vertex-ai. Use only when the entire process is dedicated to LATAM
 * traffic; otherwise prefer the per-call `getAiAdapterFor`.
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
  const raw = (process.env.AI_ADAPTER ?? '').toLowerCase();
  const latamDefault =
    (process.env.AI_ROUTE_LATAM_TO_VERTEX ?? '').toLowerCase() === 'true';

  // If no explicit AI_ADAPTER, an env-wide LATAM flag promotes vertex-ai
  // to the preferred adapter. This is how a process dedicated to Chilean
  // traffic flips routing without touching every call site.
  const fallbackDefault: AiProvider = latamDefault
    ? 'vertex-ai'
    : 'gemini-consumer';
  const preferred: AiProvider =
    raw === 'vertex-ai' || raw === 'gemini-consumer' || raw === 'noop'
      ? (raw as AiProvider)
      : fallbackDefault;

  if (preferred === 'noop') {
    return noopAdapter;
  }

  if (preferred === 'vertex-ai') {
    if (vertexAdapter.isAvailable) return vertexAdapter;
    // Fall through to gemini-consumer (silent forward-compat fallback).
    // Tenants with a real residency contract MUST use `getAiAdapterFor`
    // with `strict: true` rather than relying on this path.
    if (geminiAdapter.isAvailable) return geminiAdapter;
    return noopAdapter;
  }

  // preferred === 'gemini-consumer'
  if (geminiAdapter.isAvailable) return geminiAdapter;
  return noopAdapter;
}

/**
 * Tenant-aware adapter selection.
 *
 * Pass the tenant's data-residency requirement (resolved upstream from the
 * billing tier — Titanio+ ⇒ `'latam'`) and this function picks the right
 * adapter. With `strict: true` (or `AI_RESIDENCY_STRICT=true`), a LATAM
 * tenant whose Vertex adapter is unavailable will receive an error rather
 * than a silent fallback to us-central1 — which is what the audit P1
 * finding H4 demanded.
 *
 * The intentional contract:
 *   - dataResidency: 'latam' + vertex available             → vertex-ai
 *   - dataResidency: 'latam' + vertex NOT available, strict → throw
 *   - dataResidency: 'latam' + vertex NOT available, lax    → fall through
 *                                                             to getAiAdapter()
 *   - dataResidency: undefined / 'global' / anything else   → getAiAdapter()
 *
 * The `region` of the returned adapter is the auditable proof: a Titanio
 * tenant whose telemetry shows `region === 'us-central1'` is a contract
 * breach — log loud and page someone.
 */
export interface AiAdapterSelectionOptions {
  /**
   * Tenant data-residency requirement. Resolved from `tier.dataResidency`
   * upstream — today, every Titanio+ tier is `'latam'`. We accept the
   * literal so this function does not need to import the pricing module.
   */
  dataResidency?: 'latam' | 'global';
  /**
   * If true, throw when the residency requirement cannot be honoured.
   * Defaults to the env var `AI_RESIDENCY_STRICT` (= 'true').
   */
  strict?: boolean;
}

export function getAiAdapterFor(opts: AiAdapterSelectionOptions): AiAdapter {
  const strict =
    opts.strict ??
    (process.env.AI_RESIDENCY_STRICT ?? '').toLowerCase() === 'true';

  if (opts.dataResidency === 'latam') {
    if (vertexAdapter.isAvailable) return vertexAdapter;
    if (strict) {
      throw new Error(
        'getAiAdapterFor: tenant requires LATAM data residency but ' +
          'vertex-ai adapter is unavailable. Set VERTEX_PROJECT_ID + ' +
          'VERTEX_LOCATION (default southamerica-west1) or unset ' +
          'AI_RESIDENCY_STRICT to allow consumer-Gemini fallback ' +
          '(NOTE: this routes data to us-central1 and breaks the ' +
          'Titanio+ residency contract).',
      );
    }
    // Lax mode: fall through to the env-wide chooser.
  }
  return getAiAdapter();
}
