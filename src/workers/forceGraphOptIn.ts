import { createForceGraphLayoutClient } from './forceGraphClient';
import { createForceGraphWasmWorker } from './forceGraphWasmClient';

/** Release configuration only; a URL parameter cannot select an artifact. */
export function createOptInForceGraphClient(digest: unknown) {
  if (typeof digest !== 'string' || digest.length !== 64 || !/^[a-f0-9]+$/.test(digest)) return undefined;
  const integrity = `sha256-${btoa(String.fromCharCode(...(digest.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))))}`;
  return createForceGraphLayoutClient({
    wasmEnabled: true,
    engineVersions: { wasm: digest },
    prepareWasmWorker: async (signal) => {
      const response = await fetch(`/assets/force-graph-layout-${digest}.wasm`, {
        mode: 'same-origin', credentials: 'omit', redirect: 'error', integrity, signal,
      });
      if (!response.ok) throw new Error('layout_module_unavailable');
      const module = await WebAssembly.compileStreaming(response);
      return () => createForceGraphWasmWorker(module);
    },
  });
}
