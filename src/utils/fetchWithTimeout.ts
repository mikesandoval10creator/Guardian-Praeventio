// SPDX-License-Identifier: MIT
//
// fetchWithTimeout — general-purpose timeout + abort wrapper around `fetch`.
//
// Why this exists:
//   The Node/browser `fetch` API has no built-in timeout. Without one, a slow
//   or wedged upstream (OAuth, Gemini, OpenWeather, USGS, etc.) can pin a
//   backend worker indefinitely. This util enforces a hard ceiling and also
//   forwards an external `AbortSignal` so callers can cancel from outside.
//
// Use this whenever Praeventio Guard talks to an external HTTP service.
// (For internal Express-to-Express loopbacks the SLA is bounded by our own
// stack and a wrapper is unnecessary.)
//
// Signature shape was chosen to mirror `globalThis.fetch` for drop-in use:
//   const res = await fetchWithTimeout(url, init, { timeoutMs: 10_000 });
//
// On timeout this throws `FetchTimeoutError` so callers can distinguish it
// from network failures and decide whether to retry / surface to the user.

const DEFAULT_TIMEOUT_MS = 10_000;

export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`fetch timeout after ${timeoutMs}ms: ${url}`);
    this.name = 'FetchTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutOptions {
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const external = init.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new FetchTimeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}
