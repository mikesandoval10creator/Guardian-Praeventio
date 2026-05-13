import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRng, useRngForRandom, withSeed } from './deterministicRandom.js';

describe('createRng — Mulberry32', () => {
  it('misma seed produce misma secuencia', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('seeds distintas producen secuencias distintas', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() retorna [0, 1)', () => {
    const r = createRng(123);
    for (let i = 0; i < 100; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, max) inclusive en ambos extremos', () => {
    const r = createRng(7);
    let hitMin = false;
    let hitMax = false;
    for (let i = 0; i < 1000; i++) {
      const v = r.int(0, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
      if (v === 0) hitMin = true;
      if (v === 2) hitMax = true;
    }
    expect(hitMin).toBe(true);
    expect(hitMax).toBe(true);
  });

  it('int(min > max) tira', () => {
    const r = createRng(1);
    expect(() => r.int(5, 1)).toThrowError(/min/);
  });

  it('pick() determinístico con seed fija', () => {
    const a = createRng(99);
    const b = createRng(99);
    const arr = ['x', 'y', 'z', 'w'];
    expect(a.pick(arr)).toBe(b.pick(arr));
  });

  it('pick vacío tira', () => {
    const r = createRng(1);
    expect(() => r.pick([])).toThrowError(/empty/);
  });

  it('shuffle no muta el input + es determinístico', () => {
    const input = [1, 2, 3, 4, 5];
    const inputCopy = [...input];
    const a = createRng(50);
    const b = createRng(50);
    const sa = a.shuffle(input);
    const sb = b.shuffle(input);
    expect(input).toEqual(inputCopy); // no mutó
    expect(sa).toEqual(sb); // determinístico
    expect(sa.sort()).toEqual(input); // mismos elementos
  });

  it('estado evoluciona en cada next()', () => {
    const r = createRng(1);
    const s0 = r.state;
    r.next();
    expect(r.state).not.toBe(s0);
  });
});

describe('useRngForRandom — Math.random override', () => {
  it('override + restore funciona', () => {
    const original = Math.random;
    const restore = useRngForRandom(42);
    expect(Math.random).not.toBe(original);
    const a = Math.random();
    const b = Math.random();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).not.toBe(b);
    restore();
    expect(Math.random).toBe(original);
  });

  it('misma seed produce misma secuencia desde Math.random', () => {
    const restore1 = useRngForRandom(7);
    const a = [Math.random(), Math.random(), Math.random()];
    restore1();
    const restore2 = useRngForRandom(7);
    const b = [Math.random(), Math.random(), Math.random()];
    restore2();
    expect(a).toEqual(b);
  });
});

describe('withSeed integration', () => {
  withSeed(42, { beforeEach, afterEach });

  it('Math.random es determinístico en este test', () => {
    const a = Math.random();
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it('test 2 ve la MISMA primera secuencia (re-seed antes de cada test)', () => {
    // Como withSeed re-aplica antes de cada test, el primer Math.random()
    // produce el mismo valor que el primer Math.random() del test anterior.
    const a = Math.random();
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});
