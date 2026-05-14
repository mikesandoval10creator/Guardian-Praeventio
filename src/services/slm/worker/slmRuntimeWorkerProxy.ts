/**
 * Main-thread proxy del SLM Runtime Worker.
 *
 * Reemplaza al `createSlmRuntime()` directo cuando el caller quiere
 * ejecutar TODO el runtime (load + integrity + ORT + inferencia) en
 * un Worker dedicado. Mantiene una API similar pero async + con
 * streaming de tokens.
 *
 * El proxy:
 *   - Crea el Worker en construct + tiene cleanup en `terminate()`
 *   - Mantiene un Map<requestId, callbacks> para correlacionar
 *     responses async con la promise que el caller espera
 *   - Eventos asincronos (load-progress, infer-token) se propagan
 *     vía callbacks opcionales que el caller pasa en `loadModel`/
 *     `infer`
 *   - `abort(requestId)` corta una operación en flight
 *
 * Diseñado para inyección: el caller puede pasar una factory de
 * Worker custom (tests con FakeWorker, dev con bundler glue, prod
 * con `new Worker(new URL(...))`).
 */

import {
  isWorkerResponse,
  newRequestId,
  type AbortRequest,
  type InferRequest,
  type InferTokenEvent,
  type LoadProgressEvent,
  type LoadRequest,
  type ReleaseRequest,
  type WorkerResponse,
} from './slmRuntimeWorkerProtocol';
import type { SLMBackend } from '../types';

// ────────────────────────────────────────────────────────────────────────
// Worker-like contract — minimal subset needed
// ────────────────────────────────────────────────────────────────────────

/**
 * Subset estructural del DOM Worker que necesitamos. Permite inyectar
 * MessagePort, MockWorker, etc. en tests.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message',
    listener: (ev: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: 'error',
    listener: (ev: { message?: string }) => void,
  ): void;
  removeEventListener(
    type: 'message' | 'error',
    listener: (ev: unknown) => void,
  ): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ProxyLoadOptions {
  expectedSha256Override?: string | null;
  bypassCache?: boolean;
  onProgress?: (e: Omit<LoadProgressEvent, 'kind' | 'requestId'>) => void;
}

export interface ProxyLoadedModel {
  modelHandle: string;
  modelId: string;
  observedSha256: string;
  backend: SLMBackend;
}

export interface ProxyInferOptions {
  maxTokens?: number;
  temperature?: number;
  /** Si está set, recibe cada token en streaming. */
  onToken?: (e: Omit<InferTokenEvent, 'kind' | 'requestId'>) => void;
  /** AbortSignal para cancelar la inferencia. */
  signal?: AbortSignal;
}

export interface ProxyInferResult {
  text: string;
  tokensGenerated: number;
  latencyMs: number;
  aborted?: boolean;
}

export class SlmWorkerProxyError extends Error {
  constructor(
    public readonly code:
      | 'unknown_model'
      | 'integrity_failure'
      | 'load_failure'
      | 'infer_failure'
      | 'handle_not_found'
      | 'release_failure'
      | 'aborted'
      | 'worker_error'
      | 'internal',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'SlmWorkerProxyError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Pending request bookkeeping
// ────────────────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /** Para 'load': onProgress callback. */
  onLoadProgress?: ProxyLoadOptions['onProgress'];
  /** Para 'infer': onToken callback. */
  onInferToken?: ProxyInferOptions['onToken'];
}

// ────────────────────────────────────────────────────────────────────────
// Proxy class
// ────────────────────────────────────────────────────────────────────────

export class SlmRuntimeWorkerProxy {
  private readonly worker: WorkerLike;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly messageListener: (ev: { data: unknown }) => void;
  private readonly errorListener: (ev: { message?: string }) => void;
  private terminated = false;

  constructor(workerFactory: WorkerFactory) {
    this.worker = workerFactory();

    this.messageListener = (ev) => {
      if (!isWorkerResponse(ev.data)) return;
      this.handleResponse(ev.data);
    };
    this.errorListener = (ev) => {
      const msg = ev.message ?? 'worker error event';
      // Fail-all-pending — el worker está en estado dudoso.
      for (const [, req] of this.pending) {
        req.reject(new SlmWorkerProxyError('worker_error', msg));
      }
      this.pending.clear();
    };

    this.worker.addEventListener('message', this.messageListener);
    this.worker.addEventListener('error', this.errorListener);
  }

