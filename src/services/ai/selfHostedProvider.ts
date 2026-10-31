// Praeventio Guard — self-hosted OpenAI-compatible chat-completions client.
//
// WHY THIS FILE EXISTS
// --------------------
// Every AI action today depends on the Gemini consumer API (quota, billing,
// membership). This client lets any whitelisted action route to a SELF-HOSTED
// open-weights model instead — anything that speaks the OpenAI
// `/v1/chat/completions` dialect works: vLLM or Ollama serving Xiaomi
// MiMo-7B today, Qwen tomorrow. Switching model/server is one env var; no
// code is coupled to a specific vendor or SKU.
//
// DESIGN RULES
// ------------
//   • Zero new dependencies — global `fetch` (Node 20) only.
//   • Config is read from env at CALL time (so tests can mutate process.env
//     and ops can rotate without a redeploy):
//       AI_SELFHOSTED_BASE_URL   e.g. http://localhost:11434/v1 (Ollama) or
//                                http://vllm.internal:8000/v1 (vLLM).
//                                A missing '/v1' suffix is appended.
//       AI_SELFHOSTED_API_KEY    optional Bearer token (Ollama needs none).
//       AI_SELFHOSTED_MODEL      served model name, e.g. 'mimo-7b'. Required.
//       AI_SELFHOSTED_TIMEOUT_MS per-call abort timeout, default 30000.
//     ABSENT base URL or model ⇒ `getSelfHostedConfig()` returns null and the
//     feature is cleanly OFF (anti-stub rule #13): today's Gemini-only
//     behavior is untouched. Nothing here fakes a model response.
//   • Errors are TYPED (`SelfHostedProviderError.code`) and their messages
//     NEVER include the endpoint URL, the API key, prompt content or the
//     upstream body — convention #8 (error bodies must not leak internals)
//     extends to anything a route handler might echo to a client.
//   • Smaller open-weights models often wrap JSON in prose or ``` fences.
//     `extractJsonText` strips fences and finds the first balanced JSON
//     value; `parseSelfHostedJson` throws a typed 'selfhosted_bad_response'
//     so a caller's rule-#5 guard (typed fallback or 502) fires instead of
//     an unguarded SyntaxError.

export const DEFAULT_SELFHOSTED_TIMEOUT_MS = 30_000;

export interface SelfHostedConfig {
  /** Normalized base URL ending in `/v1` (no trailing slash). */
  baseUrl: string;
  /** Optional Bearer token. Ollama runs without one. */
  apiKey?: string;
  /** Served model name (`mimo-7b`, `qwen2.5:7b`, …). */
  model: string;
  /** Per-call abort timeout in ms. */
  timeoutMs: number;
}

export type SelfHostedErrorCode =
  | 'selfhosted_not_configured'
  | 'selfhosted_timeout'
  | 'selfhosted_unreachable'
  | 'selfhosted_http_error'
  | 'selfhosted_bad_response';

/**
 * Typed provider error. `message === code` ON PURPOSE: routes sometimes echo
 * `err.message` in non-prod 5xx bodies, so the message must never carry the
 * endpoint, credentials or upstream payloads.
 */
export class SelfHostedProviderError extends Error {
  readonly code: SelfHostedErrorCode;
  /** HTTP status of the upstream reply, when one was received. */
  readonly status?: number;

  constructor(code: SelfHostedErrorCode, status?: number) {
    super(code);
    this.name = 'SelfHostedProviderError';
    this.code = code;
    this.status = status;
  }
}

export function isSelfHostedProviderError(err: unknown): err is SelfHostedProviderError {
  return (
    err instanceof SelfHostedProviderError ||
    (err as { name?: string } | null)?.name === 'SelfHostedProviderError'
  );
}

/**
 * Read the self-hosted endpoint config from env. Returns `null` (feature OFF)
 * when the base URL or model is absent/blank, or when the base URL is not a
 * plain http(s) URL. `scripts/validate-env.cjs` surfaces misconfigurations at
 * boot; at request time we simply behave as if the feature were off.
 */
