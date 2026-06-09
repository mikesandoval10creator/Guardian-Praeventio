/**
 * Tokenizer abstraction for the on-device SLM
 * (Brecha B — Sprint 23 Bucket DD).
 *
 * Wraps `@huggingface/transformers`'s `AutoTokenizer` behind a narrow
 * adapter interface so:
 *   1. The generation loop in `onnxAdapter.ts` only sees three methods
 *      (`encode`, `decode`, `applyChatTemplate`) — keeping the dynamic
 *      import surface tiny.
 *   2. Unit tests can swap a fake tokenizer in without depending on
 *      the 30 MB transformers.js bundle.
 *   3. We can later swap the implementation for a WASM-native
 *      tokenizer (e.g. `tokenizers-wasm`) without touching callers.
 *
 * Lazy import: `@huggingface/transformers` is dynamically imported on
 * first call so the runtime cost (and bundle weight, when code-split)
 * is only paid when the SLM path actually runs. The resolved tokenizer
 * is cached per model name for the lifetime of the page so subsequent
 * `loadTokenizer()` calls are zero-cost.
 */

/**
 * Caller-facing tokenizer surface. Deliberately smaller than the
 * upstream `PreTrainedTokenizer` — we only expose what the generation
 * loop needs.
 */
export interface SlmTokenizer {
  /**
   * Tokenize a prompt string. Returns input IDs plus a same-length
   * attention mask (all-1s; padding lives in the runtime, not here).
   */
  encode(text: string): Promise<{ inputIds: number[]; attentionMask: number[] }>;

  /**
   * Detokenize a sequence of token IDs back to a string. Used both for
   * the per-token streaming hook (`opts.onToken`) and the final
   * full-response decode.
   */
  decode(tokenIds: number[]): Promise<string>;

  /**
   * Apply the model's chat template to a list of role-tagged messages,
   * producing the prompt string we feed to `encode()`. The template
   * is owned by the tokenizer config (e.g. TinyLlama's `<|user|>` /
   * `<|assistant|>` markers), so we don't hardcode it here.
   */
  applyChatTemplate(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string>;
}

/**
 * Module-level tokenizer cache. `Map<modelName, Promise<SlmTokenizer>>`
 * so concurrent callers dedupe to one resolution rather than racing the
 * dynamic import.
 */
const tokenizerCache = new Map<string, Promise<SlmTokenizer>>();

/**
 * Default model name. Matches the TinyLlama checkpoint we ship in
 * `public/models/slm/tinyllama-1.1b-int8.onnx`. The `Xenova/` prefix
 * tells transformers.js to fetch the tokenizer config from the
 * Xenova HF mirror (which serves the JSON files with the
 * cross-origin headers the runtime expects).
 */
export const DEFAULT_TOKENIZER_NAME = 'Xenova/TinyLlama-1.1B-Chat-v1.0';

/**
 * Test seam — replace this to inject a fake `AutoTokenizer` without
 * monkey-patching the dynamic import. Production code never sets it.
 *
 * The factory returns the raw upstream tokenizer; we wrap it in the
 * narrower `SlmTokenizer` shape inside `loadTokenizer`.
 */
export interface TokenizerFactoryOverride {
  fromPretrained: (modelName: string) => Promise<UpstreamTokenizerLike>;
}

let factoryOverride: TokenizerFactoryOverride | null = null;

/**
 * Test-only — install a fake AutoTokenizer factory. Must be called
 * before `loadTokenizer()` for the override to take effect on a given
 * model name (the cache holds the first resolved instance).
 */
export function __setTokenizerFactoryForTests(
  override: TokenizerFactoryOverride | null,
): void {
  factoryOverride = override;
  // Drop the cache so the next loadTokenizer() picks up the override.
  tokenizerCache.clear();
}

/**
 * Minimal slice of the upstream `PreTrainedTokenizer` we actually call.
 * Declared explicitly so tests don't have to fake the entire
 * transformers.js surface (~hundreds of methods).
 *
 * The real upstream returns a `Tensor` from `apply_chat_template` when
 * `tokenize: true`; we always call it with `tokenize: false` so we
 * always receive a string. Same for `encode` — we use the sync
 * variant which yields a `number[]`.
 */
export interface UpstreamTokenizerLike {
  encode(text: string): number[];
  decode(ids: number[], opts?: { skip_special_tokens?: boolean }): string;
  apply_chat_template(
    messages: { role: string; content: string }[],
    opts: { tokenize: false; add_generation_prompt?: boolean },
  ): string;
}

/**
 * Load (and cache) a tokenizer for the given model name.
 *
 * Idempotent + concurrent-safe: many parallel callers share one
 * dynamic-import + `from_pretrained` resolution.
 */
export async function loadTokenizer(
  modelName: string = DEFAULT_TOKENIZER_NAME,
): Promise<SlmTokenizer> {
  const existing = tokenizerCache.get(modelName);
  if (existing) return existing;

  const promise = (async () => {
    const upstream = await resolveUpstream(modelName);
    return wrap(upstream);
  })();

  tokenizerCache.set(modelName, promise);
  // If the resolution fails, clear the cache entry so the caller can
  // retry without being permanently stuck on a rejected promise.
  promise.catch(() => tokenizerCache.delete(modelName));
  return promise;
}

async function resolveUpstream(modelName: string): Promise<UpstreamTokenizerLike> {
  if (factoryOverride) return factoryOverride.fromPretrained(modelName);

  // Dynamic import keeps transformers.js out of the initial bundle.
  const mod = (await import('@huggingface/transformers')) as unknown as {
    AutoTokenizer: {
      from_pretrained(name: string): Promise<UpstreamTokenizerLike>;
    };
  };
  return mod.AutoTokenizer.from_pretrained(modelName);
}

function wrap(upstream: UpstreamTokenizerLike): SlmTokenizer {
  return {
    async encode(text: string) {
      const ids = upstream.encode(text) as Array<number | bigint>;
      // The runtime needs `number[]`; transformers.js may return a
      // `bigint`-typed array on some checkpoints, so coerce defensively.
      const inputIds: number[] = ids.map((v) =>
        typeof v === 'bigint' ? Number(v) : v,
      );
      const attentionMask = new Array<number>(inputIds.length).fill(1);
      return { inputIds, attentionMask };
    },
    async decode(tokenIds: number[]) {
      // skip_special_tokens=true so we don't bleed `<|user|>` /
      // `<|assistant|>` markers into the streamed text the user sees.
      return upstream.decode(tokenIds, { skip_special_tokens: true });
    },
    async applyChatTemplate(messages) {
      // add_generation_prompt=true appends the `<|assistant|>` cue so
      // the model knows it's its turn to speak.
      return upstream.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true,
      });
    },
  };
}

/**
 * Test-only — drop the cache so a fresh override is picked up.
 */
export function __resetTokenizerCacheForTests(): void {
  tokenizerCache.clear();
}
