import { createSplatValidator } from './bridge.ts';

/** One capture per worker. Only transfer bytes back if validation succeeds. */
globalThis.addEventListener('message', async ({ data }: MessageEvent<unknown>) => {
  if (typeof data !== 'object' || data === null || !('bytes' in data) || !('module' in data) ||
      !(data.bytes instanceof ArrayBuffer) || !(data.module instanceof WebAssembly.Module)) {
    globalThis.postMessage({ ok: false, reason: 'engine_error' });
    return;
  }
  const { bytes, module } = data;
  try {
    const validate = await createSplatValidator(module);
    const result = validate(new Uint8Array(bytes));
    if (result.ok) {
      globalThis.postMessage({ ...result, bytes }, { transfer: [bytes] });
    } else {
      globalThis.postMessage(result);
    }
  } catch {
    globalThis.postMessage({ ok: false, reason: 'engine_error' });
  }
}, { once: true });
