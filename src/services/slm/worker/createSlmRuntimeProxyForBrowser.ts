/**
 * Browser factory: construye un `SlmRuntimeWorkerProxy` cableado al
 * worker entry real (`slmRuntimeWorker.ts`).
 *
 * Este archivo es el único punto donde el bundler "ve" el patrón
 * `new Worker(new URL(...), { type: 'module' })`. Si lo movés, el
 * worker chunk no se emite correctamente.
 *
 * Diseño:
 *   - Si `globalThis.Worker` no existe (entorno no-browser, tests
 *     viejos, SSR), tira un error legible ANTES de intentar
 *     construir el Worker — falla rápido en lugar de fallar opaco
 *     dentro del bundler.
 *   - El factory NO carga `slmRuntime` ni `slmRuntimeWorker` en
 *     este chunk — solo el proxy + protocol types (livianos). El
 *     bundler emite el worker como chunk lazy.
 *   - Singleton opcional: si el caller quiere una sola instancia
 *     compartida a lo largo del app lifetime, llama a
 *     `getSharedSlmWorkerProxy()`.
 */

import {
  SlmRuntimeWorkerProxy,
  type WorkerFactory,
} from './slmRuntimeWorkerProxy';

let sharedProxy: SlmRuntimeWorkerProxy | null = null;

/**
 * Construye un Worker apuntando al entry real. Vite emite el
 * worker chunk en build time si encuentra exactamente este patrón
 * (NO se puede mover a una función indirecta).
 *
 * El cast a `unknown` y luego a `WorkerLike` (vía `WorkerFactory`)
 * existe porque el tipo DOM `Worker` declara más métodos que los que
 * nuestro proxy realmente usa (`onmessage` setter, `onmessageerror`,
 * etc.). Reducimos el surface al subset estructural que el proxy
 * espera para que tests con FakeWorker no tengan que implementarlo
 * todo.
 */
const defaultWorkerFactory: WorkerFactory = () => {
  if (typeof Worker === 'undefined') {
    throw new Error(
      'slmRuntimeWorker: Worker API unavailable. Browser too old or SSR context. ' +
        'Use the main-thread `createSlmRuntime()` directly instead.',
    );
  }
  return new Worker(
    new URL('./slmRuntimeWorker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as ReturnType<WorkerFactory>;
};

/**
 * Crea un proxy fresco con el worker real. El caller es responsable
 * de llamar `terminate()` cuando termine.
 */
export function createSlmRuntimeProxyForBrowser(): SlmRuntimeWorkerProxy {
  return new SlmRuntimeWorkerProxy(defaultWorkerFactory);
}

/**
 * Devuelve un proxy compartido (singleton). Útil cuando varios
 * componentes de la UI quieren consultar al SLM y no tiene sentido
 * spawn un Worker dedicado por cada uno. Si el proxy fue terminado,
 * la siguiente llamada crea uno nuevo automáticamente.
 *
 * NOTA: en producción quieres usar singleton; en tests
 * (que importan este archivo) querés `createSlmRuntimeProxyForBrowser`
 * directo y pasar un workerFactory mock.
 */
export function getSharedSlmWorkerProxy(): SlmRuntimeWorkerProxy {
  if (!sharedProxy) {
    sharedProxy = createSlmRuntimeProxyForBrowser();
  }
  return sharedProxy;
}

/**
 * Termina el proxy compartido (si existe) y permite que el siguiente
 * `getSharedSlmWorkerProxy()` cree uno nuevo. Útil al logout para
 * liberar la ORT session del worker.
 */
export function disposeSharedSlmWorkerProxy(): void {
  if (sharedProxy) {
    sharedProxy.terminate();
    sharedProxy = null;
  }
}
