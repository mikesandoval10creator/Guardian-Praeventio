/**
 * IPER criticidad adapter — single source of truth for the 4-band legacy
 * `criticidad` contract (Crítica / Alta / Media / Baja).
 *
 * WHY this exists (B2, Fase 5): the UI used to classify risks with ad-hoc
 * `P×S` threshold ladders (e.g. `score >= 16 ? 'Crítica' : …`) duplicated
 * across `Matrix.tsx` (seed / AI-suggestion / manual). Those ladders drifted
 * from the canonical DS 44/2024 engine (`calculateIper`) — the same P×S could
 * yield a different band on different screens. This adapter derives the band
 * from `calculateIper` so the **legal classification lives in the IPER engine,
 * not in inline UI thresholds** (the doctrine already documented at
 * `Matrix.tsx`), while PRESERVING the persisted 4-band `criticidad` contract
 * that ~10 downstream modules read (filters, stats, triggers, …).
 *
 * The 5-level DS44 result is collapsed to the 4-band UI vocabulary using a map
 * grounded in the DS44 recommendation text itself (see `CRITICIDAD_BY_IPER_LEVEL`).
 * ISO 31000 (international) banding is a SEPARATE, first-class standard — see
 * `iso31000Band.ts`; the two coexist by design (regime-driven via the
 * regulatory-framework registry). See ADR 0020 (extends ADR 0014).
 */

import { calculateIper, type IperLevel } from './iper';

/** Legacy 4-band criticidad contract persisted in `node.metadata.criticidad`. */
export type IperCriticidad = 'Crítica' | 'Alta' | 'Media' | 'Baja';

/**
 * DS44 5-level → 4-band criticidad. Grounded in the DS44 action thresholds:
 *   - `trivial`  ("no requiere acción")              → Baja
 *   - `tolerable`("no requiere controles adicionales")→ Baja
 *   - `moderado` ("controles dentro de 30 días")     → Media
 *   - `importante`("suspender la actividad")         → Alta
 *   - `intolerable`("detener de inmediato")          → Crítica
 */
export const CRITICIDAD_BY_IPER_LEVEL: Record<IperLevel, IperCriticidad> = {
  trivial: 'Baja',
  tolerable: 'Baja',
  moderado: 'Media',
  importante: 'Alta',
  intolerable: 'Crítica',
};

/** Clamp an arbitrary number to the valid IPER integer domain [1,5]. */
function clampToScale(value: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}

/**
 * Canonical 4-band criticidad for a `probability × severity` pair, derived
 * from the DS44 IPER engine. Defensive: clamps inputs to [1,5] so UI callers
 * (seed / AI suggestions / manual form) never throw on out-of-range data —
 * the previous threshold ladders never threw either.
 */
export function criticidadFromIper(
  probability: number,
  severity: number,
): IperCriticidad {
  const { level } = calculateIper({
    probability: clampToScale(probability),
    severity: clampToScale(severity),
  });
  return CRITICIDAD_BY_IPER_LEVEL[level];
}
