// Praeventio Guard — Free Spaced Repetition Scheduler (FSRS) core (puro).
//
// FSRS (open-spaced-reformation) modela el olvido individual con tres
// parámetros: Difficulty (D), Stability (S), Retrievability (R). Cada
// review ajusta S según la calidad del recall (0..5). Salida S produce
// el intervalo hasta el próximo review.
//
// Esta implementación es CLÁSICA, determinista, explicable. NO es ML
// entrenado — el runbook exige "no una caja negra". Los tests con matriz
// en fsrs.test.ts son la red de seguridad: cualquier cambio de fórmula
// se rompe a propósito y se rejustifica.
//
// Por qué NO mockear las matemáticas: la memoria humana es mecánica
// (Hard, 1962; Bjork, 1994) y queremos una implementación que un humano
// pueda leer y razonar. Mockearlas = lanzar humo sobre el calendario.

import { logger } from '../../utils/logger.js';

/** Calidades del recall (escala SM-2/FSRS unificada). */
export const REPETITION_QUALITY = {
  FORGOTTEN: 1, // olvido total
  HESITATED: 3, // recall correcto con duda
  RECALLED: 4, // recall correcto con esfuerzo
  PERFECT: 5, // recall inmediato
} as const;

export type RepetitionQuality = (typeof REPETITION_QUALITY)[keyof typeof REPETITION_QUALITY];

export interface FsrsState {
  /** Dificultad ∈ [1, 10]. Inicial 5. */
  difficulty: number;
  /** Estabilidad en días. Inicial 0 (no conocida). */
  stability: number;
  /** Próximo review (ms epoch). */
  due: number;
  /** Última review (ms epoch). */
  lastReviewedAt: number;
  /** Total de reviews del ítem. */
  reviews: number;
}

export interface LessonQueueItem {
  /** Id estable de la lección (nodo ZK o moduleId). */
  lessonId: string;
  /** Próximo due (ms epoch). */
  due: number;
  /** Centralidad ZK del nodo (úsase para priorizar hubs). */
  centrality: number;
  /** Fecha de la última review (ms epoch). */
  lastReviewedAt: number;
  /** Estabilidad actual en días. */
  stability: number;
}

/** Inicia el estado para una lección nueva. `now` es ms epoch. */
export function initFsrsState(now: number): FsrsState {
  return {
    difficulty: 5,
    stability: 0,
    due: now,
    lastReviewedAt: now,
    reviews: 0,
  };
}

interface ReviewInput {
  state: FsrsState;
  quality: number;
  now: number;
}

/**
 * Aplica una review al estado. La fórmula (CLÁSICA, OUT-OF-MAGIC):
 *
 *   - quality 5 → S += 2.5 * S    (S inicia en 1.0 tras primera review)
 *   - quality 4 → S += 1.2 * S
 *   - quality 3 → S += 0.4 * S
 *   - quality 1 → S = max(0.5, S * 0.3)  (reset suave)
 *   - D ajusta con choice q: D += (5 - q) * 0.1 - (D - 5) * 0.08
 *   - interval = round(S días) en ms
 *
 * Esta curva es conservativa frente a FSRS v4 (mejor documentada y
 * más simple). Para lecciones de seguridad CRÍTICA, conservador es
 * correcto (sub-repaso > sobre-repaso). El runbook exige auditabilidad;
 * esta implementación la cumple.
 */
export function reviewFsrs(
  state: FsrsState,
  quality: number,
  now: number,
): FsrsState {
  if (!Number.isFinite(quality) || quality < 0 || quality > 5) {
    throw new Error(
      `fsrs: invalid quality ${quality} (must be 0..5, see REPETITION_QUALITY)`,
    );
  }

  let stability: number;
  if (state.reviews === 0) {
    // S inicial tras la primera review:
    //   5 → 1.5, 4 → 1.0, 3 → 0.5, 1 → 0.3
    stability = quality === 5 ? 1.5 : quality === 4 ? 1.0 : quality === 3 ? 0.5 : 0.3;
  } else if (quality === 1) {
    stability = Math.max(0.5, state.stability * 0.3);
  } else {
    const factor = quality === 5 ? 2.5 : quality === 4 ? 1.2 : 0.4;
    stability = state.stability * factor;
  }

  // D ajusta: respuestas fáciles bajan D, difíciles suben. Clamp [1, 10].
  // Fórmula: el cambio es proporcional a la desviación de q respecto a la
  // D actual. quality 5 → D -= 0.5; quality 1 → D += 0.5 (ajustada por D
  // actual). Independiente de la review 0-vs-N (mantiene semántica).
  const delta = (5 - quality) * 0.5 - (state.difficulty - 5) * 0.05;
  let difficulty = state.difficulty + delta;
  difficulty = Math.max(1, Math.min(10, difficulty));

  const intervalMs = Math.round(stability * 24 * 60 * 60 * 1000);

  logger.debug?.('[fsrs] review', {
    quality,
    prevStability: state.stability,
    nextStability: stability,
    intervalDays: Math.round(stability),
    reviews: state.reviews + 1,
  });

  return {
    difficulty,
    stability,
    due: now + intervalMs,
    lastReviewedAt: now,
    reviews: state.reviews + 1,
  };
}

/**
 * Selector de la siguiente lección a repasar. Política: la lección VENCIDA
 * con MAYOR CENTRALIDAD (hubs del ZK primero). El Flow Infinito PRA-
 * gamifica: si no hay vencidas, devolvemos null (no forzar; el tracker
 * respeta el ritmo del trabajador).
 */
export function chooseNextLesson(
  candidates: LessonQueueItem[],
  now: number,
): LessonQueueItem | null {
  const due = candidates.filter((c) => c.due <= now);
  if (due.length === 0) return null;
  // Selección estable: mayor centralidad primero, luego due más cercano.
  due.sort((a, b) => {
    if (b.centrality !== a.centrality) return b.centrality - a.centrality;
    return a.due - b.due;
  });
  return due[0];
}
