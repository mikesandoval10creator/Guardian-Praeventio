// SPDX-License-Identifier: MIT
/**
 * Método de Euler explícito para ODE — Fase 6 del plan Euler-Matrix.
 *
 * Para una ecuación dy/dt = f(t, y) con condición inicial y(t0) = y0,
 * el método de Euler avanza un paso h:
 *
 *   y_{n+1} = y_n + h · f(t_n, y_n)
 *
 * Aplicación a prevención: simulación local (SLM-friendly) de
 * propagación de incendios, dispersión de gases, evacuación con
 * dinámicas continuas. El método es O(h) — se sacrifica precisión
 * por velocidad. Para precisión usar RK4 (no implementado aquí —
 * fuera del scope Euler-Matrix; queda como deuda técnica explícita
 * en el plan Euler-Matrix Fase 11+).
 *
 * Trade-offs:
 *   - Pro: O(1) memoria por paso, computacionalmente trivial, sirve
 *     para SLM. Pure functions: ejecutable en Node, sin DOM, sin Web
 *     Worker, sin GPU. Permite correr en dispositivos de baja
 *     potencia donde el agente offline necesita simular escenarios.
 *   - Con: error global O(h), inestable para sistemas stiff. Hay que
 *     usar paso pequeño en transiciones rápidas (incendios crecientes,
 *     dispersión turbulenta de gases). Para producción crítica el
 *     resultado debe validarse contra modelos analíticos o RK4.
 *
 * Origen: Leonhard Euler 1768 ("Institutiones calculi integralis",
 * Vol. I, Sectio prima, Caput VII). Primer método numérico documentado
 * para ODE — junto con Königsberg 1736 (graphConnectivity), constituye
 * el segundo pilar Euler de este motor: si Bernoulli cuantifica
 * MAGNITUDES de riesgo y Euler cartografía RELACIONES estáticas,
 * Euler-ODE simula la EVOLUCIÓN TEMPORAL de esos riesgos.
 *
 * Pure functions, sin side effects, sin deps externas.
 */

/** Función derivada f(t, y) — devuelve dy/dt en estado y, tiempo t. */
export type DerivativeFn<S> = (t: number, state: S) => S;

/**
 * Sumador de estado: dado el estado actual y la derivada, devuelve el
 * nuevo estado. Permite que el integrador sea genérico sobre cualquier
 * tipo S (escalar, vector, struct con varias variables físicas).
 *
 * Convención: `add(y, dy_dt, h)` debe calcular `y + h · dy_dt`.
 */
export type StateAdder<S> = (state: S, delta: S, h: number) => S;

export interface EulerStepInput<S> {
  /** Tiempo actual t_n. */
  t: number;
  /** Estado actual y_n. */
  state: S;
  /** Paso de integración h > 0. */
  h: number;
  /** Función derivada dy/dt = f(t, y). */
  derivative: DerivativeFn<S>;
  /** Sumador de estado: produce y + h · delta. */
  add: StateAdder<S>;
}

/**
 * Un paso explícito de Euler — y_{n+1} = y_n + h · f(t_n, y_n).
 * Devuelve {t: t_n + h, state: y_{n+1}}. No muta el estado de entrada.
 */
export function eulerStep<S>(input: EulerStepInput<S>): { t: number; state: S } {
  const { t, state, h, derivative, add } = input;
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError(`eulerStep: h must be a finite positive number, got ${h}`);
  }
  const k1 = derivative(t, state);
  const next = add(state, k1, h);
  return { t: t + h, state: next };
}

export interface EulerIntegrateInput<S> {
  /** Tiempo inicial. */
  t0: number;
  /** Estado inicial y(t0). */
  state0: S;
  /** Tiempo final (debe ser > t0). */
  tEnd: number;
  /** Paso h > 0. */
  h: number;
  /** Función derivada. */
  derivative: DerivativeFn<S>;
  /** Sumador de estado. */
  add: StateAdder<S>;
  /**
   * Callback opcional invocado tras cada paso aceptado, con (t_{n+1},
   * state_{n+1}). Útil para streaming a la UI / logging incremental.
   */
  onStep?: (t: number, state: S) => void;
}

