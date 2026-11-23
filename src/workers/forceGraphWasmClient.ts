/** Opt-in factory for a compiled artifact supplied by the trusted build. */
export function createForceGraphWasmWorker(module: WebAssembly.Module): Worker {
  const worker = new Worker(new URL('./forceGraphWasmWorker.ts', import.meta.url), { type: 'module' });
  try {
    worker.postMessage({ type: 'initialize', module });
    return worker;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
