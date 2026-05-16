import { describe, it, expect, vi } from 'vitest';
import { createWorkerCore } from './slmRuntimeWorkerCore';
import type {
  AbortRequest,
  InferCompleteEvent,
  InferRequest,
  InferTokenEvent,
  LoadCompleteEvent,
  LoadProgressEvent,
  LoadRequest,
  PingRequest,
  ReleaseRequest,
  WorkerResponse,
} from './slmRuntimeWorkerProtocol';
import type { LoadedModel, SlmRuntime } from '../slmRuntime';

// ────────────────────────────────────────────────────────────────────────
// Stub runtime — controla el comportamiento desde los tests
// ────────────────────────────────────────────────────────────────────────

function makeStubRuntime(
  over: Partial<SlmRuntime> = {},
): SlmRuntime {
  const defaultLoaded: LoadedModel = {
    modelId: 'phi-3-mini',
    descriptor: {} as unknown as LoadedModel['descriptor'],
    observedSha256: 'a'.repeat(64),
    backend: 'webgpu',
    session: {} as unknown as LoadedModel['session'],
  };
  return {
    loadModel: async () => defaultLoaded,
    infer: async () => 'respuesta stub',
    inferStream: async () => 'respuesta stub',
    release: async () => {},
    ...over,
  };
}

function captureDispatch(): {
  dispatch: (r: WorkerResponse) => void;
  responses: WorkerResponse[];
} {
  const responses: WorkerResponse[] = [];
  return {
    dispatch: (r) => {
      responses.push(r);
    },
    responses,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('SlmRuntimeWorkerCore — onMessage validation', () => {
  it('mensaje inválido se ignora silenciosamente', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch);
    await core.onMessage(null);
    await core.onMessage('not-an-object');
    await core.onMessage({ kind: 'unknown', requestId: 'x' });
    expect(responses).toHaveLength(0);
  });
});

describe('SlmRuntimeWorkerCore — load', () => {
  it('load exitoso emite load-complete con modelHandle', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => makeStubRuntime(),
    });
    const req: LoadRequest = {
      kind: 'load',
      requestId: 'r-1',
      modelId: 'phi-3-mini',
    };
    await core.onMessage(req);
    const complete = responses.find(
      (r) => r.kind === 'load-complete',
    ) as LoadCompleteEvent | undefined;
    expect(complete).toBeDefined();
    expect(complete!.requestId).toBe('r-1');
    expect(complete!.modelId).toBe('phi-3-mini');
    expect(complete!.modelHandle).toMatch(/^phi-3-mini::/);
    expect(complete!.observedSha256).toBe('a'.repeat(64));
    expect(complete!.backend).toBe('webgpu');
  });

  it('load propaga onProgress events vía load-progress', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime({
      loadModel: async (_id, opts) => {
        // El stub simula 2 progress events.
        opts?.onProgress?.({
          loaded: 100,
          total: 1000,
          filename: 'model.onnx',
          fileIndex: 0,
          fileCount: 1,
        });
        opts?.onProgress?.({
          loaded: 500,
          total: 1000,
          filename: 'model.onnx',
          fileIndex: 0,
          fileCount: 1,
        });
        return {
          modelId: 'm',
          descriptor: {} as never,
          observedSha256: 'b'.repeat(64),
          backend: 'wasm-simd',
          session: {} as never,
        };
      },
    });
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-1',
      modelId: 'm',
    });
    const progress = responses.filter(
      (r) => r.kind === 'load-progress',
    ) as LoadProgressEvent[];
    expect(progress).toHaveLength(2);
    expect(progress[0]!.loaded).toBe(100);
    expect(progress[1]!.loaded).toBe(500);
  });

  it('load con runtime que lanza unknown_model → error con código', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime({
      loadModel: async () => {
        throw new Error("unknown model id 'does-not-exist'");
      },
    });
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-1',
      modelId: 'does-not-exist',
    });
    const err = responses.find((r) => r.kind === 'error');
    expect(err).toBeDefined();
    expect((err as { errorCode: string }).errorCode).toBe('unknown_model');
  });

  it('load con SHA-256 integrity error → integrity_failure', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime({
      loadModel: async () => {
        throw new Error('SLM integrity check failed: expected SHA-256 ...');
      },
    });
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-1',
      modelId: 'm',
    });
    const err = responses.find((r) => r.kind === 'error');
    expect((err as { errorCode: string }).errorCode).toBe('integrity_failure');
  });
});

