import { createForceGraphLayoutClient } from '../../../../src/workers/forceGraphClient.ts';
import { createForceGraphWasmWorker } from '../../../../src/workers/forceGraphWasmClient.ts';

const input = {
  nodes: [{ id: 'a', x: 0, y: 1 }, { id: 'b', x: 20, y: 3 }],
  links: [{ source: 'a', target: 'b' }], iterations: 60, dim: 2,
};

globalThis.layoutProbe = async (scenario) => {
  const client = createForceGraphLayoutClient({
    wasmEnabled: scenario !== 'off',
    prepareWasmWorker: async (signal) => {
      const path = scenario === 'bad-abi' ? '/empty.wasm'
        : scenario === 'missing' ? '/missing.wasm' : '/engine.wasm';
      const module = await globalThis.WebAssembly.compileStreaming(globalThis.fetch(path, { signal }));
      return () => createForceGraphWasmWorker(module);
    },
  });
  const controller = new globalThis.AbortController();
  const work = client.simulate(input, { signal: controller.signal });
  if (scenario === 'abort') controller.abort();
  try { return await work; }
  catch (error) { return { error: error.name }; }
};
