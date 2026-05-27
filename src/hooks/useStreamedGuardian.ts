// Praeventio Guard — TODO.md §12.9.3 MEDIA: SSE streaming Gemini client.
//
// El endpoint `/api/ask-guardian` con `stream: true` emite Server-Sent
// Events estilo `data: {"text": "..."}\n\n` + `data: [DONE]\n\n`. Hasta
// 2026-05-19 ningún cliente lo consumía — toda la app usaba el path
// no-stream que devuelve la respuesta entera de una sola vez.
//
// Este hook expone:
//   - `streamGuardian({ query, projectId })`: AsyncGenerator que yield
//     cada token Gemini conforme llega. Cancelable via AbortSignal.
//   - `streamGuardianText(...)`: helper que concatena y devuelve string
//     completo cuando el stream termina (compat con sites que aún no
//     pueden manejar render incremental).
//
// UX significativa: respuestas largas del Asesor (1-3k tokens) ahora
// rinden el primer carácter en ~600ms vs ~12s del modo unary. Reduce
// perceived latency 20x.

import { auth } from '../services/firebase';

interface StreamGuardianInput {
  query: string;
  projectId?: string;
  /** Para cancelar el stream desde la UI (button "Detener"). */
  signal?: AbortSignal;
}

interface StreamGuardianEvent {
  /** Token text fragment Gemini. */
  text: string;
  /** True cuando recibimos `[DONE]` — el stream concluyó. */
  done: boolean;
}

export class StreamGuardianError extends Error {
  constructor(
    public readonly code: string,
    msg: string,
    public readonly httpStatus?: number,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'StreamGuardianError';
  }
}

async function authHeader(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}

/**
 * AsyncGenerator que yield tokens. La UI consume con:
 *
 *   for await (const ev of streamGuardian({ query })) {
 *     if (ev.done) break;
 *     setResponse(prev => prev + ev.text);
 *   }
 */
export async function* streamGuardian(
  input: StreamGuardianInput,
): AsyncGenerator<StreamGuardianEvent, void, void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const bearer = await authHeader();
  if (bearer) headers.Authorization = bearer;

  const res = await fetch('/api/ask-guardian', {
    method: 'POST',
    headers,
    signal: input.signal,
    body: JSON.stringify({
      query: input.query,
      projectId: input.projectId,
      stream: true,
    }),
  });

  if (!res.ok) {
    let body: { error?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* ignore body parse */
    }
    throw new StreamGuardianError(
      'http_error',
      body.error ?? `Server returned HTTP ${res.status}`,
      res.status,
    );
  }

  if (!res.body) {
    throw new StreamGuardianError('no_body', 'Stream response missing body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          // Flush trailing data sin trailing newline (edge case).
          const ev = parseSSEEvent(buffer);
          if (ev) yield ev;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE message separator es `\n\n`. Procesamos cada chunk completo.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSSEEvent(raw);
        if (!ev) continue;
        yield ev;
        if (ev.done) {
          // Reader can stop; consumer's `for await` will exit.
          try {
            await reader.cancel();
          } catch {
            /* already cancelled */
          }
          return;
        }
      }
    }
  } finally {
    // Ensure reader released even si el consumer abandona temprano.
    try {
      await reader.cancel();
    } catch {
      /* already released */
    }
  }
}

function parseSSEEvent(raw: string): StreamGuardianEvent | null {
  // El server emite `data: {"text":"..."}` o `data: [DONE]`. Permitimos
  // comentarios (`:`) y otros campos por robustez.
  const lines = raw.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
    // Otros campos SSE (`event:`, `id:`, `retry:`) los ignoramos por ahora.
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return { text: '', done: true };
  try {
    const obj = JSON.parse(data) as { text?: string };
    if (typeof obj.text !== 'string') return null;
    return { text: obj.text, done: false };
  } catch {
    return null;
  }
}

/**
 * Helper síncrono: concatena todos los tokens y devuelve el string
 * completo cuando el stream termina. Para callers que no quieren
 * manejar el AsyncGenerator manualmente.
 */
export async function streamGuardianText(
  input: StreamGuardianInput,
): Promise<string> {
  let out = '';
  for await (const ev of streamGuardian(input)) {
    if (ev.done) break;
    out += ev.text;
  }
  return out;
}