/**
 * Integra desde t0 hasta tEnd con paso h. El último paso se trunca
 * a tEnd si el paso completo excedería el límite (preserva la
 * condición de borde sin overshoot, que en simulaciones físicas
 * puede dar resultados absurdos como áreas negativas).
 *
 * Devuelve el estado final {t, state}. Si se necesitan los pasos
 * intermedios, usar onStep.
 *
 * Throws si h ≤ 0 o si tEnd < t0.
 */
export function eulerIntegrate<S>(input: EulerIntegrateInput<S>): { t: number; state: S } {
  const { t0, state0, tEnd, h, derivative, add, onStep } = input;
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError(`eulerIntegrate: h must be a finite positive number, got ${h}`);
  }
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd)) {
    throw new RangeError('eulerIntegrate: t0 and tEnd must be finite numbers');
  }
  if (tEnd < t0) {
    throw new RangeError(`eulerIntegrate: tEnd (${tEnd}) must be ≥ t0 (${t0})`);
  }

  let t = t0;
  let state = state0;
  // Guard rail: if t0 === tEnd, return immediately (zero-length integration).
  if (tEnd === t0) return { t, state };

  // Iteration with hard cap at tEnd; numerical comparisons use a tiny
  // epsilon to avoid floating-point overshoot pinging an extra step.
  const eps = h * 1e-9;
  while (t + eps < tEnd) {
    // Truncate last step so we land exactly on tEnd. This avoids
    // simulating beyond the user's bound (important for fire spread
    // where overshoot would produce nonsense areas).
    const stepH = Math.min(h, tEnd - t);
    const k1 = derivative(t, state);
    state = add(state, k1, stepH);
    t += stepH;
    if (onStep) onStep(t, state);
  }
  return { t, state };
}

/**
 * Convenience wrapper for scalar ODEs y' = f(t, y). Returns the full
 * trajectory as an array — useful for plotting.
 *
 * For long integrations where memory matters, use eulerIntegrate with
 * an onStep callback instead (O(1) memory).
 *
 * Throws on h ≤ 0 or tEnd < t0.
 */
export function eulerScalar(
  f: (t: number, y: number) => number,
  y0: number,
  t0: number,
  tEnd: number,
  h: number,
): { t: number; y: number }[] {
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError(`eulerScalar: h must be a finite positive number, got ${h}`);
  }
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd)) {
    throw new RangeError('eulerScalar: t0 and tEnd must be finite numbers');
  }
  if (tEnd < t0) {
    throw new RangeError(`eulerScalar: tEnd (${tEnd}) must be ≥ t0 (${t0})`);
  }

  const trajectory: { t: number; y: number }[] = [{ t: t0, y: y0 }];
  if (tEnd === t0) return trajectory;

  let t = t0;
  let y = y0;
  const eps = h * 1e-9;
  while (t + eps < tEnd) {
    const stepH = Math.min(h, tEnd - t);
    const dy = f(t, y);
    y = y + stepH * dy;
    t += stepH;
    trajectory.push({ t, y });
  }
  return trajectory;
}

// ─────────────────────────────────────────────────────────────────────
// Pre-built scenarios for prevention (SLM-friendly, no external deps).
// ─────────────────────────────────────────────────────────────────────

/**
 * Modelo simple de propagación de incendio + supresión.
 *
 * Dinámica:
 *   dA/dt =  spreadRate                          si t < suppressionStartT
 *   dA/dt =  spreadRate − suppressionRate        si t ≥ suppressionStartT
 *
 * El área no puede ser negativa (cláusula clamp). Cuando A llega a 0
 * tras supresión efectiva, la simulación marca timeToContain y mantiene
 * el área en 0 para los pasos siguientes.
 *
 * Limitaciones (a documentar al usuario operacional):
 *   - Modelo lineal — no captura la realidad cuadrática del fuego en
 *     espacio abierto (Rothermel) ni la influencia exponencial del
 *     viento. Aquí sólo sirve como ESTIMADOR DE TIEMPO DE CONTENCIÓN
 *     comparativo entre estrategias, no como predicción operacional.
 *   - Para producción crítica usar el modelo Rothermel completo o
 *     FARSITE; este existe sólo como demostración de Euler-ODE
 *     sobre escenarios de prevención.
 */
