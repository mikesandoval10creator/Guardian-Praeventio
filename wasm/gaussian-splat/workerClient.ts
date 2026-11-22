type Rejection = 'invalid_length' | 'invalid_geometry' | 'input_limit' | 'engine_error' | 'cancelled' | 'timeout' | 'invalid_timeout';
type Result = { ok: true; count: number; bytes: ArrayBuffer } | { ok: false; reason: Rejection };
type ValidationWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onmessageerror' | 'onerror'>;

function createWorker(): Worker {
  return new Worker(new URL('./validationWorker.ts', import.meta.url), { type: 'module' });
}

/** Takes ownership of the input when it posts to a dedicated worker.
 * timeoutMs must be a positive integer within the shared browser/Node timer range.
 */
export async function validateSplatInWorker(
  module: WebAssembly.Module,
  bytes: ArrayBuffer,
  options: { signal?: AbortSignal; timeoutMs?: number; createWorker?: () => ValidationWorker } = {},
): Promise<Result> {
  const { signal, timeoutMs = 5000 } = options;
  const size = bytes.byteLength;
  if (signal?.aborted) return { ok: false, reason: 'cancelled' };
  if (size > 4 * 1024 * 1024) return { ok: false, reason: 'input_limit' };
  if (!size || size % 32 !== 0) return { ok: false, reason: 'invalid_length' };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1) {
    return { ok: false, reason: 'invalid_timeout' };
  }

  return new Promise((resolve) => {
    let worker: ValidationWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    function finish(result: Result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      resolve(result);
    }
    function cancel() { finish({ ok: false, reason: 'cancelled' }); }
    function fail() { finish({ ok: false, reason: 'engine_error' }); }
    try {
      worker = (options.createWorker ?? createWorker)();
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data === 'object' && data !== null && 'ok' in data) {
          if (data.ok === true && 'bytes' in data && 'count' in data &&
            data.bytes instanceof ArrayBuffer && data.bytes.byteLength === size && data.count === size / 32) {
            finish({ ok: true, count: data.count, bytes: data.bytes });
            return;
          }
          if (data.ok === false && 'reason' in data &&
            (data.reason === 'invalid_geometry' || data.reason === 'invalid_length' || data.reason === 'input_limit')) {
            finish({ ok: false, reason: data.reason });
            return;
          }
        }
        fail();
      };
      worker.onerror = worker.onmessageerror = fail;
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
      worker.postMessage({ module, bytes }, [bytes]);
    } catch { fail(); }
  });
}
