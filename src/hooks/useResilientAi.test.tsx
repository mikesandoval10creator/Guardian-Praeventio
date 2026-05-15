// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useResilientAi } from './useResilientAi';
import type { TierAdapter } from '../services/ai/resilientAiOrchestrator';

function ok(text: string, confidence = 0.9): TierAdapter {
  return async () => ({ text, confidence, citations: [] });
}
function fail(msg = 'boom'): TierAdapter {
  return async () => {
    throw new Error(msg);
  };
}

describe('useResilientAi', () => {
  it('ask: estado inicial loading=false, lastResponse=null', () => {
    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: ok('hi') } }),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.lastResponse).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('ask resuelve con tier=slm + lastResponse poblado', async () => {
    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: ok('respuesta SLM', 0.9) } }),
    );

    let response: Awaited<ReturnType<typeof result.current.ask>>;
    await act(async () => {
      response = await result.current.ask('hola');
    });

    expect(response!.tier).toBe('slm');
    expect(response!.text).toBe('respuesta SLM');
    expect(result.current.lastResponse?.text).toBe('respuesta SLM');
    expect(result.current.loading).toBe(false);
  });

  it('ask: SLM falla → cae a Zettelkasten, lastResponse degraded=true', async () => {
    const { result } = renderHook(() =>
      useResilientAi({
        adapters: {
          slm: fail('OOM'),
          zettelkasten: ok('respuesta ZK', 0.6),
        },
      }),
    );
    await act(async () => {
      await result.current.ask('hola');
    });
    expect(result.current.lastResponse?.tier).toBe('zettelkasten');
    expect(result.current.lastResponse?.degraded).toBe(true);
  });

  it('todos los adapters fallan → canned (orchestrator no lanza)', async () => {
    const { result } = renderHook(() =>
      useResilientAi({
        adapters: { slm: fail(), zettelkasten: fail(), firestore: fail(), gemini: fail() },
      }),
    );
    await act(async () => {
      await result.current.ask('palabra-imposible', { domain: 'general' });
    });
    expect(result.current.lastResponse?.tier).toBe('canned');
    expect(result.current.error).toBeNull();
  });

  it('emergencyMode: salta Firestore + Gemini aunque estén disponibles', async () => {
    const firestore = vi.fn();
    const gemini = vi.fn();
    const { result } = renderHook(() =>
      useResilientAi({
        emergencyMode: true,
        adapters: {
          slm: fail(),
          zettelkasten: ok('ZK', 0.6),
          firestore,
          gemini,
        },
      }),
    );
    await act(async () => {
      await result.current.ask('sos', { domain: 'emergency' });
    });
    expect(result.current.lastResponse?.tier).toBe('zettelkasten');
    expect(firestore).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('cancel: abortar query en curso descarta resultado tardío', async () => {
    let resolvePromise: ((value: { text: string; confidence: number }) => void) | null = null;
    const slowAdapter: TierAdapter = () =>
      new Promise((resolve) => {
        resolvePromise = (v) => resolve(v);
      });

    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: slowAdapter } }),
    );

    // Iniciar query (no esperamos).
    let askPromise: Promise<unknown> = Promise.resolve();
    act(() => {
      askPromise = result.current.ask('hola');
    });

    // Esperar a que loading se prenda.
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // Cancelar.
    act(() => {
      result.current.cancel();
    });
    expect(result.current.loading).toBe(false);

    // Resolver la promesa tardía DESPUÉS del cancel.
    resolvePromise!({ text: 'tarde', confidence: 0.9 });
    await askPromise; // Esperar a que se resuelva la promesa interna.

    // lastResponse NO debe haber sido actualizado por el resultado tardío.
    expect(result.current.lastResponse).toBeNull();
  });

  it('reset limpia lastResponse + error sin cancelar', async () => {
    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: ok('texto') } }),
    );
    await act(async () => {
      await result.current.ask('hola');
    });
    expect(result.current.lastResponse).not.toBeNull();

    act(() => {
      result.current.reset();
    });
    expect(result.current.lastResponse).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('ask múltiple en serie: solo el último gana', async () => {
    let p1Resolve: ((v: { text: string; confidence: number }) => void) | null = null;
    let p2Resolve: ((v: { text: string; confidence: number }) => void) | null = null;
    let call = 0;
    const adapter: TierAdapter = () => {
      call++;
      if (call === 1) return new Promise((res) => { p1Resolve = res; });
      return new Promise((res) => { p2Resolve = res; });
    };

    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: adapter } }),
    );

    let q1: Promise<unknown> = Promise.resolve();
    let q2: Promise<unknown> = Promise.resolve();
    act(() => {
      q1 = result.current.ask('first');
    });
    act(() => {
      q2 = result.current.ask('second');
    });

    // Resolver en orden inverso (la 2ª antes que la 1ª).
    await act(async () => {
      p2Resolve!({ text: 'segunda', confidence: 0.9 });
      await q2;
    });
    expect(result.current.lastResponse?.text).toBe('segunda');

    // Resolver la 1ª tarde — debe ser descartada.
    await act(async () => {
      p1Resolve!({ text: 'primera', confidence: 0.9 });
      await q1;
    });
    expect(result.current.lastResponse?.text).toBe('segunda');
  });

  it('Codex P2 fix: late tokens del SLM zombie NO mutan streaming post-fallback', async () => {
    // Simula un SLM que emite 1 token, falla, y LUEGO emite tokens tardíos
    // (caso del bug Codex flagged: orchestrator avanza a fallback mientras
    // inferStream del SLM sigue corriendo en background).
    let lateTokenEmitter: ((t: string) => void) | null = null;
    const slowSlm: TierAdapter = async (query) => {
      // Emite 1 token "inicial" sincronicamente
      query.onStreamToken?.('inicial ');
      // Guarda la callback para llamarla tardíamente
      lateTokenEmitter = query.onStreamToken ?? null;
      // SLM falla → orchestrator cae a zettelkasten
      throw new Error('SLM timeout');
    };
    const zk: TierAdapter = ok('respuesta final ZK', 0.6);

    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: slowSlm, zettelkasten: zk } }),
    );

    await act(async () => {
      await result.current.ask('hola');
    });

    // Después de que orchestrator terminó, simular late tokens del SLM
    // zombie (inferStream sigue corriendo aunque el adapter ya tiró).
    act(() => {
      lateTokenEmitter?.('LATE_TOKEN_1');
      lateTokenEmitter?.('LATE_TOKEN_2');
    });

    // El streaming NO debe contener los late tokens — streaming ya se
    // cerró cuando el orchestrator returns.
    expect(result.current.streaming).toBeNull();
    // Y la respuesta final es la del fallback, no la del SLM.
    expect(result.current.lastResponse?.text).toBe('respuesta final ZK');
    expect(result.current.lastResponse?.tier).toBe('zettelkasten');
  });

  it('queryExtras (domain, tenantId, etc.) llegan al adapter', async () => {
    const adapter = vi.fn(async () => ({ text: 'ok', confidence: 0.9 }));
    const { result } = renderHook(() =>
      useResilientAi({ adapters: { slm: adapter } }),
    );
    await act(async () => {
      await result.current.ask('hola', {
        domain: 'epp',
        tenantId: 'tenant-x',
        userUid: 'user-1',
        context: { projectId: 'p1' },
      });
    });
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hola',
        domain: 'epp',
        tenantId: 'tenant-x',
        userUid: 'user-1',
        context: { projectId: 'p1' },
      }),
    );
  });
});
