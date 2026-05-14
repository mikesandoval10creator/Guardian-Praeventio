/**
 * SLM Runtime Worker — production entrypoint.
 *
 * Este archivo NO se importa desde código de aplicación. Vite lo
 * detecta cuando el proxy hace:
 *
 *   new Worker(
 *     new URL('./slmRuntimeWorker.ts', import.meta.url),
 *     { type: 'module' }
 *   )
 *
 * y lo emite como un chunk separado. El bundler garantiza que TODO
 * el grafo de imports de este archivo (slmRuntime, onnxruntime-web,
 * cache, integrity guard, etc.) vive en el chunk del worker —
 * NUNCA entra al main bundle.
 *
 * Responsabilidad mínima:
 *   1. Instanciar `SlmRuntimeWorkerCore` con `dispatch = self.postMessage`
 *   2. Cablear `self.addEventListener('message', ...)` al `core.onMessage`
 *   3. Logging de errores graves a `globalThis.console.error` (NO al main —
 *      el protocolo es exclusivamente mensajes estructurados)
 *
 * Toda la lógica testeable vive en `slmRuntimeWorkerCore.ts`. Este
 * archivo es deliberadamente trivial para que NO necesite tests
 * propios (no hay branching ni state — solo glue).
 *
 * IMPORTANT: No top-level `await` ni código que pueda lanzar antes
 * del listener. Si la inicialización rompe, NO podemos comunicarlo
 * al main (no hay listener todavía).
 */

/// <reference lib="webworker" />

import { createWorkerCore } from './slmRuntimeWorkerCore';
import type { WorkerResponse } from './slmRuntimeWorkerProtocol';

// `self` tiene tipo `DedicatedWorkerGlobalScope` en este contexto.
// El triple-slash directive arriba importa los lib types del worker.
declare const self: DedicatedWorkerGlobalScope;

function dispatch(response: WorkerResponse): void {
  try {
    self.postMessage(response);
  } catch (err) {
    // postMessage puede fallar si el response no es estructuralmente
    // clonable (algún CryptoKey/Function se coló por bug). Loggeamos
    // al console del worker — el main lo verá si tiene devtools
    // attached al worker.
    globalThis.console.error('slmRuntimeWorker: postMessage failed', err);
  }
}

const core = createWorkerCore(dispatch);

self.addEventListener('message', (event: MessageEvent) => {
  void core.onMessage(event.data).catch((err) => {
    globalThis.console.error('slmRuntimeWorker: onMessage threw', err);
  });
});

// Log a worker boot — útil para debug en chrome://inspect.
globalThis.console.info('slmRuntimeWorker: ready');

// Algunos bundlers requieren un export para no tree-shake el archivo.
// `undefined` es estructuralmente válido y no introduce side effects
// más allá del addEventListener arriba.
export {};
