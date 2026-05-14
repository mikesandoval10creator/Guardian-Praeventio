// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  SlmRuntimeWorkerProxy,
  SlmWorkerProxyError,
  type WorkerLike,
} from './slmRuntimeWorkerProxy';
import type {
  AbortRequest,
  InferRequest,
  LoadRequest,
  ReleaseRequest,
  WorkerRequest,
  WorkerResponse,
} from './slmRuntimeWorkerProtocol';

// ────────────────────────────────────────────────────────────────────────
// FakeWorker — simula el worker side para tests deterministicos
// ────────────────────────────────────────────────────────────────────────

class FakeWorker implements WorkerLike {
  private messageListeners: Array<(ev: { data: unknown }) => void> = [];
  private errorListeners: Array<(ev: { message?: string }) => void> = [];
  /** Inbox de mensajes recibidos del main thread. */
  public received: WorkerRequest[] = [];
  /** Si está set, cada postMessage se procesa con este handler. */
  public handleMessage?: (
    req: WorkerRequest,
    emit: (resp: WorkerResponse) => void,
  ) => void;
  public terminated = false;

  postMessage(message: unknown): void {
    if (this.terminated) return;
    this.received.push(message as WorkerRequest);
    if (this.handleMessage) {
      this.handleMessage(message as WorkerRequest, (resp) => this.emit(resp));
    }
  }

  emit(resp: WorkerResponse): void {
    for (const l of this.messageListeners) {
      l({ data: resp });
    }
  }