export function getSelfHostedConfig(
  env: NodeJS.ProcessEnv = process.env,
): SelfHostedConfig | null {
  const rawBase = env.AI_SELFHOSTED_BASE_URL?.trim();
  const model = env.AI_SELFHOSTED_MODEL?.trim();
  if (!rawBase || !model) return null;
  if (!/^https?:\/\//i.test(rawBase)) return null;

  let baseUrl = rawBase.replace(/\/+$/, '');
  if (!/\/v1$/i.test(baseUrl)) baseUrl = `${baseUrl}/v1`;

  const rawTimeout = Number(env.AI_SELFHOSTED_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.floor(rawTimeout)
      : DEFAULT_SELFHOSTED_TIMEOUT_MS;

  const apiKey = env.AI_SELFHOSTED_API_KEY?.trim();
  return { baseUrl, apiKey: apiKey || undefined, model, timeoutMs };
}

export interface SelfHostedChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Internal call shape — mirrors the subset of the Gemini call shape the
 * whitelisted actions use (system instruction + single-turn prompt + optional
 * history + JSON-mode flag + temperature/length knobs).
 */
export interface SelfHostedChatRequest {
  /** Final user-turn content. */
  prompt: string;
  /** Optional system steering message. */
  systemInstruction?: string;
  /** Prior turns, oldest first; inserted between system and the prompt. */
  history?: SelfHostedChatMessage[];
  /** 0 = deterministic. Omitted ⇒ server default. */
  temperature?: number;
  /** Hard cap on output tokens (`max_tokens`). */
  maxOutputTokens?: number;
  /**
   * Ask for a JSON object. Sent as `response_format: {type:'json_object'}`
   * (vLLM + Ollama both advertise it); if the server rejects it with HTTP
   * 400 we retry once without it and rely on prompt steering + tolerant
   * extraction (`parseSelfHostedJson`) instead.
   */
  jsonMode?: boolean;
}

export interface SelfHostedChatResponse {
  text: string;
  model: string;
  usage?: { promptTokens?: number; outputTokens?: number };
}

export interface SelfHostedCallOptions {
  /** Injection point for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Pre-resolved config (tests). Defaults to `getSelfHostedConfig()`. */
  config?: SelfHostedConfig | null;
}

type OpenAiChatBody = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  stream: false;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
};

function buildBody(
  config: SelfHostedConfig,
  request: SelfHostedChatRequest,
  includeResponseFormat: boolean,
): OpenAiChatBody {
  const messages: OpenAiChatBody['messages'] = [];
  if (request.systemInstruction) {
    messages.push({ role: 'system', content: request.systemInstruction });
  }
  for (const turn of request.history ?? []) {
    messages.push({
      role: turn.role === 'user' ? 'user' : 'assistant',
      content: turn.content,
    });
  }
  messages.push({ role: 'user', content: request.prompt });

  const body: OpenAiChatBody = { model: config.model, messages, stream: false };
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  if (typeof request.maxOutputTokens === 'number') body.max_tokens = request.maxOutputTokens;
  if (request.jsonMode && includeResponseFormat) {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function postChatCompletions(
  config: SelfHostedConfig,
  request: SelfHostedChatRequest,
  fetchImpl: typeof fetch,
  includeResponseFormat: boolean,
  signal: AbortSignal,
): Promise<Response> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(config, request, includeResponseFormat)),
      signal,
    });
  } catch (err) {
    // Abort (our timeout) vs network failure — both map to typed errors with
    // NO endpoint details in the message.
    if (signal.aborted || (err as { name?: string } | null)?.name === 'AbortError') {
      throw new SelfHostedProviderError('selfhosted_timeout');
    }
    throw new SelfHostedProviderError('selfhosted_unreachable');
  }
}

