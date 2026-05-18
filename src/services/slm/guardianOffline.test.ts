/**
 * Tests for GuardianOfflineService — Sprint 26 Bucket ZZ.
 *
 * Cobertura:
 *   1. fromEnv null cuando SLM_OFFLINE_ENABLED off
 *   2. fromEnv retorna instancia cuando flag on
 *   3. ask() cache hit returns cached + source='cache'
 *   4. ask() retrieval rankea por keywords del prompt
 *   5. ask() devuelve citations de chunks usados
 *   6. getFAQ retorna lista no vacia
 *   7. preload no-op si ya pre-cargado (idempotente)
 *   8. AbortSignal honored — pre-aborted cae a corpus-only
 *   9. Empty corpus â†’ ask sigue funcionando con FAQ + adapter
 *  10. Corpus chunks parseo correcto desde JSON
 *  11. FAQ exact match â†’ source='faq'
 *  12. Sin adapter â†’ corpus-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GuardianOfflineService,
  rankChunks,
  type CorpusChunk,
  type GuardianAdapterLike,
  type GuardianCacheLike,
} from './guardianOffline';

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SAMPLE_CHUNKS: CorpusChunk[] = [
  {
    id: 'chunk-001',
    topic: 'primeros_auxilios.sangrado_abundante',
    keywords: ['sangrado', 'hemorragia', 'presion'],
    text: 'Sangrado abundante: aplicar presión directa con tela limpia.',
    citation: 'DS 109 + Cruz Roja Chile',
  },
  {
    id: 'chunk-002',
    topic: 'evacuacion.salida_bloqueada',
    keywords: ['evacuacion', 'salida', 'bloqueada'],
    text: 'Si la salida principal está bloqueada, identificar segunda salida.',
    citation: 'NCh 1410',
  },
  {
    id: 'chunk-003',
    topic: 'peligro.gas_olor',
    keywords: ['gas', 'olor', 'h2s'],
    text: 'Olor a huevo podrido = H2S, evacuar inmediato.',
    citation: 'DS 148 + GHS',
  },
];

function makeFakeFetch(corpus: { chunks: CorpusChunk[] } | null) {
  return async (_url: string | URL | Request) => {
    if (!corpus) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify({
      version: '1.0',
      meta: { source: 'test', lastUpdated: '2026-05-04', license: 'test' },
      chunks: corpus.chunks,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

class MemCache implements GuardianCacheLike {
  private store = new Map<string, string>();
  async get(k: string): Promise<string | null> { return this.store.get(k) ?? null; }
  async set(k: string, v: string): Promise<void> { this.store.set(k, v); }
  size(): number { return this.store.size; }
  raw(): Map<string, string> { return this.store; }
}

function makeAdapter(text = 'respuesta sintetica'): GuardianAdapterLike & { calls: number } {
  let calls = 0;
  const a: GuardianAdapterLike & { calls: number } = {
    calls: 0,
    async preload() { /* no-op */ },
    async generate(opts) {
      calls += 1;
      a.calls = calls;
      if (opts.onToken) opts.onToken(text);
      if (opts.signal?.aborted) return '';
      return text;
    },
  };
  return a;
}

// â”€â”€â”€ tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('GuardianOfflineService.fromEnv', () => {
  beforeEach(() => {
    delete process.env.SLM_OFFLINE_ENABLED;
    delete globalThis.__SLM_OFFLINE_ENABLED__;
  });

  it('returns null when SLM_OFFLINE_ENABLED is off', () => {
    expect(GuardianOfflineService.fromEnv()).toBeNull();
  });

  it('returns an instance when flag on (process.env)', () => {
    process.env.SLM_OFFLINE_ENABLED = 'true';
    const svc = GuardianOfflineService.fromEnv({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
      cacheImpl: new MemCache(),
    });
    expect(svc).not.toBeNull();
    expect(svc).toBeInstanceOf(GuardianOfflineService);
  });

  it('returns an instance when flag on (globalThis override)', () => {
    // Cast a boolean — el flag global está tipado como boolean | undefined;
    // antes el test usaba '1' (string truthy) y rompía el typecheck.
    globalThis.__SLM_OFFLINE_ENABLED__ = true;
    const svc = GuardianOfflineService.fromEnv({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
    });
    expect(svc).not.toBeNull();
  });
});

