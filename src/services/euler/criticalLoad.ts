/**
 * Euler critical buckling load — Fase 3 del plan Euler-Matrix.
 *
 * P_cr = π² · E · I / (K · L)²
 *
 * Aplicación a prevención: estima el límite de estabilidad elástica
 * de andamios, puntales y estructuras provisionales. Si la carga
 * aplicada se acerca a P_cr, el elemento puede pandear (colapso
 * súbito sin previo aviso). En sitios de construcción este es el
 * fallo más letal porque NO da tiempo a evacuar.
 *
 * Origen: Leonhard Euler 1744 ("Methodus inveniendi lineas curvas
 * maximi minimive proprietate gaudentes"). Generalizado posteriormente
 * por Engesser para columnas inelásticas (fuera del scope aquí —
 * usamos solo el régimen elástico).
 *
 * NO es seguro al 100%: el modelo asume columna ideal sin
 * imperfecciones, material homogéneo, carga axial pura. En obra
 * real aplicar siempre factor de seguridad ≥ 2.0.
 *
 * SI units throughout: Pa, m, m^4, N. Avoid mixing kN/MPa here —
 * the StructuralCalculator UI does the formatting.
 */

/** End-condition presets for the effective-length factor K. */
export type EndConditions =
  | 'fixed-fixed' // K=0.5  — both ends clamped (e.g. welded plates)
  | 'pinned-pinned' // K=1   — caso clásico Euler (hinged ends)
  | 'fixed-pinned' // K≈0.7 — one clamped, one pinned
  | 'fixed-free'; // K=2   — cantilever (única libertad superior)

/**
 * Effective-length factors per boundary condition.
 *
 * 'fixed-pinned' uses 0.699 — the exact root of the trascendental
 * tan(KL·π) = KL·π eq for the mode shape. Most engineering literature
 * approximates to 0.7; we use 0.699 for sub-percent accuracy in
 * predictive Pcr calculations and let UI displays round.
 */
export const EFFECTIVE_LENGTH_FACTORS: Record<EndConditions, number> = {
  'fixed-fixed': 0.5,
  'pinned-pinned': 1.0,
  'fixed-pinned': 0.699,
  'fixed-free': 2.0,
};

/** Input for calculateCriticalLoad — all SI units. */
export interface BucklingInput {
  /** Young's modulus (Pa) — e.g. acero 200e9, aluminio 69e9, madera ~10e9 */
  youngsModulus: number;
  /** Second moment of area (m^4) — depende de la sección */
  momentOfInertia: number;
  /** Length (m) — longitud sin arriostrar */
  length: number;
  /** End conditions — boundary constraints en ambos extremos */
  endConditions: EndConditions;
}

/** Output of calculateCriticalLoad — derived quantities. */
export interface BucklingResult {
  /** Carga crítica de pandeo (N) */
  criticalLoad: number;
  /** Effective length factor K */
  K: number;
  /** Effective length KL (m) */
  effectiveLength: number;
}

/**
 * Compute Euler critical buckling load.
 *
 * P_cr = π² · E · I / (K · L)²
 *
 * Returns NaN for degenerate inputs (L≤0, E≤0, I≤0). We choose NaN over
 * throwing so the UI can display a sentinel without crashing — buckling
 * calcs are exploratory and partial form data should not blow up the
 * whole component.
 */
export function calculateCriticalLoad(input: BucklingInput): BucklingResult {
  const { youngsModulus: E, momentOfInertia: I, length: L, endConditions } = input;
  const K = EFFECTIVE_LENGTH_FACTORS[endConditions];
  const effectiveLength = K * L;

  // Guard degenerate inputs — return NaN so callers can branch.
  if (!Number.isFinite(E) || !Number.isFinite(I) || !Number.isFinite(L)) {
    return { criticalLoad: NaN, K, effectiveLength };
  }
  if (E <= 0 || I <= 0 || L <= 0) {
    return { criticalLoad: NaN, K, effectiveLength };
  }

  const denominator = effectiveLength * effectiveLength;
  const criticalLoad = (Math.PI * Math.PI * E * I) / denominator;

  return {
    criticalLoad,
    K,
    effectiveLength,
  };
}

/**
 * Compute factor of safety against buckling.
 *
 * SF = P_cr / P_applied.
 *
 * Conventions:
 * - appliedLoad === 0  → +Infinity (sin carga, no hay riesgo de pandeo)
 * - appliedLoad < 0    → +Infinity (tracción no causa pandeo Euler)
 * - appliedLoad ≥ P_cr → ≤ 1 (already failed — UI must warn)
 * - P_cr inválido      → NaN
 */
export function bucklingSafetyFactor(criticalLoad: number, appliedLoad: number): number {
  if (!Number.isFinite(criticalLoad) || criticalLoad <= 0) {
    return NaN;
  }
  if (appliedLoad <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return criticalLoad / appliedLoad;
}

/**
 * Rectangular section second moment of area about centroidal axis (m^4).
 * I = b · h³ / 12, where h is parallel to the bending axis.
 */
export function rectangularInertia(width: number, height: number): number {
  return (width * height * height * height) / 12;
}

/**
 * Solid circular section second moment of area (m^4).
 * I = π · d⁴ / 64.
 */
export function circularSolidInertia(diameter: number): number {
  return (Math.PI * Math.pow(diameter, 4)) / 64;
}

/**
 * Hollow circular section second moment of area (m^4).
 * I = π · (do⁴ − di⁴) / 64. Caller responsible for outer > inner.
 */
export function circularHollowInertia(outerDiameter: number, innerDiameter: number): number {
  return (Math.PI * (Math.pow(outerDiameter, 4) - Math.pow(innerDiameter, 4))) / 64;
}
