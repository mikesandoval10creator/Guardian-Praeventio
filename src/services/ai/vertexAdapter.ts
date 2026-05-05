/**
 * Vertex AI adapter — real implementation.
 *
 * Round 2 of the AI adapter migration: this file now wires
 * `@google-cloud/vertexai` (the lighter SDK; we deliberately do NOT pull in
 * the full `@google-cloud/aiplatform` PredictionServiceClient since we only
 * need text generation today).
 *
 * Why this adapter exists
 * -----------------------
 * Chilean enterprise tier (Titanio+) buyers are sold a residency promise:
 * their prompt + context never leaves `southamerica-west1` (Santiago). The
 * consumer Gemini endpoint silently routes to `us-central1`. Until this
 * adapter was real, an operator setting `AI_ADAPTER=vertex-ai` got a silent
 * fall-through to `gemini-consumer` (see facade), which broke that promise
 * without a single log line. P1 audit finding H4 — fixed here.
 *
 * Selection
 * ---------
 * `isAvailable` flips to true iff BOTH `VERTEX_PROJECT_ID` and
 * `VERTEX_LOCATION` (or `VERTEX_REGION` for backwards compat with the stub
 * tests) are present in env. The default location, when only the project ID
 * is set, is `southamerica-west1` — the entire reason this adapter exists.
 *
 * Error semantics
 * ---------------
 * Every failure is rethrown as a regular `Error` with a `.code` field set to
 * one of `'TIMEOUT' | 'QUOTA' | 'UPSTREAM'`. Call sites (the facade, retry
 * middleware, billing telemetry) branch on `.code` rather than parsing the
 * SDK's varied error shapes.
 */

import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
} from './aiAdapter.ts';

/**
 * Default Vertex location. `southamerica-west1` is the Santiago region —
 * pinning here is the entire reason this adapter exists. Operators can
 * override via `VERTEX_LOCATION` (e.g. for DR fail-over to `us-central1`,
 * see VERTEX_MIGRATION.md §7).
 */
const DEFAULT_VERTEX_LOCATION = 'southamerica-west1';

/** Default request timeout (ms). Generative calls usually finish in < 15s. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Error codes emitted by `VertexAdapter.generate`. Stable across SDK
 * versions so retry / billing / telemetry layers can branch reliably.
 */
export type VertexErrorCode = 'TIMEOUT' | 'QUOTA' | 'UPSTREAM';

/** Internal: an Error with a typed `code` field. */
interface CodedError extends Error {
  code: VertexErrorCode;
}

/**
 * Coerce any thrown value into a `CodedError`, picking the best `.code`
 * we can infer from the underlying SDK error. The classification rules
 * are intentionally conservative: anything we cannot positively identify
 * as a quota or timeout becomes `'UPSTREAM'`.
 */
