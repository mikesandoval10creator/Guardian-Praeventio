// @vitest-environment node
// Praeventio Guard — FSRS core (tarea [Mejora-ZK] Repetición espaciada).
//
// Tests de la red de seguridad del algoritmo. La fórmula es CLÁSICA
// (consultable, no ML entrenado), así que los casos canónicos que
// valen las cuentas:
//
//
//   - quality 5 → nextStability multiplica x2.5 (caso muy fácil)
//   - quality 4 → x1.2 (estándar)
//   - quality 3 → x0.4 (vacilación; sobrevive pero acorta)
//   - quality 1 → reset a min(0.5, S * 0.3) (olvido)
//   - interval = S días, due = now + intervalMs
//   - difficulty ∈ [1, 10] siempre
//   - Tras reset (quality 1), due se vuelve ahora (0.5d ≈ 12h)
//
// Estos casos garantizan que el comportamiento sea legible y testeable
// en CI sin tocar la BD.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initFsrsState,
  reviewFsrs,
  chooseNextLesson,
  REPETITION_QUALITY,
  type FsrsState,
  type LessonQueueItem,
} from './fsrs.js';

const NOW = new Date('2026-08-04T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('initFsrsState', () => {
  it('estado inicial: D=5, S=0, due=now, sin reviews', () => {
    const s = initFsrsState(NOW);
    expect(s.difficulty).toBe(5);
    expect(s.stability).toBe(0);
    expect(s.due).toBe(NOW);
    expect(s.lastReviewedAt).toBe(NOW);
    expect(s.reviews).toBe(0);
  });
});

describe('reviewFsrs — primera review (S inicial)', () => {
  it('quality=5 → S=1.5, due ≈ +1.5 días', () => {
    const s = reviewFsrs(initFsrsState(NOW), REPETITION_QUALITY.PERFECT, NOW);
    expect(s.stability).toBe(1.5);
    expect(s.due - NOW).toBe(Math.round(1.5 * DAY));
    expect(s.reviews).toBe(1);
  });

  it('quality=4 → S=1.0, due ≈ 1 día', () => {
    const s = reviewFsrs(initFsrsState(NOW), REPETITION_QUALITY.RECALLED, NOW);
    expect(s.stability).toBe(1.0);
    expect(s.due - NOW).toBe(DAY);
  });

  it('quality=3 → S=0.5, due ≈ 0.5 días', () => {
    const s = reviewFsrs(initFsrsState(NOW), REPETITION_QUALITY.HESITATED, NOW);
    expect(s.stability).toBe(0.5);
    expect(s.due - NOW).toBe(Math.round(0.5 * DAY));
  });

  it('quality=1 → S=0.3 (olvido), due ≈ 0.3 días', () => {
    const s = reviewFsrs(initFsrsState(NOW), REPETITION_QUALITY.FORGOTTEN, NOW);
    expect(s.stability).toBe(0.3);
    expect(s.due - NOW).toBe(Math.round(0.3 * DAY));
  });
});

describe('reviewFsrs — glosario de progression', () => {
  let s: FsrsState;

  beforeEach(() => {
    s = reviewFsrs(initFsrsState(NOW), REPETITION_QUALITY.PERFECT, NOW);
  });

  it('quality=5 (perfect) → S x2.5', () => {
    const next = reviewFsrs(s, REPETITION_QUALITY.PERFECT, NOW);
    expect(next.stability).toBeCloseTo(1.5 * 2.5, 5);
  });

  it('quality=4 (recalled) → S x1.2', () => {
    const next = reviewFsrs(s, REPETITION_QUALITY.RECALLED, NOW);
    expect(next.stability).toBeCloseTo(1.5 * 1.2, 5);
  });

  it('quality=3 (hesitated) → S x0.4', () => {
    const next = reviewFsrs(s, REPETITION_QUALITY.HESITATED, NOW);
    expect(next.stability).toBeCloseTo(1.5 * 0.4, 5);
  });

  it('quality=1 (olvido) → reset a min(0.5, S*0.3)', () => {
    const next = reviewFsrs(s, REPETITION_QUALITY.FORGOTTEN, NOW);
    expect(next.stability).toBe(0.5); // 1.5 * 0.3 = 0.45 → clamp 0.5
  });

  it('difficulty ∈ [1, 10] en cualquier respuesta', () => {
    for (const q of [1, 3, 4, 5]) {
      const next = reviewFsrs(s, q, NOW);
      expect(next.difficulty).toBeGreaterThanOrEqual(1);
      expect(next.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('difficulty ∈ [1, 10] se mantiene tras ciclones de olvidos', () => {
    // Stress: 20 reviews de q=1 seguidas; D debe subir mucho, pero no
    // escapar de su rango max=10 (clamp).
    let cur = s;
    for (let i = 0; i < 20; i++) cur = reviewFsrs(cur, 1, NOW);
    expect(cur.difficulty).toBeLessThanOrEqual(10);
    expect(cur.difficulty).toBeGreaterThan(s.difficulty);
  });

  it('due siempre dentro del futuro (post-now)', () => {
    const next = reviewFsrs(s, 4, NOW);
    expect(next.due).toBeGreaterThan(NOW);
  });

  it('rechaza quality fuera de 0..5', () => {
    expect(() => reviewFsrs(s, -1, NOW)).toThrow();
    expect(() => reviewFsrs(s, 6, NOW)).toThrow();
  });
});

describe('chooseNextLesson', () => {
  const buildQueue = (states: Array<{ lessonId: string; due: number; centrality: number; lastReviewedAt: number; stability: number }>): LessonQueueItem[] =>
    states;

  it('devuelve la lección vencida con mayor centralidad', () => {
    const queue = buildQueue([
      { lessonId: 'l-1', due: NOW - 5 * DAY, centrality: 1, lastReviewedAt: NOW - 10 * DAY, stability: 1 },
      { lessonId: 'l-2', due: NOW - 1 * DAY, centrality: 5, lastReviewedAt: NOW - 6 * DAY, stability: 1 },
      { lessonId: 'l-3', due: NOW + 5 * DAY, centrality: 10, lastReviewedAt: NOW - 1 * DAY, stability: 1 },
    ]);
    expect(chooseNextLesson(queue, NOW)?.lessonId).toBe('l-2'); // vencida, mayor centralidad
  });

  it('empates de centralidad se desempatan por due más temprano', () => {
    const queue = buildQueue([
      { lessonId: 'a', due: NOW - 5 * DAY, centrality: 2, lastReviewedAt: NOW, stability: 1 },
      { lessonId: 'b', due: NOW - 1 * DAY, centrality: 2, lastReviewedAt: NOW, stability: 1 },
    ]);
    expect(chooseNextLesson(queue, NOW)?.lessonId).toBe('a');
  });

  it('sin vencidas devuelve null (no forzar repasar)', () => {
    const queue = buildQueue([
      { lessonId: 'x', due: NOW + 1 * DAY, centrality: 1, lastReviewedAt: NOW, stability: 1 },
    ]);
    expect(chooseNextLesson(queue, NOW)).toBeNull();
  });

  it('queue vacía devuelve null', () => {
    expect(chooseNextLesson([], NOW)).toBeNull();
  });
});