export interface FireSpreadInput {
  /** Área inicial en combustión (m²), debe ser > 0. */
  initialArea: number;
  /** Tasa de propagación cuando viento/combustible son favorables (m²/min). */
  spreadRate: number;
  /** Tasa de supresión cuando inicia la intervención (m²/min). 0 = sin intervención. */
  suppressionRate: number;
  /** Tiempo de inicio de la intervención (min). 0 = inmediato. */
  suppressionStartT: number;
}

export type FireSpreadPhase = 'growth' | 'suppression' | 'extinguished';

export interface FireSpreadStep {
  t: number;
  area: number;
  phase: FireSpreadPhase;
}

export interface FireSpreadResult {
  /** Trayectoria completa, incluido t=0. */
  timeline: FireSpreadStep[];
  /** Tiempo (min) cuando el área llega a 0; null si nunca se contiene. */
  timeToContain: number | null;
  /** Pico máximo de área alcanzado durante la simulación (m²). */
  peakArea: number;
}

/**
 * Simula incendio creciente + supresión usando Euler explícito.
 *
 * Trade-offs explícitos:
 *   - h pequeño → más exacto pero más cómputo. h = 0.5 min suele bastar
 *     para inputs realistas (spreadRate < 100 m²/min).
 *   - tMax debe cubrir el tiempo esperado de contención + margen. Si el
 *     fuego no se contiene dentro de tMax, timeToContain = null.
 *
 * Throws si h ≤ 0, tMax ≤ 0, o initialArea < 0.
 */
export function simulateFireSpread(
  input: FireSpreadInput,
  h: number,
  tMax: number,
): FireSpreadResult {
  const { initialArea, spreadRate, suppressionRate, suppressionStartT } = input;
  if (!Number.isFinite(h) || h <= 0) {
    throw new RangeError(`simulateFireSpread: h must be a finite positive number, got ${h}`);
  }
  if (!Number.isFinite(tMax) || tMax <= 0) {
    throw new RangeError(`simulateFireSpread: tMax must be a finite positive number, got ${tMax}`);
  }
  if (!Number.isFinite(initialArea) || initialArea < 0) {
    throw new RangeError(`simulateFireSpread: initialArea must be a finite non-negative number, got ${initialArea}`);
  }

  const timeline: FireSpreadStep[] = [];
  let t = 0;
  let area = initialArea;
  let peakArea = initialArea;
  let timeToContain: number | null = null;

  const phaseFor = (now: number, currentArea: number): FireSpreadPhase => {
    if (currentArea <= 0) return 'extinguished';
    return now >= suppressionStartT ? 'suppression' : 'growth';
  };

  const derivative = (now: number, currentArea: number): number => {
    if (currentArea <= 0) return 0; // Once extinguished, stay at 0.
    if (now < suppressionStartT) return spreadRate;
    return spreadRate - suppressionRate;
  };

  // Push initial point.
  timeline.push({ t, area, phase: phaseFor(t, area) });

  const eps = h * 1e-9;
  while (t + eps < tMax) {
    const stepH = Math.min(h, tMax - t);
    const dA = derivative(t, area);
    let nextArea = area + stepH * dA;
    if (nextArea < 0) nextArea = 0; // Physical clamp: no negative burning area.
    const nextT = t + stepH;
    if (nextArea > peakArea) peakArea = nextArea;
    if (timeToContain === null && area > 0 && nextArea <= 0) {
      // Fire just got extinguished this step. Record exact crossing
      // time via linear interpolation: dA negative, so the moment of
      // contact is t + area / |dA|.
      const denom = Math.abs(dA);
      if (denom > 0) {
        const tCross = t + area / denom;
        timeToContain = Math.min(tCross, nextT);
      } else {
        timeToContain = nextT;
      }
    }
    area = nextArea;
    t = nextT;
    timeline.push({ t, area, phase: phaseFor(t, area) });
  }

  return { timeline, timeToContain, peakArea };
}
