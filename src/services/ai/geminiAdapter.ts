/**
 * Gemini consumer-API adapter — the default + the only fully-wired adapter
 * in this round.
 *
 * This is intentionally a thin wrapper around the same `@google/genai` SDK
 * that today is used directly inside `src/services/geminiBackend.ts`. The
 * existing call shape there is:
 *
 *   const ai = new GoogleGenAI({ apiKey: API_KEY });
 *   const response = await ai.models.generateContent({
 *     model: 'gemini-3-flash-preview',
 *     contents: '...prompt...',
 *     config: { responseMimeType, temperature, ... }
 *   });
 *   const text = response.text;
 *
 * We mirror that shape exactly so migrating an existing call site is a
 * trivial textual swap (see VERTEX_MIGRATION.md §4 — "Migration of
 * geminiBackend.ts").
 *
 * NOTE: we do NOT touch `geminiBackend.ts` in this round. That file is
 * 2664 LOC and will be migrated call-site-by-call-site in a later round.
 * This adapter is plug-and-play — call sites opt in by switching to
 * `getAiAdapter().generate(...)` at their own pace.
 */

import { GoogleGenAI } from '@google/genai';
import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
} from './aiAdapter.ts';

/**
 * Region label for the consumer endpoint. Google routes consumer Gemini
 * traffic out of `us-central1` today — this is the data-residency truth
 * we surface to telemetry and to the (future) consent banner. If Google
 * relocates consumer traffic, update this; it's a label, not a routing
 * directive.
 */
const GEMINI_CONSUMER_REGION = 'us-central1';

/**
 * Wraps `@google/genai` `GoogleGenAI` behind the narrow `AiAdapter` contract.
 *
 * Lifecycle: the SDK client is constructed lazily in the constructor only
 * when an API key is present. Without a key the adapter is `isAvailable=false`
 * and any `generate` call throws a clean configuration error. We do NOT
 * silently no-op in that case — the existing `geminiBackend.ts` call sites
 * also throw "GEMINI_API_KEY is not configured", and we preserve that
 * behaviour.
 */
class GeminiConsumerAdapter implements AiAdapter {
  readonly name: AiProvider = 'gemini-consumer';
  readonly region: string = GEMINI_CONSUMER_REGION;
  /** Cached client built on first use. */
  private client: GoogleGenAI | null = null;
  /** Cached api key the client was built against; used to invalidate. */
  private builtForKey: string | null = null;

  /**
   * Re-reads `GEMINI_API_KEY` on every access. This costs essentially
   * nothing (a property read) and means the facade can answer "is this
   * adapter currently usable?" against live env. The KMS adapter pins
   * its key at construction time because KMS resource names should not
   * change mid-process; AI keys can rotate via secret manager refresh,
   * so we re-check.
   */
  get isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  /** Build (or rebuild on key change) the underlying `@google/genai` client. */
  private getClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    if (!apiKey) {
      this.client = null;
      this.builtForKey = null;
      return null;
    }
    if (!this.client || this.builtForKey !== apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.builtForKey = apiKey;
    }
    return this.client;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const client = this.getClient();
    if (!client) {
      throw new Error(
        'geminiAdapter.generate: GEMINI_API_KEY is not configured. ' +
          'Set GEMINI_API_KEY in the environment, or select a different adapter via AI_ADAPTER.',
      );
    }

    // Mirrors the call shape used throughout `geminiBackend.ts`. The SDK
    // accepts either a plain string or a structured `contents` array; we
    // stick with the structured form so a future multi-turn extension is
    // a small change.
    const result = await client.models.generateContent({
      model: request.model,
      contents: request.prompt,
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        responseMimeType: request.responseMimeType,
        systemInstruction: request.systemInstruction,
      },
    });

    // The SDK exposes `result.text` as a string getter on success. Token
    // counts come from `usageMetadata` and are best-effort (the consumer
    // endpoint sometimes omits them on streaming, but we don't stream here).
    const candidates = (result as unknown as {
      candidates?: Array<{ finishReason?: string }>;
    }).candidates;
    const usageMetadata = (result as unknown as {
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }).usageMetadata;

    return {
      text: result.text ?? '',
      finishReason: candidates?.[0]?.finishReason,
      usage: {
        promptTokens: usageMetadata?.promptTokenCount,
        outputTokens: usageMetadata?.candidatesTokenCount,
      },
      provider: 'gemini-consumer',
    };
  }
}

/**
 * Singleton instance. The constructor reads `GEMINI_API_KEY` at module load
 * time, so changing the env var after import will NOT flip `isAvailable`.
 * Tests that need to toggle availability instantiate a new adapter directly
 * via the exported class (re-exported below for testability).
 */
export const geminiAdapter: AiAdapter = new GeminiConsumerAdapter();

// Re-exported for tests that want to construct a fresh instance after
// mutating `process.env.GEMINI_API_KEY`. Not part of the public surface.
export { GeminiConsumerAdapter };