describe('rankChunks', () => {
  it('ranks chunks by keyword overlap', () => {
    const out = rankChunks('hay sangrado abundante en la herida', SAMPLE_CHUNKS);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].id).toBe('chunk-001');
  });

  it('returns empty for irrelevant prompt', () => {
    const out = rankChunks('xyzzy plugh foobar', SAMPLE_CHUNKS);
    expect(out).toEqual([]);
  });

  it('respects topK limit', () => {
    const out = rankChunks('sangrado evacuacion gas', SAMPLE_CHUNKS, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe('GuardianOfflineService.ask', () => {
  it('returns cached answer with source=cache', async () => {
    const cache = new MemCache();
    const adapter = makeAdapter('nueva respuesta');
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter,
      cacheImpl: cache,
    });

    // Primer ask para popular cache
    const first = await svc.ask({ prompt: 'pregunta sin match faq xyzplugh' });
    expect(first.source).toBe('slm');
    expect(adapter.calls).toBe(1);

    // Segundo ask con mismo prompt â†’ cache hit
    const second = await svc.ask({ prompt: 'pregunta sin match faq xyzplugh' });
    expect(second.source).toBe('cache');
    expect(adapter.calls).toBe(1); // no se regenero
  });

  it('uses retrieval and surfaces citations', async () => {
    const adapter = makeAdapter('responde sobre sangrado');
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    const r = await svc.ask({ prompt: 'sangrado masivo dificil controlar' });
    expect(r.citations).toContain('DS 109 + Cruz Roja Chile');
  });

  it('matches FAQ exact-ish question â†’ source=faq', async () => {
    const adapter = makeAdapter();
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    const r = await svc.ask({
      prompt: '¿Qué hago con un trabajador con sangrado abundante?',
    });
    expect(r.source).toBe('faq');
    expect(r.citations.length).toBeGreaterThan(0);
    expect(adapter.calls).toBe(0); // FAQ no llama al SLM
  });

  it('falls back to corpus-only when no adapter is provided', async () => {
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: undefined as any, // forzar null
      cacheImpl: new MemCache(),
    });
    // Construct con explicit null:
    const svcNoAdapter = new (class extends GuardianOfflineService {
      constructor() {
        super({
          fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
          cacheImpl: new MemCache(),
        });
        // @ts-expect-error - override private adapter for the test
        this.adapter = null;
      }
    })();
    const r = await svcNoAdapter.ask({ prompt: 'sangrado herida abierta xpz' });
    expect(r.source).toBe('corpus-only');
    expect(r.answer).toContain('presión directa');
  });

  it('honors a pre-aborted AbortSignal (corpus-only fallback)', async () => {
    const adapter = makeAdapter();
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    const ctl = new AbortController();
    ctl.abort();
    const r = await svc.ask({ prompt: 'gas h2s emergencia xpz', signal: ctl.signal });
    expect(r.source).toBe('corpus-only');
    expect(adapter.calls).toBe(0);
  });

  it('handles empty corpus gracefully (FAQ still works)', async () => {
    const adapter = makeAdapter();
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: [] }) as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    // FAQ match should still return
    const faq = await svc.ask({
      prompt: '¿Cómo evacuamos esta zona si la salida principal está bloqueada?',
    });
    expect(faq.source).toBe('faq');

    // Sin FAQ match y corpus vacio: SLM aun corre (no hay retrieval)
    const slm = await svc.ask({ prompt: 'pregunta novedad sin chunks abc xyz' });
    expect(slm.source).toBe('slm');
  });

  it('returns durationMs', async () => {
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
      cacheImpl: new MemCache(),
    });
    const r = await svc.ask({ prompt: 'sangrado xyz unique' });
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('GuardianOfflineService.getFAQ', () => {
  it('returns non-empty FAQ list', () => {
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
      cacheImpl: new MemCache(),
    });
    const faq = svc.getFAQ();
    expect(faq.length).toBeGreaterThan(0);
    expect(faq[0]).toHaveProperty('question');
    expect(faq[0]).toHaveProperty('answer');
    expect(faq[0]).toHaveProperty('citations');
  });

  it('returns a copy (mutation safe)', () => {
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
      cacheImpl: new MemCache(),
    });
    const a = svc.getFAQ();
    const before = a.length;
    a.pop();
    const b = svc.getFAQ();
    expect(b.length).toBe(before);
  });
});

describe('GuardianOfflineService.preload', () => {
  it('is idempotent', async () => {
    const fetchSpy = vi.fn(makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as any);
    const adapter = makeAdapter();
    const preloadSpy = vi.spyOn(adapter, 'preload');
    const svc = new GuardianOfflineService({
      fetchImpl: fetchSpy as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    await svc.preload();
    await svc.preload();
    // Corpus se carga una sola vez; adapter.preload puede correr ambas
    // veces (es idempotente del lado del adapter, no del service).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(preloadSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('survives adapter preload error (corpus still loaded)', async () => {
    const adapter: GuardianAdapterLike = {
      preload: async () => { throw new Error('boom'); },
      generate: async () => 'ok',
    };
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter,
      cacheImpl: new MemCache(),
    });
    await expect(svc.preload()).resolves.not.toThrow();
  });
});

describe('GuardianOfflineService.getCached', () => {
  it('returns null for un-cached prompts', async () => {
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter(),
      cacheImpl: new MemCache(),
    });
    const r = await svc.getCached('nada-cacheado');
    expect(r).toBeNull();
  });

  it('returns cached value after ask()', async () => {
    const cache = new MemCache();
    const svc = new GuardianOfflineService({
      fetchImpl: makeFakeFetch({ chunks: SAMPLE_CHUNKS }) as unknown as typeof fetch,
      adapter: makeAdapter('respuesta cacheada'),
      cacheImpl: cache,
    });
    await svc.ask({ prompt: 'pregunta unica xpz123' });
    const r = await svc.getCached('pregunta unica xpz123');
    expect(r).toBe('respuesta cacheada');
  });
});