export const MAX_SELFHOSTED_RESPONSE_BYTES = 256 * 1024;

/** Cleanup/read waits share the call deadline even if a custom stream ignores abort. */
function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new SelfHostedProviderError('selfhosted_timeout'));
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Bound decoded response bytes before JSON parsing; never keep an oversized chunk. */
async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('Content-Length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_SELFHOSTED_RESPONSE_BYTES) {
    if (response.body) await withinDeadline(response.body.cancel(), signal);
    throw new SelfHostedProviderError('selfhosted_bad_response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SelfHostedProviderError('selfhosted_bad_response');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  let complete = false;
  try {
    while (true) {
      const { done, value } = await withinDeadline(reader.read(), signal);
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > MAX_SELFHOSTED_RESPONSE_BYTES) throw new SelfHostedProviderError('selfhosted_bad_response');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    try { if (!complete) await withinDeadline(reader.cancel(), signal); } finally { reader.releaseLock(); }
  }
}

/**
 * Single-completion call against the configured OpenAI-compatible endpoint.
 * One deadline covers headers, body consumption, and the optional JSON-mode retry.
 * Throws `SelfHostedProviderError` only — never a raw fetch/JSON/stream error.
 */
export async function selfHostedChat(
  request: SelfHostedChatRequest,
  options: SelfHostedCallOptions = {},
): Promise<SelfHostedChatResponse> {
  const config = options.config !== undefined ? options.config : getSelfHostedConfig();
  if (!config) throw new SelfHostedProviderError('selfhosted_not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    let res = await postChatCompletions(config, request, fetchImpl, true, controller.signal);

    // Tolerant JSON-mode: retry once without response_format, sharing the
    // original deadline. Release the discarded body before reusing the pool.
    if (!res.ok && res.status === 400 && request.jsonMode) {
      if (res.body) await withinDeadline(res.body.cancel(), controller.signal);
      res = await postChatCompletions(config, request, fetchImpl, false, controller.signal);
    }

    if (!res.ok) {
      if (res.body) await withinDeadline(res.body.cancel(), controller.signal);
      throw new SelfHostedProviderError('selfhosted_http_error', res.status);
    }

    const payload: unknown = await readBoundedResponse(res, controller.signal);
    const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new SelfHostedProviderError('selfhosted_bad_response');
    }

    const usage = (payload as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    })?.usage;

    return {
      text: content,
      model: config.model,
      usage: usage
        ? {
            promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
            outputTokens:
              typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
          }
        : undefined,
    };
  } catch (err) {
    if (controller.signal.aborted) throw new SelfHostedProviderError('selfhosted_timeout');
    // Preserve only errors constructed here, not a stream error spoofing the name.
    if (err instanceof SelfHostedProviderError) throw err;
    throw new SelfHostedProviderError('selfhosted_bad_response');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tolerant JSON extraction for small open-weights models that wrap JSON in
 * prose or markdown fences. Strategy:
 *   1. strip ``` / ```json fences,
 *   2. if the whole remainder parses, return it,
 *   3. otherwise scan for the FIRST balanced `{…}` or `[…]` (string- and
 *      escape-aware) and return it iff it parses.
 * Returns the JSON substring, or null when no parseable JSON exists.
 */
export function extractJsonText(raw: string): string | null {
  const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
  if (!cleaned) return null;

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    /* fall through to balanced-scan */
  }

  const start = cleaned.search(/[{[]/);
  if (start === -1) return null;

  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a model completion as JSON with the tolerant extraction above.
 * Throws a typed `selfhosted_bad_response` on failure so the caller's
 * rule-#5 fallback (typed default or 502) fires — never a raw SyntaxError.
 */
export function parseSelfHostedJson<T = unknown>(raw: string): T {
  const jsonText = extractJsonText(raw);
  if (jsonText === null) {
    throw new SelfHostedProviderError('selfhosted_bad_response');
  }
  return JSON.parse(jsonText) as T;
}
