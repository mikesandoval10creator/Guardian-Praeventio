/**
 * AI adapter interface — the small swappable boundary between Praeventio's
 * AI call sites (today centralised in `geminiBackend.ts`) and a concrete
 * generative model provider.
 *
 * Why an adapter?
 * ---------------
 * Today every AI call goes through `@google/genai` (Gemini consumer API).
 * That's fine for prototyping but ships with three structural problems for
 * a Chilean SaaS:
 *
 *   1. Data residency: requests hit US-based servers, so personal data
 *      (worker assessments, IPER/REBA inputs) leaves Chile. Ley 19.628 /
 *      21.719 push us toward in-country processing for enterprise clients.
 *   2. Tuning: the consumer endpoint cannot be fine-tuned. Vertex AI in
 *      `southamerica-west1` (Santiago) can — and our safety corpus is the
 *      moat.
 *   3. SLA / billing: consumer endpoint is best-effort with token billing
 *      only; Vertex offers enterprise SLA + committed-use options.
 *
 * Mirroring the KMS scaffolding (`src/services/security/kmsAdapter.ts`),
 * we keep the interface narrow so that:
 *   - tests + dev run on the existing Gemini consumer adapter,
 *   - a `vertexAdapter` stub exists today and gets fleshed out in Round 2
 *     (when `@google-cloud/aiplatform` is installed — see VERTEX_MIGRATION.md),
 *   - a `noopAdapter` lets us disable AI entirely for emergency break-glass
 *     debugging or offline tests.
 *
 * NOTE: Do NOT add streaming/embedding/batch methods here yet. The current
 * `geminiBackend.ts` god-file uses both `generateContent` and `embedContent`,
 * and we'll grow this interface deliberately as call sites migrate.
 */

/**
 * Stable provider identifier. Persisted into telemetry / billing rows so we
 * can later answer "how many tokens went through Vertex Santiago vs the
 * consumer endpoint?" without needing to re-derive it from env at read time.
 * Lowercase, kebab-case.
 */
export type AiProvider = 'gemini-consumer' | 'vertex-ai' | 'noop';

/**
 * Inbound request. Intentionally a small subset of the underlying SDK —
 * enough to cover today's `geminiBackend.ts` call shapes (single-turn prompt
 * + system instruction + JSON-mode toggle + temperature/length knobs).
 *
 * Things deliberately omitted in this round:
 *   - tools / function-calling (geminiBackend uses `FunctionDeclaration` in
 *     a few places; will add `tools?: FunctionDeclaration[]` once those
 *     call sites migrate),
 *   - response schema (Type.OBJECT etc.) — the current call sites work
 *     around this with `responseMimeType: 'application/json'` + JSON.parse,
 *   - streaming (will add `streamGenerate` later),
 *   - multimodal (image / audio parts).
 */
export interface AiGenerateRequest {
  /** Model identifier, e.g. `'gemini-1.5-pro'` or `'gemini-3-flash-preview'`. */
  model: string;
  /** Single-turn user prompt. Multi-turn comes later. */
  prompt: string;
  /** Optional system instruction (prefix-style steering). */
  systemInstruction?: string;
  /** 0 = deterministic; SDK default is ~1. */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxOutputTokens?: number;
  /**
   * `'application/json'` enables JSON mode on Gemini; `'text/plain'` is the
   * default. Keep narrow — adding `'image/*'` etc. is a streaming concern.
   */
  responseMimeType?: 'text/plain' | 'application/json';
}

/**
 * Outbound response. `provider` is the same value as `adapter.name` and is
 * echoed back so a caller that received an `AiAdapter` from `getAiAdapter()`
 * can attribute the result without asking the adapter again (handy when
 * logging from a callback far from the call site).
 */
export interface AiGenerateResponse {
  /** Generated text. Empty string if the model produced no candidates. */
  text: string;
  /** Provider-specific finish reason ('STOP', 'MAX_TOKENS', etc.). */
  finishReason?: string;
  /** Token accounting — provider-best-effort, may be missing fields. */
  usage?: {
    promptTokens?: number;
    outputTokens?: number;
  };
  /** Echo of the producing adapter for downstream telemetry attribution. */
  provider: AiProvider;
}

/**
 * The narrow adapter contract. Mirrors `KmsAdapter` shape: a stable name,
 * an `isAvailable` health bit, and the actual call. `region` is unique to
 * AI — it's the data-residency answer ("where is this prompt processed?")
 * which matters to Chilean enterprise clients.
 */
export interface AiAdapter {
  /** Stable identifier; echoed into `AiGenerateResponse.provider`. */
  readonly name: AiProvider;

  /**
   * `true` when the adapter has the credentials/SDK it needs to actually
   * call. The facade `getAiAdapter()` uses this to decide between a
   * preferred-but-unconfigured adapter and a fallback.
   *
   *   - gemini-consumer: true iff `GEMINI_API_KEY` is set,
   *   - vertex-ai:       always false until Round 2 wires up the SDK
   *                      (`@google-cloud/aiplatform`),
   *   - noop:            always false (you do not "select" the noop adapter
   *                      via preference — it's a graceful fallback).
   */
  readonly isAvailable: boolean;

  /**
   * GCP-style region label for telemetry / data-residency attribution. The
   * consumer Gemini endpoint reports `'us-central1'` because that's where
   * Google routes consumer traffic; Vertex Santiago reports
   * `'southamerica-west1'`. The noop adapter reports `'none'`.
   */
  readonly region: string;

  /**
   * Generate a single completion. Throws on adapter-not-available or
   * provider error — the facade does NOT wrap or swallow.
   */
  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;

  // Future surface (do NOT implement in this round):
  //   streamGenerate(request: AiGenerateRequest): AsyncIterable<AiGenerateResponse>;
  //   embedContent(request: AiEmbedRequest): Promise<AiEmbedResponse>;
  //   batchGenerate(requests: AiGenerateRequest[]): Promise<AiGenerateResponse[]>;
}
