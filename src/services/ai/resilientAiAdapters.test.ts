import { describe, it, expect, vi } from 'vitest';
import {
  makeFirestoreTierAdapter,
  makeGeminiTierAdapter,
  makeSlmTierAdapter,
  makeZettelkastenTierAdapter,
} from './resilientAiAdapters';
import {
  answer,
  type AiQuery,
} from './resilientAiOrchestrator';

const query: AiQuery = {
  prompt: 'cómo activo el sos',
  domain: 'emergency',
};

describe('makeZettelkastenTierAdapter (con seed bundle)', () => {
  it('responde usando el seed cuando memory/IDB/firestore no están', async () => {
    const adapter = makeZettelkastenTierAdapter({});
    const r = await adapter({ ...query, prompt: 'sos' });
    expect(r).not.toBeNull();
    expect(r!.text).toContain('grafo');
    expect(r!.confidence).toBeGreaterThan(0);
    expect(r!.citations.length).toBeGreaterThan(0);
    expect(r!.citations[0]!.kind).toBe('node');
  });

  it('retorna null si no encuentra nada (caller cae al siguiente tier)', async () => {
    const adapter = makeZettelkastenTierAdapter({});
    const r = await adapter({
      prompt: 'palabra-imposible-zzzzz',
      domain: 'general',
    });
    expect(r).toBeNull();
  });

  it('cita los nodos encontrados con kind=node', async () => {
    const adapter = makeZettelkastenTierAdapter({});
    const r = await adapter({ ...query, prompt: 'samu' });
    expect(r).not.toBeNull();
    expect(r!.citations.every((c) => c.kind === 'node')).toBe(true);
  });

  it('header cambia por dominio', async () => {
    const adapter = makeZettelkastenTierAdapter({});
    const r1 = await adapter({ prompt: 'sos', domain: 'emergency' });
    const r2 = await adapter({ prompt: 'ley 16744', domain: 'normative' });
    expect(r1?.text).toMatch(/emergencia/i);
    expect(r2?.text).toMatch(/normativa/i);
  });

  it('memory source preferido sobre seed', async () => {
    const memory = vi.fn(async () => [
      { id: 'mem-1', type: 'PROCEDURE', label: 'Procedimiento custom del tenant' },
    ]);
    const adapter = makeZettelkastenTierAdapter({ memory });
    const r = await adapter(query);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Procedimiento custom del tenant');
    expect(r!.confidence).toBeGreaterThan(0.5); // higher than seed
    expect(memory).toHaveBeenCalledOnce();
  });
});

describe('makeFirestoreTierAdapter', () => {
  it('respuesta con docs encontrados', async () => {
    const adapter = makeFirestoreTierAdapter({
      searchKnowledge: async () => [
        {
          id: 'faq-1',
          title: 'Protocolo SOS',
          content: 'Aprieta el botón rojo...',
        },
      ],
    });
    const r = await adapter(query);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Protocolo SOS');
    expect(r!.text).toContain('Aprieta el botón rojo');
    expect(r!.citations[0]!.ref).toBe('faq-1');
  });

  it('sin docs → null', async () => {
    const adapter = makeFirestoreTierAdapter({
      searchKnowledge: async () => [],
    });
    const r = await adapter(query);
    expect(r).toBeNull();
  });

  it('Firestore falla + searchOffline disponible → fallback', async () => {
    const adapter = makeFirestoreTierAdapter({
      searchKnowledge: async () => {
        throw new Error('network down');
      },
      searchOffline: async () => [
        { id: 'offline-1', title: 'Offline doc', content: 'Cache local content' },
      ],
    });
    const r = await adapter(query);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Offline doc');
    expect(r!.text).toContain('cache local');
    expect(r!.confidence).toBeLessThan(0.6); // lower because from fallback
  });

  it('Firestore falla + sin fallback → null', async () => {
    const adapter = makeFirestoreTierAdapter({
      searchKnowledge: async () => {
        throw new Error('boom');
      },
    });
    const r = await adapter(query);
    expect(r).toBeNull();
  });

  it('maxDocs cap respetado', async () => {
    const adapter = makeFirestoreTierAdapter({
      maxDocs: 2,
      searchKnowledge: async () => [
        { id: '1', title: 'A', content: 'a' },
        { id: '2', title: 'B', content: 'b' },
        { id: '3', title: 'C', content: 'c' },
        { id: '4', title: 'D', content: 'd' },
      ],
    });
    const r = await adapter(query);
    expect(r!.citations).toHaveLength(2);
  });
});

