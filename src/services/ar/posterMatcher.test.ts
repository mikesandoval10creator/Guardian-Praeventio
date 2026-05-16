import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @mediapipe/tasks-vision ANTES de importar el módulo bajo test —
// el lazy import dentro de init() resuelve al mock.
const mockEmbed = vi.fn();
const mockEmbedForVideo = vi.fn();
const mockClose = vi.fn();
const mockCreateFromOptions = vi.fn();
const mockForVisionTasks = vi.fn();

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: (...args: unknown[]) => mockForVisionTasks(...args),
  },
  ImageEmbedder: {
    createFromOptions: (...args: unknown[]) => mockCreateFromOptions(...args),
  },
}));

import {
  closePosterMatcher,
  getPosterMatcher,
  matchPosterFrame,
  PosterMatcher,
} from './posterMatcher.js';
import type { PosterDefinition } from './posterCatalog.js';

const CATALOG: PosterDefinition[] = [
  {
    id: 'poster_a',
    title: 'Poster A',
    regulationRef: 'DS 1',
    category: 'general_rules',
    referenceImageUrl: '/a.jpg',
    referenceEmbedding: [1, 0, 0, 0],
    animation: {
      kind: 'step_sequence',
      steps: [{ order: 1, text: 'paso', durationMs: 1000 }],
    },
    tags: ['a'],
  },
  {
    id: 'poster_b',
    title: 'Poster B',
    regulationRef: 'DS 2',
    category: 'general_rules',
    referenceImageUrl: '/b.jpg',
    referenceEmbedding: [0, 1, 0, 0],
    animation: {
      kind: 'step_sequence',
      steps: [{ order: 1, text: 'paso', durationMs: 1000 }],
    },
    tags: ['b'],
  },
  {
    id: 'poster_c_no_emb',
    title: 'Poster C sin embedding',
    regulationRef: 'DS 3',
    category: 'general_rules',
    referenceImageUrl: '/c.jpg',
    animation: {
      kind: 'step_sequence',
      steps: [{ order: 1, text: 'paso', durationMs: 1000 }],
    },
    tags: ['c'],
  },
];

function makeVideoElement(): HTMLVideoElement {
  // En entorno test jsdom, basta un objeto que duck-type como video.
  return {} as HTMLVideoElement;
}

beforeEach(() => {
  mockEmbed.mockReset();
  mockEmbedForVideo.mockReset();
  mockClose.mockReset();
  mockCreateFromOptions.mockReset();
  mockForVisionTasks.mockReset();

  // Defaults: forVisionTasks devuelve un vision object placeholder,
  // createFromOptions devuelve un embedder mock.
  mockForVisionTasks.mockResolvedValue({});
  mockCreateFromOptions.mockResolvedValue({
    embed: mockEmbed,
    embedForVideo: mockEmbedForVideo,
    close: mockClose,
  });

  // Reset singleton entre tests.
  closePosterMatcher();
});

afterEach(() => {
  closePosterMatcher();
});