describe('SlmRuntimeWorkerCore — infer', () => {
  it('infer con modelHandle desconocido → handle_not_found', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => makeStubRuntime(),
    });
    await core.onMessage({
      kind: 'infer',
      requestId: 'r-1',
      modelHandle: 'no-existe',
      prompt: 'hola',
    });
    const err = responses.find((r) => r.kind === 'error');
    expect((err as { errorCode: string }).errorCode).toBe('handle_not_found');
  });

  it('infer non-streaming: emite infer-complete con texto final', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () =>
        makeStubRuntime({
          infer: async () => 'respuesta completa del SLM',
        }),
    });
    // Primero cargar.
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const loadComplete = responses.find(
      (r) => r.kind === 'load-complete',
    ) as LoadCompleteEvent;
    const handle = loadComplete.modelHandle;

    // Después infer sin streaming.
    await core.onMessage({
      kind: 'infer',
      requestId: 'r-infer',
      modelHandle: handle,
      prompt: 'pregunta',
    } satisfies InferRequest);
    const inferComplete = responses.find(
      (r) => r.kind === 'infer-complete',
    ) as InferCompleteEvent | undefined;
    expect(inferComplete).toBeDefined();
    expect(inferComplete!.text).toBe('respuesta completa del SLM');
    expect(inferComplete!.requestId).toBe('r-infer');
    expect(inferComplete!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('infer streaming con runtime que NO soporta streaming: degraded a single InferTokenEvent + complete', async () => {
    const { dispatch, responses } = captureDispatch();
    // El default de `makeStubRuntime` SIEMPRE incluye `inferStream`.
    // Para simular un runtime que NO soporta streaming necesitamos
    // eliminarlo explícitamente del stub — si no, el worker detecta
    // `typeof runtime.inferStream === 'function'` y nunca entra al
    // path single-shot que estamos testeando.
    const runtimeWithoutStream = makeStubRuntime({
      infer: async () => 'todo de un golpe',
    });
    delete (runtimeWithoutStream as { inferStream?: unknown }).inferStream;
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => runtimeWithoutStream,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const handle = (
      responses.find((r) => r.kind === 'load-complete') as LoadCompleteEvent
    ).modelHandle;

    responses.length = 0; // reset

    await core.onMessage({
      kind: 'infer',
      requestId: 'r-infer',
      modelHandle: handle,
      prompt: 'p',
      streamTokens: true,
    } satisfies InferRequest);

    const tokens = responses.filter(
      (r) => r.kind === 'infer-token',
    ) as InferTokenEvent[];
    expect(tokens).toHaveLength(1); // graceful single chunk
    expect(tokens[0]!.cumulativeText).toBe('todo de un golpe');
    const complete = responses.find(
      (r) => r.kind === 'infer-complete',
    ) as InferCompleteEvent;
    expect(complete.text).toBe('todo de un golpe');
  });

  it('infer streaming con runtime que SÍ soporta inferStream: tokens granulares', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime();
    // Augment con inferStream.
    (stubRuntime as unknown as {
      inferStream: (
        m: unknown,
        p: string,
        opts: {
          onToken?: (t: string) => void;
          signal?: AbortSignal;
        },
      ) => Promise<string>;
    }).inferStream = async (_m, _p, opts) => {
      const chunks = ['hola', ' ', 'mundo', '!'];
      for (const c of chunks) {
        if (opts.signal?.aborted) break;
        opts.onToken?.(c);
      }
      return 'hola mundo!';
    };
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const handle = (
      responses.find((r) => r.kind === 'load-complete') as LoadCompleteEvent
    ).modelHandle;

    responses.length = 0;

    await core.onMessage({
      kind: 'infer',
      requestId: 'r-stream',
      modelHandle: handle,
      prompt: 'p',
      streamTokens: true,
    } satisfies InferRequest);

    const tokens = responses.filter(
      (r) => r.kind === 'infer-token',
    ) as InferTokenEvent[];
    expect(tokens.map((t) => t.token)).toEqual(['hola', ' ', 'mundo', '!']);
    expect(tokens[tokens.length - 1]!.cumulativeText).toBe('hola mundo!');
    expect(tokens[tokens.length - 1]!.tokenCount).toBe(4);
    const complete = responses.find(
      (r) => r.kind === 'infer-complete',
    ) as InferCompleteEvent;
    expect(complete.text).toBe('hola mundo!');
  });

  it('abort durante infer: emite infer-complete con aborted:true', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime();
    let receivedSignal: AbortSignal | undefined;
    (stubRuntime as unknown as {
      inferStream: (
        m: unknown,
        p: string,
        opts: {
          onToken?: (t: string) => void;
          signal?: AbortSignal;
        },
      ) => Promise<string>;
    }).inferStream = async (_m, _p, opts) => {
      receivedSignal = opts.signal;
      opts.onToken?.('parcial');
      // Wait until abort fires.
      await new Promise<void>((resolve) => {
        if (opts.signal?.aborted) resolve();
        else opts.signal?.addEventListener('abort', () => resolve());
      });
      return 'parcial';
    };
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const handle = (
      responses.find((r) => r.kind === 'load-complete') as LoadCompleteEvent
    ).modelHandle;

    // Inicia infer.
    const inferPromise = core.onMessage({
      kind: 'infer',
      requestId: 'r-infer',
      modelHandle: handle,
      prompt: 'p',
      streamTokens: true,
    } satisfies InferRequest);

    // Pequeño delay para que el infer arranque + emita el primer token.
    await new Promise((r) => setTimeout(r, 10));

    // Abort.
    await core.onMessage({
      kind: 'abort',
      requestId: 'r-abort',
      abortRequestId: 'r-infer',
    } satisfies AbortRequest);

    await inferPromise;

    expect(receivedSignal?.aborted).toBe(true);
    const ack = responses.find((r) => r.kind === 'abort-ack');
    expect(ack).toBeDefined();
    expect((ack as { found: boolean }).found).toBe(true);
    const complete = responses.find(
      (r) => r.kind === 'infer-complete',
    ) as InferCompleteEvent;
    expect(complete.aborted).toBe(true);
  });

  it('abort sin request activo: found=false en abort-ack', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => makeStubRuntime(),
    });
    await core.onMessage({
      kind: 'abort',
      requestId: 'r-abort',
      abortRequestId: 'nothing-here',
    } satisfies AbortRequest);
    const ack = responses.find((r) => r.kind === 'abort-ack');
    expect((ack as { found: boolean }).found).toBe(false);
  });

  it('infer con runtime que throws → error con infer_failure', async () => {
    const { dispatch, responses } = captureDispatch();
    const stubRuntime = makeStubRuntime({
      infer: async () => {
        throw new Error('ORT session crashed');
      },
    });
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => stubRuntime,
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const handle = (
      responses.find((r) => r.kind === 'load-complete') as LoadCompleteEvent
    ).modelHandle;
    await core.onMessage({
      kind: 'infer',
      requestId: 'r-infer',
      modelHandle: handle,
      prompt: 'p',
    } satisfies InferRequest);
    const err = responses.find((r) => r.kind === 'error');
    expect((err as { errorCode: string }).errorCode).toBe('infer_failure');
  });
});

