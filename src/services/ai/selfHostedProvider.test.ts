// Unit tests for the self-hosted OpenAI-compatible client.
//
// Contract under test:
//   • env → config parsing (absent ⇒ null ⇒ feature OFF, never fake),
//   • request shape against /v1/chat/completions (messages, auth header,
//     response_format on jsonMode + 400-retry without it),
//   • timeout via AbortController → typed 'selfhosted_timeout',
//   • error taxonomy with NO internals (endpoint/api key) in messages,
//   • tolerant JSON extraction (fences, prose-wrapped, balanced braces).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSelfHostedConfig,
  selfHostedChat,
  extractJsonText,
  parseSelfHostedJson,
  SelfHostedProviderError,
  isSelfHostedProviderError,
  DEFAULT_SELFHOSTED_TIMEOUT_MS,
  type SelfHostedConfig,
} from './selfHostedProvider.js';

const ENV_KEYS = [
  'AI_SELFHOSTED_BASE_URL',
  'AI_SELFHOSTED_API_KEY',
  'AI_SELFHOSTED_MODEL',
  'AI_SELFHOSTED_TIMEOUT_MS',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.useRealTimers();
});

const CONFIG: SelfHostedConfig = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'mimo-7b',
  timeoutMs: 5_000,
};

function okFetch(content: string, extra: Record<string, unknown> = {}) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
        ...extra,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// getSelfHostedConfig — env contract
// ─────────────────────────────────────────────────────────────────────────────