describe('PosterMatcher', () => {
  describe('init', () => {
    it('inicializa una vez aunque se llame múltiples veces concurrentemente', async () => {
      const matcher = new PosterMatcher();
      await Promise.all([matcher.init(), matcher.init(), matcher.init()]);
      // createFromOptions debe haberse llamado solo una vez
      expect(mockCreateFromOptions).toHaveBeenCalledTimes(1);
    });

    it('throw si computeEmbedding después de close()', async () => {
      const matcher = new PosterMatcher();
      await matcher.init();
      matcher.close();
      await expect(matcher.computeEmbedding(makeVideoElement())).rejects.toThrow(
        /cerrada/i,
      );
    });
  });

  describe('computeEmbedding', () => {
    it('devuelve el embedding como Array de floats', async () => {
      mockEmbed.mockReturnValue({
        embeddings: [{ floatEmbedding: new Float32Array([0.5, 0.6, 0.7, 0.8]) }],
      });

      const matcher = new PosterMatcher();
      const emb = await matcher.computeEmbedding(makeVideoElement());

      // Float32Array → JS number conversion incurs ~1e-7 precision drift,
      // así que toEqual estricto falla. Verificamos cardinalidad + cerca.
      expect(emb).toHaveLength(4);
      expect(emb[0]).toBeCloseTo(0.5, 5);
      expect(emb[1]).toBeCloseTo(0.6, 5);
      expect(emb[2]).toBeCloseTo(0.7, 5);
      expect(emb[3]).toBeCloseTo(0.8, 5);
      expect(mockEmbed).toHaveBeenCalledTimes(1);
    });

    it('throw si el embedder no devuelve embedding', async () => {
      mockEmbed.mockReturnValue({ embeddings: [] });

      const matcher = new PosterMatcher();
      await expect(matcher.computeEmbedding(makeVideoElement())).rejects.toThrow();
    });

    it('usa embedForVideo cuando runningMode=VIDEO', async () => {
      mockEmbedForVideo.mockReturnValue({
        embeddings: [{ floatEmbedding: [0.1, 0.2, 0.3, 0.4] }],
      });

      const matcher = new PosterMatcher({ runningMode: 'VIDEO' });
      await matcher.computeEmbedding(makeVideoElement());

      expect(mockEmbedForVideo).toHaveBeenCalledTimes(1);
      expect(mockEmbed).not.toHaveBeenCalled();
    });
  });

  describe('matchFrame', () => {
    it('devuelve el mejor match cuando el embedding es cercano a un poster', async () => {
      mockEmbed.mockReturnValue({
        embeddings: [{ floatEmbedding: [0.95, 0.05, 0.05, 0.05] }], // cerca de poster_a [1,0,0,0]
      });

      const matcher = new PosterMatcher({ thresholdSimilarity: 0.85 });
      const result = await matcher.matchFrame(makeVideoElement(), CATALOG);

      expect(result).not.toBeNull();
      expect(result?.poster.id).toBe('poster_a');
      expect(result?.similarity).toBeGreaterThan(0.85);
      expect(result?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('devuelve null cuando no supera el threshold', async () => {
      mockEmbed.mockReturnValue({
        embeddings: [{ floatEmbedding: [0.5, 0.5, 0.5, 0.5] }],
      });

      const matcher = new PosterMatcher({ thresholdSimilarity: 0.99 });
      const result = await matcher.matchFrame(makeVideoElement(), CATALOG);

      expect(result).toBeNull();
    });

    it('ignora posters sin referenceEmbedding', async () => {
      // Embedding que sería match perfecto SI el poster_c lo tuviera —
      // pero no lo tiene, así que el matcher debe ignorarlo.
      mockEmbed.mockReturnValue({
        embeddings: [{ floatEmbedding: [0, 0, 1, 0] }],
      });

      const matcher = new PosterMatcher({ thresholdSimilarity: 0.9 });
      const result = await matcher.matchFrame(makeVideoElement(), CATALOG);

      expect(result).toBeNull();
    });

    it('elige el de mayor similarity cuando varios pasan threshold', async () => {
      // Sim con poster_a [1,0,0,0]: alto. Sim con poster_b [0,1,0,0]: medio.
      mockEmbed.mockReturnValue({
        embeddings: [{ floatEmbedding: [0.9, 0.4, 0, 0] }],
      });

      const matcher = new PosterMatcher({ thresholdSimilarity: 0.3 });
      const result = await matcher.matchFrame(makeVideoElement(), CATALOG);

      expect(result?.poster.id).toBe('poster_a');
    });
  });

  describe('close', () => {
    it('llama close del embedder', async () => {
      const matcher = new PosterMatcher();
      await matcher.init();
      matcher.close();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('es seguro llamarlo varias veces', async () => {
      const matcher = new PosterMatcher();
      await matcher.init();
      matcher.close();
      matcher.close();
      // Sin crash; close del embedder llamado solo una vez (porque queda en null tras la primera)
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getPosterMatcher singleton', () => {
  it('devuelve la misma instancia en llamadas sucesivas', () => {
    const a = getPosterMatcher();
    const b = getPosterMatcher();
    expect(a).toBe(b);
  });

  it('closePosterMatcher resetea el singleton', () => {
    const a = getPosterMatcher();
    closePosterMatcher();
    const b = getPosterMatcher();
    expect(a).not.toBe(b);
  });
});

describe('matchPosterFrame helper', () => {
  it('encapsula init + matchFrame', async () => {
    mockEmbed.mockReturnValue({
      embeddings: [{ floatEmbedding: [0.95, 0.05, 0.05, 0.05] }],
    });

    const result = await matchPosterFrame(makeVideoElement(), CATALOG);
    expect(result?.poster.id).toBe('poster_a');
  });

  it('respeta el threshold pasado al helper', async () => {
    mockEmbed.mockReturnValue({
      embeddings: [{ floatEmbedding: [0.6, 0.4, 0, 0] }],
    });

    // singleton fue creado en test previo — cerrar para que el threshold se reaplique
    closePosterMatcher();
    const tight = await matchPosterFrame(makeVideoElement(), CATALOG, {
      thresholdSimilarity: 0.99,
    });
    expect(tight).toBeNull();
  });
});