  /**
   * Carga un modelo dentro del worker. La promise resuelve cuando el
   * worker confirma que el modelo está cargado y la ORT session está
   * lista. Si `onProgress` se pasa, se invoca por cada chunk del
   * download (los del runtime fetch streaming).
   */
  async loadModel(
    modelId: string,
    opts: ProxyLoadOptions = {},
  ): Promise<ProxyLoadedModel> {
    this.assertNotTerminated();
    const requestId = newRequestId('load');
    const req: LoadRequest = {
      kind: 'load',
      requestId,
      modelId,
      expectedSha256Override: opts.expectedSha256Override,
      bypassCache: opts.bypassCache,
    };
    return new Promise<ProxyLoadedModel>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onLoadProgress: opts.onProgress,
      });
      this.worker.postMessage(req);
    });
  }

  /**
   * Ejecuta inferencia. Si `onToken` está set, recibe streaming;
   * sino la promise resuelve con el texto final completo.
   */
  async infer(
    modelHandle: string,
    prompt: string,
    opts: ProxyInferOptions = {},
  ): Promise<ProxyInferResult> {
    this.assertNotTerminated();
    const requestId = newRequestId('infer');
    const req: InferRequest = {
      kind: 'infer',
      requestId,
      modelHandle,
      prompt,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      streamTokens: Boolean(opts.onToken),
    };

    // Si el caller pasó AbortSignal, lo cableamos a un abort message.
    if (opts.signal) {
      const onAbort = () => {
        this.abort(requestId);
      };
      if (opts.signal.aborted) {
        // Ya abortado antes de empezar.
        return Promise.reject(
          new SlmWorkerProxyError('aborted', 'signal aborted before send'),
        );
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    return new Promise<ProxyInferResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onInferToken: opts.onToken,
      });
      this.worker.postMessage(req);
    });
  }

  /**
   * Libera el modelo en el worker (ORT session.release). Idempotent
   * para handles inexistentes.
   */
  async release(modelHandle: string): Promise<void> {
    if (this.terminated) return;
    const requestId = newRequestId('release');
    const req: ReleaseRequest = {
      kind: 'release',
      requestId,
      modelHandle,
    };
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: () => resolve(),
        reject,
      });
      this.worker.postMessage(req);
    });
  }

  /**
   * Cancela una request en flight. El worker corta el loop en el
   * siguiente token y emite `infer-complete` con `aborted: true`.
   */
  abort(abortRequestId: string): void {
    if (this.terminated) return;
    const requestId = newRequestId('abort');
    const req: AbortRequest = {
      kind: 'abort',
      requestId,
      abortRequestId,
    };
    this.worker.postMessage(req);
  }

  /**
   * Cierra el worker y rechaza todas las requests pendientes.
   * Idempotent.
   */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    try {
      this.worker.removeEventListener('message', this.messageListener);
      this.worker.removeEventListener('error', this.errorListener);
    } catch {
      // best-effort
    }
    try {
      this.worker.terminate();
    } catch {
      // best-effort
    }
    for (const [, req] of this.pending) {
      req.reject(new SlmWorkerProxyError('aborted', 'proxy terminated'));
    }
    this.pending.clear();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal: response dispatcher
  // ─────────────────────────────────────────────────────────────────────

  private handleResponse(msg: WorkerResponse): void {
    const req = this.pending.get(msg.requestId);
    switch (msg.kind) {
      case 'load-progress':
        if (req?.onLoadProgress) {
          req.onLoadProgress({
            loaded: msg.loaded,
            total: msg.total,
            filename: msg.filename,
            fileIndex: msg.fileIndex,
            fileCount: msg.fileCount,
          });
        }
        break;

      case 'load-complete':
        if (req) {
          req.resolve({
            modelHandle: msg.modelHandle,
            modelId: msg.modelId,
            observedSha256: msg.observedSha256,
            backend: msg.backend,
          } satisfies ProxyLoadedModel);
          this.pending.delete(msg.requestId);
        }
        break;

      case 'infer-token':
        if (req?.onInferToken) {
          req.onInferToken({
            token: msg.token,
            cumulativeText: msg.cumulativeText,
            tokenCount: msg.tokenCount,
          });
        }
        break;

      case 'infer-complete':
        if (req) {
          req.resolve({
            text: msg.text,
            tokensGenerated: msg.tokensGenerated,
            latencyMs: msg.latencyMs,
            aborted: msg.aborted,
          } satisfies ProxyInferResult);
          this.pending.delete(msg.requestId);
        }
        break;

      case 'release-complete':
        if (req) {
          req.resolve(undefined);
          this.pending.delete(msg.requestId);
        }
        break;

      case 'abort-ack':
        // Fire-and-forget — no caller waiting for abort ack.
        if (req) {
          req.resolve(undefined);
          this.pending.delete(msg.requestId);
        }
        break;

      case 'pong':
        if (req) {
          req.resolve(undefined);
          this.pending.delete(msg.requestId);
        }
        break;

      case 'error':
        if (req) {
          req.reject(
            new SlmWorkerProxyError(
              msg.errorCode === 'unknown_model'
                ? 'unknown_model'
                : msg.errorCode === 'integrity_failure'
                  ? 'integrity_failure'
                  : msg.errorCode === 'load_failure'
                    ? 'load_failure'
                    : msg.errorCode === 'infer_failure'
                      ? 'infer_failure'
                      : msg.errorCode === 'handle_not_found'
                        ? 'handle_not_found'
                        : msg.errorCode === 'release_failure'
                          ? 'release_failure'
                          : msg.errorCode === 'aborted'
                            ? 'aborted'
                            : 'internal',
              msg.errorMessage,
            ),
          );
          this.pending.delete(msg.requestId);
        }
        break;

      default: {
        // Exhaustiveness check — TS narrows msg to never.
        const _check: never = msg;
        void _check;
      }
    }
  }

  private assertNotTerminated(): void {
    if (this.terminated) {
      throw new SlmWorkerProxyError(
        'internal',
        'proxy has been terminated; create a new instance',
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Default factory — bundler glue
// ────────────────────────────────────────────────────────────────────────

/**
 * Factory por defecto que construye el Worker desde el bundler. NO se
 * exporta por default porque el path depende del bundler (Vite usa
 * `new URL(...)` con `import.meta.url`). El caller productivo provee
 * el factory; tests pasan FakeWorker.
 *
 * Ejemplo Vite (NO ejecutar aquí, solo doc):
 * ```
 * const proxy = new SlmRuntimeWorkerProxy(() =>
 *   new Worker(
 *     new URL('./slmRuntimeWorker.ts', import.meta.url),
 *     { type: 'module' }
 *   ) as unknown as WorkerLike,
 * );
 * ```
 */
