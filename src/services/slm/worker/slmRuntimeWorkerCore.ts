/**
 * SLM Runtime Worker — core logic (test-friendly).
 *
 * Implementación pura del lado worker del protocolo `slmRuntimeWorkerProtocol`.
 * Recibe `WorkerRequest` y emite `WorkerResponse` via una `dispatchFn`
 * inyectada — esto permite testearla sin necesitar un Worker real ni
 * `self.postMessage`.
 *
 * En producción, el script entrypoint `slmRuntimeWorker.ts` (NO en
 * este archivo) crea una instancia de `SlmRuntimeWorkerCore` con
 * `dispatchFn = (r) => self.postMessage(r)` y se la conecta al
 * `addEventListener('message')`.
 *
 * Responsabilidades:
 *   - Mantiene un Map<modelHandle, LoadedModel> con los modelos
 *     cargados
 *   - Despacha load/infer/release/abort/ping al runtime correspondiente
 *   - Convierte errores del runtime en WorkerResponse 'error' con
 *     errorCode estructurado
 *   - Soporta cancelación: cada infer recibe un AbortController interno
 *     que se cancela cuando llega un AbortRequest
 *   - Streaming opcional de tokens (postMessage por token cuando
 *     `streamTokens=true`)
 */

import {
  isWorkerRequest,
  type AbortRequest,
  type ErrorEvent,
  type InferCompleteEvent,
  type InferRequest,
  type InferTokenEvent,
  type LoadCompleteEvent,
  type LoadProgressEvent,
  type LoadRequest,
  type PingRequest,
  type PongEvent,
  type ReleaseCompleteEvent,
  type ReleaseRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './slmRuntimeWorkerProtocol';
import type {
  LoadedModel,
  OnnxRuntimeLike,
  SlmRuntime,
  SlmTokenizerLike,
} from '../slmRuntime';

// ────────────────────────────────────────────────────────────────────────
// Worker version — sanity check para drift main/worker
// ────────────────────────────────────────────────────────────────────────

export const WORKER_VERSION = '1.0.0';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Función dispatch que el caller inyecta. En producción es
 * `(r) => self.postMessage(r)`; en tests es un spy.
 */
export type DispatchFn = (response: WorkerResponse) => void;

/**
 * Factory que devuelve un `SlmRuntime`. En producción importa
 * `createSlmRuntime` del módulo `slmRuntime`; en tests devuelve un
 * stub deterministico.
 */
export type RuntimeFactory = () => SlmRuntime | Promise<SlmRuntime>;

export interface WorkerCoreOptions {
  /** Factory del runtime. Default: import dinámico de slmRuntime. */
  runtimeFactory?: RuntimeFactory;
  /** Override ortFactory que se pasa a loadModel (tests). */
  ortFactory?: () => Promise<OnnxRuntimeLike>;
  /**
   * B14 (2026-06-11): loader del tokenizer real. Default: import
   * dinámico de `../tokenizer#loadTokenizer` (BPE de
   * `@huggingface/transformers`). Inyectable en tests. Recibe el
   * `tokenizerUrl` del descriptor (HF repo id).
   */
  tokenizerLoader?: (tokenizerUrl: string) => Promise<SlmTokenizerLike>;
}

/**
 * Genera un model handle único. Pure — no toca crypto si está
 * disponible.
 */
function newModelHandle(modelId: string): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${modelId}::${ts}::${rnd}`;
}

// ────────────────────────────────────────────────────────────────────────
// Worker core class
// ────────────────────────────────────────────────────────────────────────

interface ActiveInfer {
  requestId: string;
  abortController: AbortController;
}

export class SlmRuntimeWorkerCore {
  private readonly dispatch: DispatchFn;
  private readonly options: WorkerCoreOptions;
  private runtimePromise: Promise<SlmRuntime> | null = null;
  /** Map<modelHandle, LoadedModel>. */
  private readonly loadedModels = new Map<string, LoadedModel>();
  /**
   * B14: tokenizer real por handle. `undefined` = el descriptor no
   * declara `tokenizerUrl` (stubs de test) → el runtime usa su
   * fallback. `null` = el descriptor SÍ declara tokenizer pero la
   * carga falló → `infer` falla honesto (nunca gibberish al usuario;
   * la escalera resiliente cae al siguiente tier).
   */
  private readonly tokenizers = new Map<
    string,
    SlmTokenizerLike | null | undefined
  >();
  /** Map<requestId, AbortController> for cancellable infers. */
  private readonly activeInfers = new Map<string, ActiveInfer>();

  constructor(dispatch: DispatchFn, options: WorkerCoreOptions = {}) {
    this.dispatch = dispatch;
    this.options = options;
  }

  /**
   * Punto de entrada para mensajes desde el main thread. Valida +
   * despacha. Cualquier excepción interna se convierte en un
   * ErrorEvent — el worker NUNCA lanza al main.
   */
  async onMessage(data: unknown): Promise<void> {
    if (!isWorkerRequest(data)) {
      // Mensaje inválido — silencioso (no tenemos requestId para
      // responder y el main side no nos está esperando).
      return;
    }
    const req = data;
    try {
      switch (req.kind) {
        case 'load':
          await this.handleLoad(req);
          break;
        case 'infer':
          await this.handleInfer(req);
          break;
        case 'release':
          await this.handleRelease(req);
          break;
        case 'abort':
          this.handleAbort(req);
          break;
        case 'ping':
          this.handlePing(req);
          break;
        default: {
          const _exhaustive: never = req;
          void _exhaustive;
        }
      }
    } catch (err) {
      this.emitError(req.requestId, 'internal', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Request handlers
  // ─────────────────────────────────────────────────────────────────────

  private async handleLoad(req: LoadRequest): Promise<void> {
    try {
      const runtime = await this.getRuntime();
      const handle = newModelHandle(req.modelId);

      const loaded = await runtime.loadModel(req.modelId, {
        expectedSha256Override: req.expectedSha256Override,
        bypassCache: req.bypassCache,
        ortFactory: this.options.ortFactory,
        onProgress: (e) => {
          const progress: LoadProgressEvent = {
            kind: 'load-progress',
            requestId: req.requestId,
            loaded: e.loaded,
            total: e.total,
            filename: e.filename,
            fileIndex: e.fileIndex,
            fileCount: e.fileCount,
          };
          this.dispatch(progress);
        },
      });

      this.loadedModels.set(handle, loaded);

      // B14: cargar el tokenizer REAL del modelo (BPE). Sin él, el
      // runtime caería al tokenizer byte-level y el modelo generaría
      // texto sin sentido — prohibido por anti-stub (#13). La carga
      // corre DESPUÉS del load del modelo para no bloquearlo; un fallo
      // se registra como `null` y `handleInfer` falla honesto.
      const tokenizerUrl = loaded.descriptor?.tokenizerUrl;
      if (tokenizerUrl) {
        try {
          const tokenizer = await this.loadTokenizer(tokenizerUrl);
          this.tokenizers.set(handle, tokenizer);
        } catch {
          this.tokenizers.set(handle, null);
        }
      } else {
        this.tokenizers.set(handle, undefined);
      }

      const complete: LoadCompleteEvent = {
        kind: 'load-complete',
        requestId: req.requestId,
        modelHandle: handle,
        modelId: loaded.modelId,
        observedSha256: loaded.observedSha256,
        backend: loaded.backend,
      };
      this.dispatch(complete);
    } catch (err) {
      const code = this.classifyError(err, 'load_failure');
      this.emitError(req.requestId, code, err);
    }
  }

  private async handleInfer(req: InferRequest): Promise<void> {
    const model = this.loadedModels.get(req.modelHandle);
    if (!model) {
      this.emitError(
        req.requestId,
        'handle_not_found',
        new Error(`Model handle '${req.modelHandle}' not found`),
      );
      return;
    }

    // B14: honest-failure gate. Si el descriptor declara un tokenizer
    // real pero su carga falló, NO inferimos con el fallback byte-level
    // (produciría texto sin sentido presentado como respuesta). El
    // error estructurado deja que la escalera resiliente caiga al
    // siguiente tier (RAG corpus → mensaje offline honesto).
    const tokenizer = this.tokenizers.get(req.modelHandle);
    if (tokenizer === null) {
      this.emitError(
        req.requestId,
        'infer_failure',
        new Error(
          `Tokenizer unavailable for model handle '${req.modelHandle}' ` +
            '(declared tokenizerUrl failed to load); refusing byte-level fallback.',
        ),
      );
      return;
    }

    const abortController = new AbortController();
    this.activeInfers.set(req.requestId, {
      requestId: req.requestId,
      abortController,
    });

    const startedAt = Date.now();
    try {
      const runtime = await this.getRuntime();

      let cumulativeText = '';
      let tokenCount = 0;
      let aborted = false;

      // Si el runtime soporta streaming, lo usamos. Si no, hacemos
      // un single infer + un único event final.
      const supportsStreaming =
        typeof (runtime as { inferStream?: unknown }).inferStream === 'function';

      if (supportsStreaming && req.streamTokens) {
        // Path streaming (delegado al runtime.inferStream).
        const stream = (
          runtime as unknown as {
            inferStream: (
              m: LoadedModel,
              prompt: string,
              opts: {
                maxTokens?: number;
                temperature?: number;
                signal?: AbortSignal;
                onToken?: (token: string) => void;
                tokenizer?: SlmTokenizerLike;
              },
            ) => Promise<string>;
          }
        ).inferStream;
        const finalText = await stream(model, req.prompt, {
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          tokenizer,
          signal: abortController.signal,
          onToken: (token: string) => {
            cumulativeText += token;
            tokenCount += 1;
            const ev: InferTokenEvent = {
              kind: 'infer-token',
              requestId: req.requestId,
              token,
              cumulativeText,
              tokenCount,
            };
            this.dispatch(ev);
          },
        });
        cumulativeText = finalText;
      } else {
        // Path single-shot: el runtime devuelve el texto completo.
        // Si streamTokens=true pero el runtime no lo soporta, emitimos
        // un único InferTokenEvent al final con el texto completo
        // (degradado graceful — el caller que esperaba streaming
        // recibe al menos algo).
        const result = await runtime.infer(model, req.prompt, {
          maxTokens: req.maxTokens,
          tokenizer,
        });
        cumulativeText = result;
        tokenCount = result.length; // aproximación cuando no hay tokenizer real
        if (req.streamTokens) {
          const ev: InferTokenEvent = {
            kind: 'infer-token',
            requestId: req.requestId,
            token: result,
            cumulativeText: result,
            tokenCount,
          };
          this.dispatch(ev);
        }
      }

      // Check si fue abortado durante el loop.
      if (abortController.signal.aborted) {
        aborted = true;
      }

      const complete: InferCompleteEvent = {
        kind: 'infer-complete',
        requestId: req.requestId,
        text: cumulativeText,
        tokensGenerated: tokenCount,
        latencyMs: Date.now() - startedAt,
        aborted: aborted || undefined,
      };
      this.dispatch(complete);
    } catch (err) {
      // Si fue abortado, emitimos un infer-complete con aborted:true
      // en vez de un error — semántica más útil para el caller.
      if (abortController.signal.aborted) {
        const complete: InferCompleteEvent = {
          kind: 'infer-complete',
          requestId: req.requestId,
          text: '',
          tokensGenerated: 0,
          latencyMs: Date.now() - startedAt,
          aborted: true,
        };
        this.dispatch(complete);
      } else {
        const code = this.classifyError(err, 'infer_failure');
        this.emitError(req.requestId, code, err);
      }
    } finally {
      this.activeInfers.delete(req.requestId);
    }
  }

  private async handleRelease(req: ReleaseRequest): Promise<void> {
    const model = this.loadedModels.get(req.modelHandle);
    if (!model) {
      // Idempotent: handles desconocidos resolven sin error (el caller
      // puede llamar release después de un crash sin tener que
      // saber el estado real).
      const ack: ReleaseCompleteEvent = {
        kind: 'release-complete',
        requestId: req.requestId,
      };
      this.dispatch(ack);
      return;
    }
    try {
      const runtime = await this.getRuntime();
      await runtime.release(model);
      this.loadedModels.delete(req.modelHandle);
      this.tokenizers.delete(req.modelHandle);
      const ack: ReleaseCompleteEvent = {
        kind: 'release-complete',
        requestId: req.requestId,
      };
      this.dispatch(ack);
    } catch (err) {
      const code = this.classifyError(err, 'release_failure');
      this.emitError(req.requestId, code, err);
    }
  }

  private handleAbort(req: AbortRequest): void {
    const active = this.activeInfers.get(req.abortRequestId);
    const found = Boolean(active);
    if (active) {
      active.abortController.abort();
    }
    this.dispatch({
      kind: 'abort-ack',
      requestId: req.requestId,
      found,
    });
  }

  private handlePing(req: PingRequest): void {
    const pong: PongEvent = {
      kind: 'pong',
      requestId: req.requestId,
      workerVersion: WORKER_VERSION,
    };
    this.dispatch(pong);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * B14: tokenizer loader. Default importa `../tokenizer` (wrapper de
   * `@huggingface/transformers#AutoTokenizer`) y lo adapta al shape
   * `SlmTokenizerLike` que `slmRuntime.infer*` acepta (async ok).
   */
  private async loadTokenizer(
    tokenizerUrl: string,
  ): Promise<SlmTokenizerLike> {
    if (this.options.tokenizerLoader) {
      return this.options.tokenizerLoader(tokenizerUrl);
    }
    const { loadTokenizer } = await import('../tokenizer');
    const tok = await loadTokenizer(tokenizerUrl);
    return {
      encode: async (text: string) => (await tok.encode(text)).inputIds,
      decode: (ids: number[]) => tok.decode(ids),
      applyChatTemplate: (messages) => tok.applyChatTemplate(messages),
    };
  }

  private async getRuntime(): Promise<SlmRuntime> {
    if (!this.runtimePromise) {
      const factory =
        this.options.runtimeFactory ??
        (async () => {
          const mod = await import('../slmRuntime');
          return mod.createSlmRuntime();
        });
      this.runtimePromise = Promise.resolve(factory());
    }
    return this.runtimePromise;
  }

  private classifyError(
    err: unknown,
    fallback: ErrorEvent['errorCode'],
  ): ErrorEvent['errorCode'] {
    if (!(err instanceof Error)) return fallback;
    const msg = err.message;
    if (msg.includes('unknown model id')) return 'unknown_model';
    if (msg.includes('integrity check failed')) return 'integrity_failure';
    if (msg.includes('SHA-256')) return 'integrity_failure';
    if (err.name === 'SlmIntegrityError') return 'integrity_failure';
    return fallback;
  }

  private emitError(
    requestId: string,
    errorCode: ErrorEvent['errorCode'],
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const ev: ErrorEvent = {
      kind: 'error',
      requestId,
      errorCode,
      errorMessage: message,
      stack,
    };
    this.dispatch(ev);
  }
}

/**
 * Convenience factory para producción. El caller (`slmRuntimeWorker.ts`,
 * el archivo entry del worker) hace:
 *
 * ```
 * const core = createWorkerCore((r) => self.postMessage(r));
 * self.addEventListener('message', (e) => { void core.onMessage(e.data); });
 * ```
 */
export function createWorkerCore(
  dispatch: DispatchFn,
  options?: WorkerCoreOptions,
): SlmRuntimeWorkerCore {
  return new SlmRuntimeWorkerCore(dispatch, options);
}