  emitError(msg = 'fake error'): void {
    for (const l of this.errorListeners) {
      l({ message: msg });
    }
  }

  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messageListeners.push(listener);
    else this.errorListeners.push(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    } else {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('SlmRuntimeWorkerProxy — loadModel', () => {
  it('happy path: send load → recibe load-complete → resolve', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'load') {
        emit({
          kind: 'load-complete',
          requestId: req.requestId,
          modelHandle: 'h-1',
          modelId: req.modelId,
          observedSha256: 'a'.repeat(64),
          backend: 'webgpu',
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const m = await proxy.loadModel('phi-3-mini');
    expect(m.modelHandle).toBe('h-1');
    expect(m.modelId).toBe('phi-3-mini');
    expect(m.backend).toBe('webgpu');
    proxy.terminate();
  });

  it('onProgress recibe events durante load', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'load') {
        // Emit 2 progress events + complete.
        emit({
          kind: 'load-progress',
          requestId: req.requestId,
          loaded: 100,
          total: 1000,
          filename: 'model.onnx',
          fileIndex: 0,
          fileCount: 1,
        });
        emit({
          kind: 'load-progress',
          requestId: req.requestId,
          loaded: 500,
          total: 1000,
          filename: 'model.onnx',
          fileIndex: 0,
          fileCount: 1,
        });
        emit({
          kind: 'load-complete',
          requestId: req.requestId,
          modelHandle: 'h-1',
          modelId: req.modelId,
          observedSha256: 'b'.repeat(64),
          backend: 'wasm-simd',
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const events: number[] = [];
    await proxy.loadModel('qwen-2.5-0.5b', {
      onProgress: (e) => events.push(e.loaded),
    });
    expect(events).toEqual([100, 500]);
    proxy.terminate();
  });

  it('error: worker responde con error → reject con código', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      emit({
        kind: 'error',
        requestId: req.requestId,
        errorCode: 'unknown_model',
        errorMessage: 'no such model',
      });
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    let err: unknown;
    try {
      await proxy.loadModel('mistery');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SlmWorkerProxyError);
    expect((err as SlmWorkerProxyError).code).toBe('unknown_model');
    proxy.terminate();
  });
});

describe('SlmRuntimeWorkerProxy — infer', () => {
  it('non-streaming: resolve con texto final', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'infer') {
        emit({
          kind: 'infer-complete',
          requestId: req.requestId,
          text: 'respuesta completa',
          tokensGenerated: 5,
          latencyMs: 250,
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const r = await proxy.infer('h-1', 'prompt');
    expect(r.text).toBe('respuesta completa');
    expect(r.tokensGenerated).toBe(5);
    proxy.terminate();
  });

  it('streaming: onToken se invoca por cada token; promise resuelve al final', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'infer') {
        // Emit 3 tokens + complete.
        emit({
          kind: 'infer-token',
          requestId: req.requestId,
          token: 'hola',
          cumulativeText: 'hola',
          tokenCount: 1,
        });
        emit({
          kind: 'infer-token',
          requestId: req.requestId,
          token: ' mundo',
          cumulativeText: 'hola mundo',
          tokenCount: 2,
        });
        emit({
          kind: 'infer-token',
          requestId: req.requestId,
          token: '!',
          cumulativeText: 'hola mundo!',
          tokenCount: 3,
        });
        emit({
          kind: 'infer-complete',
          requestId: req.requestId,
          text: 'hola mundo!',
          tokensGenerated: 3,
          latencyMs: 500,
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const tokens: string[] = [];
    const r = await proxy.infer('h-1', 'p', {
      onToken: (e) => tokens.push(e.token),
    });
    expect(tokens).toEqual(['hola', ' mundo', '!']);
    expect(r.text).toBe('hola mundo!');
    expect(r.tokensGenerated).toBe(3);
    proxy.terminate();
  });

  it('abort via AbortSignal: envía abort request al worker', async () => {
    const fake = new FakeWorker();
    let inferRequestId: string | null = null;
    fake.handleMessage = (req) => {
      if (req.kind === 'infer') {
        inferRequestId = req.requestId;
        // No emit — promise queda pending hasta que abortemos.
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const controller = new AbortController();

    const promise = proxy.infer('h-1', 'p', { signal: controller.signal });
    // Esperar a que el worker reciba el infer.
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await new Promise((r) => setTimeout(r, 5));
    // Buscar si el fake recibió un abort request.
    const abortReq = fake.received.find((r) => r.kind === 'abort') as
      | AbortRequest
      | undefined;
    expect(abortReq).toBeDefined();
    expect(abortReq!.abortRequestId).toBe(inferRequestId);

    // El worker responde con infer-complete aborted=true para cerrar la promise.
    fake.emit({
      kind: 'infer-complete',
      requestId: inferRequestId!,
      text: 'parcial',
      tokensGenerated: 2,
      latencyMs: 100,
      aborted: true,
    });
    const r = await promise;
    expect(r.aborted).toBe(true);
    proxy.terminate();
  });

  it('AbortSignal ya abortado antes de enviar → reject inmediato', async () => {
    const fake = new FakeWorker();
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const controller = new AbortController();
    controller.abort();
    let err: unknown;
    try {
      await proxy.infer('h', 'p', { signal: controller.signal });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SlmWorkerProxyError);
    expect((err as SlmWorkerProxyError).code).toBe('aborted');
    proxy.terminate();
  });
});

describe('SlmRuntimeWorkerProxy — release', () => {
  it('envía release request + resuelve con release-complete', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'release') {
        emit({
          kind: 'release-complete',
          requestId: req.requestId,
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    await expect(proxy.release('h-1')).resolves.toBeUndefined();
    const releaseReq = fake.received.find((r) => r.kind === 'release') as
      | ReleaseRequest
      | undefined;
    expect(releaseReq?.modelHandle).toBe('h-1');
    proxy.terminate();
  });
});

describe('SlmRuntimeWorkerProxy — terminate', () => {
  it('terminate llama worker.terminate y rechaza pendings', async () => {
    const fake = new FakeWorker();
    // El worker NO responde — todas las promises quedarán pending.
    fake.handleMessage = () => {};
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const loadPromise = proxy.loadModel('m');
    proxy.terminate();
    expect(fake.terminated).toBe(true);
    await expect(loadPromise).rejects.toThrow(/aborted/);
  });

  it('terminate es idempotent', () => {
    const fake = new FakeWorker();
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    proxy.terminate();
    proxy.terminate(); // no throw
    expect(fake.terminated).toBe(true);
  });

  it('loadModel después de terminate lanza', async () => {
    const fake = new FakeWorker();
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    proxy.terminate();
    await expect(proxy.loadModel('m')).rejects.toThrow(/terminated/);
  });
});

describe('SlmRuntimeWorkerProxy — error event from worker', () => {
  it('worker dispatch error event → todas las promises pendings rechazan', async () => {
    const fake = new FakeWorker();
    fake.handleMessage = () => {}; // never respond
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const p1 = proxy.loadModel('m1');
    const p2 = proxy.infer('h', 'p');

    fake.emitError('worker crashed');

    await expect(p1).rejects.toThrow(/worker crashed/);
    await expect(p2).rejects.toThrow(/worker crashed/);
    proxy.terminate();
  });
});

describe('SlmRuntimeWorkerProxy — request bookkeeping', () => {
  it('múltiples requests in-flight no se confunden (correlación por requestId)', async () => {
    const fake = new FakeWorker();
    const pending: Array<(emit: (resp: WorkerResponse) => void) => void> = [];
    fake.handleMessage = (req, emit) => {
      if (req.kind === 'load') {
        // Capturar y responder DESPUÉS, fuera de orden.
        pending.push(() => {
          emit({
            kind: 'load-complete',
            requestId: req.requestId,
            modelHandle: `h-${req.modelId}`,
            modelId: req.modelId,
            observedSha256: 'c'.repeat(64),
            backend: 'webgpu',
          });
        });
      }
    };
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    const p1 = proxy.loadModel('phi');
    const p2 = proxy.loadModel('qwen');
    const p3 = proxy.loadModel('gemma');

    // Resolver en orden inverso.
    pending[2]!((resp) => fake.emit(resp));
    pending[0]!((resp) => fake.emit(resp));
    pending[1]!((resp) => fake.emit(resp));

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.modelHandle).toBe('h-phi');
    expect(r2.modelHandle).toBe('h-qwen');
    expect(r3.modelHandle).toBe('h-gemma');
    proxy.terminate();
  });

  it('mensaje con requestId desconocido se ignora (no crash)', async () => {
    const fake = new FakeWorker();
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    // Emitir un complete con requestId que nadie espera — debe no-op.
    fake.emit({
      kind: 'load-complete',
      requestId: 'unknown-req',
      modelHandle: 'h',
      modelId: 'm',
      observedSha256: 'd'.repeat(64),
      backend: 'webgpu',
    });
    // Si llegara a crashear, el siguiente test would fail.
    expect(true).toBe(true);
    proxy.terminate();
  });

  it('isWorkerResponse rechaza mensajes mal formados', () => {
    const fake = new FakeWorker();
    const proxy = new SlmRuntimeWorkerProxy(() => fake);
    // Emit garbage — debe ser ignored.
    for (const l of (fake as unknown as { messageListeners: Array<(ev: { data: unknown }) => void> }).messageListeners) {
      l({ data: 'not an object' });
      l({ data: { kind: 'invalid', requestId: 'x' } });
      l({ data: null });
    }
    expect(true).toBe(true); // no crash
    proxy.terminate();
  });
});
