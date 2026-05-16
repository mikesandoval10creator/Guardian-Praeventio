import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  filterPosters,
  findBestPosterMatch,
  getPosterById,
  getPosterTitle,
  isValidPoster,
  POSTER_CATALOG_SEED,
  postersByCategory,
  type PosterDefinition,
} from './posterCatalog.js';

describe('posterCatalog', () => {
  describe('seed', () => {
    it('exporta al menos los 8 protocolos chilenos comunes', () => {
      expect(POSTER_CATALOG_SEED.length).toBeGreaterThanOrEqual(8);
    });

    it('todos los posters seed son válidos', () => {
      for (const poster of POSTER_CATALOG_SEED) {
        expect(isValidPoster(poster)).toBe(true);
      }
    });

    it('todos los IDs son únicos', () => {
      const ids = POSTER_CATALOG_SEED.map((p) => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('todos tienen al menos un step si la animación es step_sequence', () => {
      for (const poster of POSTER_CATALOG_SEED) {
        if (poster.animation.kind === 'step_sequence') {
          expect(poster.animation.steps).toBeDefined();
          expect(poster.animation.steps?.length).toBeGreaterThan(0);
        }
      }
    });

    it('todos los steps tienen order monótono creciente', () => {
      for (const poster of POSTER_CATALOG_SEED) {
        if (poster.animation.kind === 'step_sequence' && poster.animation.steps) {
          const orders = poster.animation.steps.map((s) => s.order);
          const sorted = [...orders].sort((a, b) => a - b);
          expect(orders).toEqual(sorted);
        }
      }
    });
  });

  describe('getPosterById', () => {
    it('devuelve el poster cuando existe', () => {
      const p = getPosterById('epp_arnes_altura');
      expect(p).toBeDefined();
      expect(p?.id).toBe('epp_arnes_altura');
    });

    it('devuelve undefined si no existe', () => {
      expect(getPosterById('no_existe_id_xyz')).toBeUndefined();
    });
  });

  describe('filterPosters', () => {
    it('sin filtros devuelve el catálogo completo', () => {
      const all = filterPosters({});
      expect(all.length).toBe(POSTER_CATALOG_SEED.length);
    });

    it('filtra por categoría', () => {
      const emergency = filterPosters({ category: 'emergency' });
      expect(emergency.length).toBeGreaterThan(0);
      for (const p of emergency) {
        expect(p.category).toBe('emergency');
      }
    });

    it('filtra por tags con AND', () => {
      // Buscar posters que tengan AMBOS tags: emergencia + fuego
      const withBoth = filterPosters({ tags: ['emergencia', 'fuego'] });
      for (const p of withBoth) {
        expect(p.tags).toContain('emergencia');
        expect(p.tags).toContain('fuego');
      }
    });

    it('filtra por onlyWithEmbedding (excluye los sin embedding seed)', () => {
      // El catálogo seed no tiene embeddings cargados todavía
      const matchable = filterPosters({ onlyWithEmbedding: true });
      // No-op para seed actual — al menos garantizar que no rompe
      expect(matchable.length).toBeGreaterThanOrEqual(0);
    });

    it('combina filtros con AND', () => {
      const onlyAltura = filterPosters({
        category: 'work_at_height',
        tags: ['altura'],
      });
      for (const p of onlyAltura) {
        expect(p.category).toBe('work_at_height');
        expect(p.tags).toContain('altura');
      }
    });
  });

  describe('postersByCategory', () => {
    it('atajo para filterPosters por categoría', () => {
      const lockout = postersByCategory('lockout');
      expect(lockout.length).toBeGreaterThan(0);
      for (const p of lockout) {
        expect(p.category).toBe('lockout');
      }
    });
  });

  describe('isValidPoster', () => {
    const valid: PosterDefinition = {
      id: 'test',
      title: 'Test',
      regulationRef: 'TEST',
      category: 'general_rules',
      referenceImageUrl: '/test.jpg',
      animation: { kind: 'step_sequence', steps: [{ order: 1, text: 'paso', durationMs: 1000 }] },
      tags: ['t'],
    };

    it('valida poster bien formado', () => {
      expect(isValidPoster(valid)).toBe(true);
    });

    it('rechaza non-object', () => {
      expect(isValidPoster(null)).toBe(false);
      expect(isValidPoster(undefined)).toBe(false);
      expect(isValidPoster('string')).toBe(false);
      expect(isValidPoster(42)).toBe(false);
    });

    it('rechaza id vacío', () => {
      expect(isValidPoster({ ...valid, id: '' })).toBe(false);
    });

    it('rechaza tags no-array', () => {
      expect(isValidPoster({ ...valid, tags: 'altura' as unknown as string[] })).toBe(false);
    });

    it('rechaza step_sequence sin steps', () => {
      const bad = {
        ...valid,
        animation: { kind: 'step_sequence' as const },
      };
      expect(isValidPoster(bad)).toBe(false);
    });

    it('rechaza step_sequence con steps vacíos', () => {
      const bad = {
        ...valid,
        animation: { kind: 'step_sequence' as const, steps: [] },
      };
      expect(isValidPoster(bad)).toBe(false);
    });
  });

  describe('cosineSimilarity', () => {
    it('vectores idénticos → 1', () => {
      const sim = cosineSimilarity([1, 0, 0], [1, 0, 0]);
      expect(sim).toBeCloseTo(1, 6);
    });

    it('vectores ortogonales → 0', () => {
      const sim = cosineSimilarity([1, 0, 0], [0, 1, 0]);
      expect(sim).toBeCloseTo(0, 6);
    });

    it('vectores opuestos → -1', () => {
      const sim = cosineSimilarity([1, 0, 0], [-1, 0, 0]);
      expect(sim).toBeCloseTo(-1, 6);
    });

    it('vectores escalados son colineales (sim=1) ignorando magnitud', () => {
      const sim = cosineSimilarity([1, 2, 3], [2, 4, 6]);
      expect(sim).toBeCloseTo(1, 6);
    });

    it('vector cero → 0 (sin throw)', () => {
      const sim = cosineSimilarity([0, 0, 0], [1, 2, 3]);
      expect(sim).toBe(0);
    });

    it('arrays vacíos → 0 (sin throw)', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it('throw si longitudes distintas', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
    });
  });

  describe('findBestPosterMatch', () => {
    const catalog: PosterDefinition[] = [
      {
        id: 'a',
        title: 'A',
        regulationRef: '',
        category: 'general_rules',
        referenceImageUrl: '/a.jpg',
        referenceEmbedding: [1, 0, 0],
        animation: { kind: 'step_sequence', steps: [{ order: 1, text: 'x', durationMs: 1000 }] },
        tags: [],
      },
      {
        id: 'b',
        title: 'B',
        regulationRef: '',
        category: 'general_rules',
        referenceImageUrl: '/b.jpg',
        referenceEmbedding: [0, 1, 0],
        animation: { kind: 'step_sequence', steps: [{ order: 1, text: 'y', durationMs: 1000 }] },
        tags: [],
      },
      {
        id: 'c_no_emb',
        title: 'C',
        regulationRef: '',
        category: 'general_rules',
        referenceImageUrl: '/c.jpg',
        // sin referenceEmbedding — debe ser ignorado por el matcher
        animation: { kind: 'step_sequence', steps: [{ order: 1, text: 'z', durationMs: 1000 }] },
        tags: [],
      },
    ];

    it('matchea el mejor candidato si supera el threshold', () => {
      const result = findBestPosterMatch([0.95, 0.1, 0.05], catalog, 0.85);
      expect(result).not.toBeNull();
      expect(result?.poster.id).toBe('a');
      expect(result?.similarity).toBeGreaterThan(0.85);
    });

    it('devuelve null si nada matchea el threshold', () => {
      const result = findBestPosterMatch([0.5, 0.5, 0.5], catalog, 0.95);
      expect(result).toBeNull();
    });

    it('ignora posters sin referenceEmbedding', () => {
      // Embedding exacto del poster sin embedding pre-computado
      // → no debe matchear nada
      const result = findBestPosterMatch([0, 0, 1], catalog, 0.9);
      expect(result).toBeNull();
    });

    it('elige el de mayor similarity cuando varios pasan el threshold', () => {
      // Cerca de A pero también algo de B
      const result = findBestPosterMatch([0.9, 0.4, 0], catalog, 0.5);
      expect(result?.poster.id).toBe('a');
    });
  });

  describe('getPosterTitle', () => {
    it('devuelve título sin i18n (stub)', () => {
      const p = POSTER_CATALOG_SEED[0]!;
      expect(getPosterTitle(p)).toBe(p.title);
    });

    it('acepta función t opcional (futuro)', () => {
      const p = POSTER_CATALOG_SEED[0]!;
      const t = (_key: string, fallback?: string) => fallback ?? '';
      // Por ahora ignora t — solo verificar no-throw
      expect(getPosterTitle(p, t)).toBe(p.title);
    });
  });
});
