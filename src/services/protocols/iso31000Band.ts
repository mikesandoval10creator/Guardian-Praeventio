/**
 * ISO 31000:2018 risk banding — international standard, first-class alongside
 * the Chilean DS 44/2024 IPER engine (`iper.ts`).
 *
 * WHY this exists (B2, Fase 5): the 5×5 executive matrix (`RiskMatrix5x5.tsx`)
 * carried its banding inline as an anonymous `severityForCell` helper — a
 * "third scheme" relative to DS44 and to `Matrix.tsx`'s ad-hoc ladder.
 * Promoting it to a named, tested pure engine makes ISO 31000 a recognized
 * canonical (not an inline scheme) so it can be selected by the active
 * regulatory regime (geolocalización de normativa) without duplication.
 *
 * The two standards COEXIST by design: an ISO-certified tenant sees the ISO
 * 31000 4-band view; a Chilean tenant sees the DS44 IPER classification. See
 * ADR 0020 (extends ADR 0014). Score = probability × impact, 1..25.
 *   - Bajo    (low):     1–4
 *   - Medio   (medium):  5–9
 *   - Alto    (high):    10–15
 *   - Extremo (extreme): 16–25
 */

export type Iso31000Band = 'low' | 'medium' | 'high' | 'extreme';

/**
 * Classify a `probability × impact` pair into the ISO 31000 4-band scheme.
 * Pure and deterministic. Inputs are expected in [1,5]; the score thresholds
 * are evaluated on the raw product so any positive integers degrade sanely.
 */
export function iso31000Band(probability: number, impact: number): Iso31000Band {
  const score = probability * impact;
  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 15) return 'high';
  return 'extreme';
}
