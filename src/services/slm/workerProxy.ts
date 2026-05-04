/**
 * Main-thread proxy for the SLM Web Worker.
 *
 * Fase 1 (Sprint 20, Bucket Epsilon, T-1.2). Wraps the worker created
 * by `./worker/slmWorker.ts` with Comlink so callers on the main
 * thread can invoke `init / generate / dispose` as plain async
 * methods and stay decoupled from the `postMessage` plumbing.
 *
 * The Worker itself is constructed via the canonical Vite recipe
 * (`new Worker(new URL(..., import.meta.url), { type: 'module' })`)
 * so Vite emits the worker as its own chunk and serves it with the
 * correct module-worker headers in dev.
 */

import * as Comlink from 'comlink';

import type { SlmWorkerApi } from './worker/slmWorker';

/**
 * The Comlink-wrapped surface main-thread callers see. All methods
 * are inherently async because they cross the worker boundary, even
 * for the cases where the worker's own implementation returns
 * synchronously.
 */
export type SlmWorkerProxy = Comlink.Remote<SlmWorkerApi> & {
  /**
   * Terminate the underlying Worker. Calls `dispose()` on the worker
   * first, then closes the `MessageChannel` Comlink uses internally
   * (`releaseProxy`) and finally `terminate()`s the Worker. Idempotent.
   */
  terminate(): Promise<void>;
};

/**
 * Construct a fresh worker + Comlink proxy pair.
 *
 * Each call yields a new Worker instance — the main thread is
 * responsible for caching the proxy if it wants to reuse the same
 * loaded model across calls. We do NOT make this a singleton at the
 * module level because tests need to instantiate / tear down workers
 * cleanly between cases, and HMR in dev would otherwise hold a stale
 * worker reference across reloads.
 */
export function createSlmWorker(): SlmWorkerProxy {
  // Vite's preferred form: relative URL + import.meta.url so the
  // bundler can pick up the worker source as a separate entry.
  const worker = new Worker(
    new URL('./worker/slmWorker.ts', import.meta.url),
    { type: 'module' },
  );

  const remote = Comlink.wrap<SlmWorkerApi>(worker);

  // We can't simply `return remote` and add a method — Comlink.Remote
  // is a Proxy that forwards every property access. Wrap it in a
  // plain object that delegates the API surface and adds `terminate`.
  const proxy: SlmWorkerProxy = new Proxy(remote, {
    get(target, prop, receiver) {
      if (prop === 'terminate') {
        return async () => {
          // Best-effort cleanup. If `dispose` rejects (e.g. worker
          // already crashed) we still want to release and terminate.
          try {
            await (target as SlmWorkerApi).dispose();
          } catch {
            // swallow — we're tearing down anyway.
          }
          remote[Comlink.releaseProxy]();
          worker.terminate();
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SlmWorkerProxy;

  return proxy;
}
