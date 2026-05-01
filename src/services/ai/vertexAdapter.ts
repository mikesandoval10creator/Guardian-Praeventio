/**
 * Vertex AI adapter — STUB ONLY in this round.
 *
 * In Round 2 (see VERTEX_MIGRATION.md §3) this file gets a real
 * `@google-cloud/aiplatform` `PredictionServiceClient` implementation. For
 * now, we ship the typed adapter shape so:
 *
 *   - call sites can pre-emptively switch to `getAiAdapter()` and get full
 *     typecheck coverage of the future Vertex interface,
 *   - the facade selection logic (`getAiAdapter()`) can be tested today,
 *   - the migration runbook has a concrete file path to point at.
 *
 * The stub deliberately does NOT auto-fall-back to the gemini-consumer
 * adapter when `generate` is called. Silent fallback would mean a Chilean
 * enterprise client who configured `AI_ADAPTER=vertex-ai` for data
 * residency reasons would unknowingly start sending data to `us-central1`
 * the moment Vertex hiccups. The facade `getAiAdapter()` handles the
 * fallback decision explicitly via `isAvailable`.
 *
 * Why mirror the KMS scaffolding pattern: see `src/services/security/
 * kmsAdapter.ts` — same lazy-construct, same `isAvailable` gate, same
 * "throw clean error until configured" semantics.
 */

import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
} from './aiAdapter.ts';

/**
 * Default Vertex region. `southamerica-west1` is the Santiago region —
 * pinning here is the entire reason this adapter exists. Operators can
 * override via `VERTEX_REGION` (e.g. for DR fail-over to `us-central1`,
 * see VERTEX_MIGRATION.md §7).
 */
const DEFAULT_VERTEX_REGION = 'southamerica-west1';

class VertexAdapter implements AiAdapter {
  readonly name: AiProvider = 'vertex-ai';
  readonly region: string;

  /**
   * Hard-coded `false` until Round 2 installs `@google-cloud/aiplatform`
   * and wires the real client. The facade therefore never selects this
   * adapter today — but the type contract is honoured, so a call site
   * that imports `vertexAdapter` directly compiles cleanly.
   */
  readonly isAvailable = false;

  constructor() {
    // Region is read eagerly so it's stable for the lifetime of the
    // process. Telemetry attribution code can read `adapter.region`
    // without worrying about env mutation between calls.
    this.region = process.env.VERTEX_REGION ?? DEFAULT_VERTEX_REGION;
  }

  async generate(_request: AiGenerateRequest): Promise<AiGenerateResponse> {
    // Single throw site — keep the message actionable so an operator
    // hitting this in production logs knows exactly what to do next.
    throw new Error(
      'vertexAdapter.generate: not implemented yet. ' +
        'Run `npm install @google-cloud/aiplatform` and follow ' +
        'VERTEX_MIGRATION.md §3 to wire the real SDK. Until then, set ' +
        'AI_ADAPTER=gemini-consumer (or unset it) to use the consumer endpoint.',
    );
  }
}

/**
 * Singleton instance. Safe to import even when no GCP credentials exist —
 * the constructor does not touch the network or load any GCP SDK.
 */
export const vertexAdapter: AiAdapter = new VertexAdapter();

// Re-export for tests that want a fresh instance after mutating
// `process.env.VERTEX_REGION`. Not part of the public surface.
export { VertexAdapter };
