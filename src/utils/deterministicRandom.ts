// Praeventio Guard — Sprint 45 E.5 P2 H32: Deterministic Seeds.
//
// Cierra E.5 P2 H32 del plan: tests que dependen de Math.random()
// (fuzzers, dedup heurísticas, jitter de UI) son no-deterministicos y
// flaky. Este módulo expone un PRNG seedable (Mulberry32) y helpers
// que reemplazan Math.random() de forma transparente cuando el caller
// inyecta una seed.
//
// Mulberry32 → 32-bit state, ciclo 2^32, distribución uniforme ok para
// tests y demo data (NO crypto). Es 30-50x más rápido que Xorshift y
// tiene mejor distribución en pequeños rangos.
//
// API:
//   const rng = createRng(42);     // seed entera
//   rng.next();                     // [0, 1)
//   rng.int(0, 99);                 // entero inclusive
//   rng.pick(['a', 'b', 'c']);      // elemento aleatorio
//   rng.shuffle([1,2,3,4]);         // copia + Fisher-Yates
//
// Pattern recomendado para tests:
//
//   import { createRng, useRngForRandom } from '@/utils/deterministicRandom';
//   it('flaky thing now deterministic', () => {
//     const restore = useRngForRandom(123);
//     const result = thingUnderTestThatUsesMathRandom();
//     expect(result).toEqual([...]);
//     restore();
//   });

export interface SeededRng {
  /** Float [0, 1). */
  next(): number;
  /** Entero inclusivo entre min y max. */
  int(min: number, max: number): number;
  /** Pick aleatorio de un array (no muta). */
  pick<T>(arr: ReadonlyArray<T>): T;
  /** Copia shuffleada (Fisher-Yates). */
  shuffle<T>(arr: ReadonlyArray<T>): T[];
  /** Estado interno expuesto solo para debugging / snapshot. */
  readonly state: number;
}

/**
 * Mulberry32 PRNG. Una implementación cortita y rápida.
 * Referencia: https://gist.github.com/tommyettinger/46a3ad0b40f99a5e51b3
 */
export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int(min: number, max: number): number {
      if (min > max) throw new Error(`int: min ${min} > max ${max}`);
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(arr: ReadonlyArray<T>): T {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)] as T;
    },
    shuffle<T>(arr: ReadonlyArray<T>): T[] {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    get state() {
      return state;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Math.random override helper para tests
// ────────────────────────────────────────────────────────────────────────

const ORIGINAL_RANDOM = Math.random;

/**
 * Reemplaza Math.random globalmente con la salida del PRNG seedeado.
 * Devuelve un `restore()` que el caller DEBE invocar (idealmente en
 * `afterEach`). No usar en código productivo — solo tests.
 */
export function useRngForRandom(seed: number): () => void {
  const rng = createRng(seed);
  Math.random = () => rng.next();
  return () => {
    Math.random = ORIGINAL_RANDOM;
  };
}

/**
 * Vitest setup helper — wrap describe block para que cada test corra
 * con seed determinístico.
 *
 *   describe('flaky suite', () => {
 *     withSeed(42);
 *     it('reproducible', () => { ... });
 *   });
 *
 * Requiere `beforeEach`/`afterEach` del runner; usa vi.* si se inyecta.
 */
export function withSeed(seed: number, hooks?: { beforeEach: (fn: () => void) => void; afterEach: (fn: () => void) => void }): void {
  // Si vitest's globals están disponibles, los usamos directamente.
   
  const g = globalThis as any;
  const beforeEach = hooks?.beforeEach ?? g.beforeEach;
  const afterEach = hooks?.afterEach ?? g.afterEach;
  if (typeof beforeEach !== 'function' || typeof afterEach !== 'function') {
    throw new Error('withSeed requires beforeEach/afterEach from test runner');
  }
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = useRngForRandom(seed);
  });
  afterEach(() => {
    restore();
  });
}