function classifyError(err: unknown): CodedError {
  // Already classified — pass through.
  if (err instanceof Error) {
    const maybeCode = (err as unknown as { code?: unknown }).code;
    if (
      typeof maybeCode === 'string' &&
      (maybeCode === 'TIMEOUT' ||
        maybeCode === 'QUOTA' ||
        maybeCode === 'UPSTREAM')
    ) {
      return err as CodedError;
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Quota / rate-limit detection. Vertex returns HTTP 429 for both
  // RPM and per-day token caps; the SDK surfaces these as ClientError
  // with `code: 429` or a message containing "quota"/"rate limit".
  const httpStatus =
    err instanceof Error
      ? (err as { code?: unknown; status?: unknown }).code ??
        (err as { status?: unknown }).status
      : undefined;
  if (
    httpStatus === 429 ||
    httpStatus === '429' ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted')
  ) {
    const e = new Error(`vertexAdapter: quota exceeded — ${message}`) as CodedError;
    e.code = 'QUOTA';
    return e;
  }

  // Timeout detection. We trigger our own timeout via `AbortController`,
  // but the SDK can also emit AbortError / ETIMEDOUT.
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    (err instanceof Error && err.name === 'AbortError')
  ) {
    const e = new Error(`vertexAdapter: request timed out — ${message}`) as CodedError;
    e.code = 'TIMEOUT';
    return e;
  }

  const e = new Error(`vertexAdapter: upstream error — ${message}`) as CodedError;
  e.code = 'UPSTREAM';
  return e;
}

/**
 * Minimal structural type for the slice of `@google-cloud/vertexai` we use.
 * Declared here so the test file can `vi.mock('@google-cloud/vertexai', ...)`
 * without dragging in the real SDK's type surface.
 */
interface VertexGenerativeModel {
  generateContent(request: {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    systemInstruction?: { role: string; parts: Array<{ text: string }> };
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
      responseMimeType?: string;
    };
  }): Promise<{
    response: {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
  }>;
}

interface VertexAIClient {
  preview: {
    getGenerativeModel(opts: { model: string }): VertexGenerativeModel;
  };
  getGenerativeModel(opts: { model: string }): VertexGenerativeModel;
}

interface VertexAIConstructor {
  new (opts: { project: string; location: string }): VertexAIClient;
}

/**
 * Wraps `@google-cloud/vertexai` `VertexAI` behind the narrow `AiAdapter`
 * contract. Lazy-constructs the SDK client on first call so importing this
 * module in environments without GCP credentials is safe (the SDK touches
 * Application Default Credentials only when it issues a request).
 */
class VertexAdapter implements AiAdapter {
  readonly name: AiProvider = 'vertex-ai';
  /**
   * Resolved at construction time so it's stable for the lifetime of the
   * process. Telemetry attribution code can read `adapter.region` without
   * worrying about env mutation between calls.
   */
  readonly region: string;

  /** Project ID resolved at construction time (may be empty if unset). */
  private readonly projectId: string;

  /** Cached SDK client; built on first `generate()` call. */
  private client: VertexAIClient | null = null;

  /** Per-request timeout in milliseconds. */
  private readonly timeoutMs: number;

  constructor() {
    // Backwards compat: the original stub used `VERTEX_REGION`. We keep
    // honouring it but prefer the canonical `VERTEX_LOCATION` (matches
    // the SDK option name).
    this.region =
      process.env.VERTEX_LOCATION ??
      process.env.VERTEX_REGION ??
      DEFAULT_VERTEX_LOCATION;
    this.projectId = process.env.VERTEX_PROJECT_ID ?? '';
    const timeoutRaw = process.env.VERTEX_TIMEOUT_MS;
    const parsed = timeoutRaw !== undefined ? Number(timeoutRaw) : NaN;
    this.timeoutMs =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Adapter is available iff `VERTEX_PROJECT_ID` is set. Location has a
   * sensible default (`southamerica-west1`), so we don't require it — but
   * an unset project means the SDK has nothing to call.
   */
  get isAvailable(): boolean {
    return Boolean(this.projectId);
  }

  /**
   * Build (or rebuild on env change) the underlying `@google-cloud/vertexai`
   * client. Dynamic import keeps the SDK out of the bundle at module-load
   * time — tests and bundlers that don't touch this code path don't pay for it.
   */
  private async getClient(): Promise<VertexAIClient> {
    if (this.client) return this.client;
    if (!this.projectId) {
      throw new Error(
        'vertexAdapter.generate: VERTEX_PROJECT_ID is not set. ' +
          'Set VERTEX_PROJECT_ID (and optionally VERTEX_LOCATION; default ' +
          `'${DEFAULT_VERTEX_LOCATION}') in the environment, or select a ` +
          'different adapter via AI_ADAPTER.',
      );
    }
    // Dynamic import so module-load-time consumers without the SDK in their
    // bundle (frontend, CLI tools) don't pay the cost. Vertex SDK is
    // backend-only — see warning in PR description.
    const mod = (await import('@google-cloud/vertexai')) as unknown as {
      VertexAI: VertexAIConstructor;
    };
    const VertexAICtor = mod.VertexAI;
    this.client = new VertexAICtor({
      project: this.projectId,
      location: this.region,
    });
    return this.client;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.isAvailable) {
      const e = new Error(
        'vertexAdapter.generate: VERTEX_PROJECT_ID is not configured. ' +
          'Set VERTEX_PROJECT_ID (and optionally VERTEX_LOCATION) in the ' +
          'environment to enable Vertex AI in southamerica-west1.',
      ) as CodedError;
      e.code = 'UPSTREAM';
      throw e;
    }

    let client: VertexAIClient;
    try {
      client = await this.getClient();
    } catch (err) {
      throw classifyError(err);
    }

    // Prefer the `preview` namespace when present — that's where the latest
    // Gemini models are exposed in @google-cloud/vertexai 1.x. Fall back to
    // the GA namespace.
    const model = (client.preview ?? client).getGenerativeModel({
      model: request.model,
    });

    // We arm our own timeout via AbortController-style timer; the Vertex SDK
    // does not honour AbortSignal directly, so this is a best-effort race.
    const generatePromise = (async (): Promise<AiGenerateResponse> => {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        systemInstruction: request.systemInstruction
          ? { role: 'system', parts: [{ text: request.systemInstruction }] }
          : undefined,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: request.responseMimeType,
        },
      });
      const candidate = result.response.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return {
        text,
        finishReason: candidate?.finishReason,
        usage: {
          promptTokens: result.response.usageMetadata?.promptTokenCount,
          outputTokens: result.response.usageMetadata?.candidatesTokenCount,
        },
        provider: 'vertex-ai',
      };
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(
          `vertexAdapter: request exceeded ${this.timeoutMs}ms timeout`,
        ) as CodedError;
        e.code = 'TIMEOUT';
        reject(e);
      }, this.timeoutMs);
    });

    try {
      const out = await Promise.race([generatePromise, timeoutPromise]);
      return out;
    } catch (err) {
      throw classifyError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Singleton instance. Safe to import even when no GCP credentials exist —
 * the constructor does not touch the network or load the GCP SDK (the SDK
 * is dynamically imported on first `generate()`).
 */
export const vertexAdapter: AiAdapter = new VertexAdapter();

// Re-export for tests that want a fresh instance after mutating env.
export { VertexAdapter };