describe('getSelfHostedConfig', () => {
  it('returns null when AI_SELFHOSTED_BASE_URL is absent (feature OFF)', () => {
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()).toBeNull();
  });

  it('returns null when AI_SELFHOSTED_MODEL is absent (no fabricated default)', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434';
    expect(getSelfHostedConfig()).toBeNull();
  });

  it('returns null for a non-http(s) base URL', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'ftp://broken';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()).toBeNull();
  });

  it('treats whitespace-only values as unset', () => {
    process.env.AI_SELFHOSTED_BASE_URL = '   ';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()).toBeNull();
  });

  it('normalizes the base URL: trailing slash stripped, /v1 appended when missing', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434/';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()?.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('keeps an explicit /v1 suffix as-is (vLLM-style URL)', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://vllm.internal:8000/v1';
    process.env.AI_SELFHOSTED_MODEL = 'XiaomiMiMo/MiMo-7B-RL';
    expect(getSelfHostedConfig()?.baseUrl).toBe('http://vllm.internal:8000/v1');
  });

  it('defaults the timeout and accepts a numeric override', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()?.timeoutMs).toBe(DEFAULT_SELFHOSTED_TIMEOUT_MS);
    process.env.AI_SELFHOSTED_TIMEOUT_MS = '90000';
    expect(getSelfHostedConfig()?.timeoutMs).toBe(90_000);
    process.env.AI_SELFHOSTED_TIMEOUT_MS = 'not-a-number';
    expect(getSelfHostedConfig()?.timeoutMs).toBe(DEFAULT_SELFHOSTED_TIMEOUT_MS);
  });

  it('apiKey is optional (Ollama) and trimmed when present', () => {
    process.env.AI_SELFHOSTED_BASE_URL = 'http://localhost:11434';
    process.env.AI_SELFHOSTED_MODEL = 'mimo-7b';
    expect(getSelfHostedConfig()?.apiKey).toBeUndefined();
    process.env.AI_SELFHOSTED_API_KEY = '  sk-local ';
    expect(getSelfHostedConfig()?.apiKey).toBe('sk-local');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selfHostedChat — request shape + error taxonomy
// ─────────────────────────────────────────────────────────────────────────────

describe('selfHostedChat', () => {
  it('throws typed selfhosted_not_configured when the feature is OFF', async () => {
    await expect(selfHostedChat({ prompt: 'hola' }, { config: null })).rejects.toMatchObject({
      name: 'SelfHostedProviderError',
      code: 'selfhosted_not_configured',
    });
  });

  it('POSTs the OpenAI chat-completions shape (system + history + user)', async () => {
    const fetchImpl = okFetch('respuesta');
    const res = await selfHostedChat(
      {
        prompt: 'pregunta final',
        systemInstruction: 'Eres El Guardián.',
        history: [
          { role: 'user', content: 'turno 1' },
          { role: 'assistant', content: 'respuesta 1' },
        ],
        temperature: 0.2,
        maxOutputTokens: 256,
      },
      { config: CONFIG, fetchImpl },
    );

    expect(res.text).toBe('respuesta');
    expect(res.model).toBe('mimo-7b');
    expect(res.usage).toEqual({ promptTokens: 12, outputTokens: 34 });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'mimo-7b',
      stream: false,
      temperature: 0.2,
      max_tokens: 256,
      messages: [
        { role: 'system', content: 'Eres El Guardián.' },
        { role: 'user', content: 'turno 1' },
        { role: 'assistant', content: 'respuesta 1' },
        { role: 'user', content: 'pregunta final' },
      ],
    });
    // No jsonMode ⇒ no response_format; no apiKey ⇒ no Authorization header.
    expect(body.response_format).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends a Bearer Authorization header when apiKey is configured', async () => {
    const fetchImpl = okFetch('ok');
    await selfHostedChat(
      { prompt: 'q' },
      { config: { ...CONFIG, apiKey: 'sk-local' }, fetchImpl },
    );
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-local');
  });

  it('jsonMode sends response_format json_object', async () => {
    const fetchImpl = okFetch('{"ok":true}');
    await selfHostedChat({ prompt: 'q', jsonMode: true }, { config: CONFIG, fetchImpl });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' });
  });

  it('jsonMode + HTTP 400 retries ONCE without response_format (servers that do not advertise it)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      calls.push(body);
      if (body.response_format) return new Response('bad request', { status: 400 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const res = await selfHostedChat({ prompt: 'q', jsonMode: true }, { config: CONFIG, fetchImpl });
    expect(res.text).toBe('{"ok":1}');
    expect(calls).toHaveLength(2);
    expect(calls[0].response_format).toEqual({ type: 'json_object' });
    expect(calls[1].response_format).toBeUndefined();
  });

  it('non-2xx → typed selfhosted_http_error carrying the status, message leaks nothing', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('Internal: /etc/secrets exploded at http://localhost:11434', { status: 503 }),
    ) as unknown as typeof fetch;
    const err = await selfHostedChat({ prompt: 'q' }, { config: CONFIG, fetchImpl }).catch(
      (e) => e,
    );
    expect(isSelfHostedProviderError(err)).toBe(true);
    expect(err.code).toBe('selfhosted_http_error');
    expect(err.status).toBe(503);
    // Convention #8: nothing about the endpoint or upstream body in the message.
    expect(err.message).not.toContain('11434');
    expect(err.message).not.toContain('localhost');
    expect(err.message).not.toContain('secrets');
  });

  it('network failure → typed selfhosted_unreachable, no endpoint in message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
    }) as unknown as typeof fetch;
    const err = await selfHostedChat({ prompt: 'q' }, { config: CONFIG, fetchImpl }).catch(
      (e) => e,
    );
    expect(err.code).toBe('selfhosted_unreachable');
    expect(err.message).not.toContain('11434');
  });

  it('timeout aborts the request → typed selfhosted_timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    ) as unknown as typeof fetch;

    const pending = selfHostedChat(
      { prompt: 'q' },
      { config: { ...CONFIG, timeoutMs: 1_000 }, fetchImpl },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: 'selfhosted_timeout' });
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('body without choices[0].message.content (string) → typed selfhosted_bad_response', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      selfHostedChat({ prompt: 'q' }, { config: CONFIG, fetchImpl }),
    ).rejects.toMatchObject({ code: 'selfhosted_bad_response' });
  });

  it('non-JSON 200 body → typed selfhosted_bad_response (never a raw SyntaxError)', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>proxy</html>', { status: 200 })) as
      unknown as typeof fetch;
    const err = await selfHostedChat({ prompt: 'q' }, { config: CONFIG, fetchImpl }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SelfHostedProviderError);
    expect(err.code).toBe('selfhosted_bad_response');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tolerant JSON extraction — small models wrap JSON in prose/fences
// ─────────────────────────────────────────────────────────────────────────────

describe('extractJsonText / parseSelfHostedJson', () => {
  it('parses clean JSON as-is', () => {
    expect(parseSelfHostedJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(parseSelfHostedJson('```json\n{"riesgo":"alto"}\n```')).toEqual({ riesgo: 'alto' });
  });

  it('extracts the first balanced object out of prose', () => {
    const raw = 'Claro, aquí está el análisis solicitado: {"score": 7, "nota": "usa {llaves}"} espero que sirva.';
    expect(parseSelfHostedJson(raw)).toEqual({ score: 7, nota: 'usa {llaves}' });
  });

  it('handles braces inside strings and escaped quotes', () => {
    const raw = 'res: {"msg": "dijo \\"hola {amigo}\\" ayer", "n": 2} fin';
    expect(parseSelfHostedJson(raw)).toEqual({ msg: 'dijo "hola {amigo}" ayer', n: 2 });
  });

  it('extracts arrays too', () => {
    expect(parseSelfHostedJson('Resultado: [1,2,3] listo')).toEqual([1, 2, 3]);
  });

  it('returns null / throws typed error on unparseable text (rule-#5 seam)', () => {
    expect(extractJsonText('no hay json aquí')).toBeNull();
    expect(extractJsonText('{rotos: sin cerrar')).toBeNull();
    const err = (() => {
      try {
        parseSelfHostedJson('texto plano sin json');
        return null;
      } catch (e) {
        return e as SelfHostedProviderError;
      }
    })();
    expect(err?.code).toBe('selfhosted_bad_response');
  });
});