describe('SlmRuntimeWorkerCore — release', () => {
  it('release de handle existente → release-complete + handle removido', async () => {
    const { dispatch, responses } = captureDispatch();
    const releaseSpy = vi.fn(async () => {});
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () =>
        makeStubRuntime({
          release: releaseSpy,
        }),
    });
    await core.onMessage({
      kind: 'load',
      requestId: 'r-load',
      modelId: 'm',
    } satisfies LoadRequest);
    const handle = (
      responses.find((r) => r.kind === 'load-complete') as LoadCompleteEvent
    ).modelHandle;

    responses.length = 0;
    await core.onMessage({
      kind: 'release',
      requestId: 'r-rel',
      modelHandle: handle,
    } satisfies ReleaseRequest);

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    const ack = responses.find((r) => r.kind === 'release-complete');
    expect(ack).toBeDefined();

    // Después de release, infer con ese handle debe fallar.
    await core.onMessage({
      kind: 'infer',
      requestId: 'r-infer-after',
      modelHandle: handle,
      prompt: 'p',
    } satisfies InferRequest);
    const err = responses.find((r) => r.kind === 'error');
    expect((err as { errorCode: string }).errorCode).toBe('handle_not_found');
  });

  it('release de handle desconocido → release-complete idempotent (sin error)', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch, {
      runtimeFactory: () => makeStubRuntime(),
    });
    await core.onMessage({
      kind: 'release',
      requestId: 'r-rel',
      modelHandle: 'no-existe',
    } satisfies ReleaseRequest);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.kind).toBe('release-complete');
  });
});

describe('SlmRuntimeWorkerCore — ping', () => {
  it('responde con pong + workerVersion', async () => {
    const { dispatch, responses } = captureDispatch();
    const core = createWorkerCore(dispatch);
    await core.onMessage({
      kind: 'ping',
      requestId: 'r-ping',
    } satisfies PingRequest);
    const pong = responses.find((r) => r.kind === 'pong');
    expect(pong).toBeDefined();
    expect((pong as { workerVersion: string }).workerVersion).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });
});