describe('makeGeminiTierAdapter', () => {
  it('respuesta exitosa', async () => {
    const adapter = makeGeminiTierAdapter({
      callGemini: async () => ({ text: 'Respuesta Gemini' }),
    });
    const r = await adapter(query);
    expect(r).not.toBeNull();
    expect(r!.text).toBe('Respuesta Gemini');
    expect(r!.confidence).toBe(0.9);
  });

  it('citations propagadas', async () => {
    const adapter = makeGeminiTierAdapter({
      callGemini: async () => ({
        text: 'Texto',
        citations: [
          { uri: 'https://example.com/doc1', title: 'Doc 1' },
          { uri: 'https://example.com/doc2' },
        ],
      }),
    });
    const r = await adapter(query);
    expect(r!.citations).toHaveLength(2);
    expect(r!.citations[0]!.ref).toBe('https://example.com/doc1');
    expect(r!.citations[0]!.label).toBe('Doc 1');
  });

  it('texto vacío → null', async () => {
    const adapter = makeGeminiTierAdapter({
      callGemini: async () => ({ text: '   ' }),
    });
    const r = await adapter(query);
    expect(r).toBeNull();
  });
});

describe('makeSlmTierAdapter (con runtime stub)', () => {
  it('llama runtime + infer; texto vacío → null', async () => {
    const factory = async () => ({
      loadModel: async () => ({ modelId: 'phi', session: {} }),
      infer: async () => '   ',
      release: async () => {},
    });
    const adapter = makeSlmTierAdapter({ runtimeFactory: factory });
    const r = await adapter(query);
    expect(r).toBeNull();
  });

  it('respuesta válida → confidence 0.85', async () => {
    const factory = async () => ({
      loadModel: async () => ({ modelId: 'phi', session: {} }),
      infer: async () => 'Respuesta SLM local',
      release: async () => {},
    });
    const adapter = makeSlmTierAdapter({ runtimeFactory: factory });
    const r = await adapter(query);
    expect(r).not.toBeNull();
    expect(r!.text).toBe('Respuesta SLM local');
    expect(r!.confidence).toBe(0.85);
  });

  it('cachea el handle entre invocaciones (loadModel solo 1 vez)', async () => {
    const loadModel = vi.fn(async () => ({ modelId: 'phi', session: {} }));
    const factory = async () => ({
      loadModel,
      infer: async (_m: unknown, p: string) => `echo:${p}`,
      release: async () => {},
    });
    const adapter = makeSlmTierAdapter({ runtimeFactory: factory });
    await adapter({ prompt: 'first' });
    await adapter({ prompt: 'second' });
    await adapter({ prompt: 'third' });
    expect(loadModel).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration test — end-to-end con el orchestrator real
// ────────────────────────────────────────────────────────────────────────

describe('Integration: full pipeline con adapters reales', () => {
  it('SLM crash → ZK seed responde con header emergencia', async () => {
    const slm = makeSlmTierAdapter({
      runtimeFactory: async () => ({
        loadModel: async () => {
          throw new Error('OOM iOS Safari');
        },
        infer: async () => '',
        release: async () => {},
      }),
    });
    const zk = makeZettelkastenTierAdapter({});

    const r = await answer(
      { prompt: 'cómo llamo al SAMU', domain: 'emergency' },
      { slm, zettelkasten: zk },
    );

    expect(r.tier).toBe('zettelkasten');
    expect(r.degraded).toBe(true);
    expect(r.text).toMatch(/SAMU/);
    expect(r.tierErrors[0]!.tier).toBe('slm');
  });

  it('todos fallan → canned con disclaimer', async () => {
    const slm = makeSlmTierAdapter({
      runtimeFactory: async () => {
        throw new Error('runtime unavailable');
      },
    });
    const zk = makeZettelkastenTierAdapter({});
    const fs = makeFirestoreTierAdapter({
      searchKnowledge: async () => {
        throw new Error('no network');
      },
    });
    const gemini = makeGeminiTierAdapter({
      callGemini: async () => {
        throw new Error('no network');
      },
    });

    const r = await answer(
      { prompt: 'palabra-imposible-xxxx', domain: 'general' },
      { slm, zettelkasten: zk, firestore: fs, gemini },
    );
    expect(r.tier).toBe('canned');
    expect(r.text).toContain('No tengo información suficiente');
  });
});
