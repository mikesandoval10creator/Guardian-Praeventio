import type { FireSpreadInput, FireSpreadResult } from './odeIntegrator';
import { validFireRequest, validFireResult, FIRE_WORKER_TIMEOUT_MS } from './fireSpreadProtocol';

export class FireSimulationError extends Error {
  constructor(readonly code: 'invalid' | 'unavailable' | 'failed' | 'timeout') {
    super(code === 'invalid'
      ? 'Revisa los parámetros y usa un horizonte de 1 a 240 minutos.'
      : code === 'timeout'
        ? 'La simulación demoró demasiado. Reduce el horizonte o los parámetros e intenta nuevamente.'
        : 'No se pudo ejecutar la simulación local. Intenta nuevamente o actualiza el navegador.');
    this.name = 'FireSimulationError';
  }
}
export function runFireSpreadSimulation(
  input: FireSpreadInput,
  tMax: number,
  signal?: AbortSignal,
): Promise<FireSpreadResult> {
  const request = { input, tMax };
  if (signal?.aborted) return Promise.reject(new DOMException('Simulación cancelada.', 'AbortError'));
  if (!validFireRequest(request)) return Promise.reject(new FireSimulationError('invalid'));
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.removeEventListener('message', message);
      worker?.removeEventListener('error', failure);
      worker?.removeEventListener('messageerror', failure);
      worker?.terminate();
      complete();
    };
    const abort = () => finish(() => reject(new DOMException('Simulación cancelada.', 'AbortError')));
    const failure = (event: Event) => {
      event.preventDefault();
      finish(() => reject(new FireSimulationError('failed')));
    };
    const message = (event: MessageEvent<unknown>) => {
      const value = event.data as { ok?: unknown; result?: unknown } | null;
      const result = value?.result;
      if (value?.ok === true && validFireResult(result, tMax)) {
        finish(() => resolve(result));
      } else finish(() => reject(new FireSimulationError('failed')));
    };
    try {
      worker = new Worker(new URL('../../workers/fireSpreadWorker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', message);
      worker.addEventListener('error', failure);
      worker.addEventListener('messageerror', failure);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else {
        timer = setTimeout(() => finish(() => reject(new FireSimulationError('timeout'))), FIRE_WORKER_TIMEOUT_MS);
        worker.postMessage(request);
      }
    } catch {
      finish(() => reject(new FireSimulationError('unavailable')));
    }
  });
}
