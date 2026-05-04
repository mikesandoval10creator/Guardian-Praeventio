// SPDX-License-Identifier: MIT
//
// Ecuaciones de Euler de fluidos no-viscosos — Fase 4 del plan Euler-Matrix.
//
// Las ecuaciones de Euler (1755, "Principia motus fluidorum") describen
// fluidos no viscosos — la generalización de Bernoulli al régimen
// compresible y no estacionario. Para un fluido sin viscosidad y sin
// conducción de calor, en el régimen estacionario isentrópico:
//
//   Continuidad: ∂ρ/∂t + ∇·(ρu) = 0
//   Momentum:    ρ(∂u/∂t + (u·∇)u) = −∇p + ρg
//   Energía:     ds/dt = 0 (entropía constante a lo largo de líneas de corriente)
//
// Aplicación a prevención: escapes de gas a alta velocidad (válvulas de
// alivio, rupturas de contenedores, fugas en líneas de aire comprimido).
// En estos casos la velocidad supera ~0.3 × velocidad-del-sonido y los
// supuestos de Bernoulli (incompresible) ya no aplican; el flujo se
// "ahoga" (chokes) cuando alcanza M = 1 en la garganta. La tasa máxima
// de liberación se calcula con flujo crítico — útil para dimensionar
// zonas de evacuación HAZMAT.
//
// Este módulo NO reemplaza a bernoulliEngine.ts — lo extiende al
// régimen compresible. Para flujos lentos (M < 0.3) preferir Bernoulli.
//
// Origen: Euler 1755 (Principia motus fluidorum). Posteriormente
// generalizado por Navier (1822) + Stokes (1845) al caso viscoso.

/** Constante específica del gas R = R_universal / M_molar (J / kg·K). */
export const GAS_CONSTANTS_J_PER_KG_K = {
  /** Aire seco: 287.058 */
  air: 287.058,
  /** Metano (CH4): 518.28 — gas natural típico */
  methane: 518.28,
  /** Hidrógeno (H2): 4124.2 — el más liviano */
  hydrogen: 4124.2,
  /** Sulfuro de hidrógeno (H2S): 244.0 — peligro respiratorio típico minería */
  h2s: 244.0,
  /** Cloro (Cl2): 117.3 — agente químico industrial */
  chlorine: 117.3,
  /** Amoníaco (NH3): 488.2 — refrigeración + abono */
  ammonia: 488.2,
  /** Vapor de agua (H2O g): 461.5 */
  steam: 461.5,
} as const;

/**
 * Razón de calores específicos γ = cp/cv (adimensional).
 * Para gases ideales monoatómicos γ ≈ 1.67; diatómicos ≈ 1.4; poliatómicos ≈ 1.3.
 */
export const HEAT_CAPACITY_RATIOS = {
  /** Aire (mayoritariamente N2 + O2 diatómicos): 1.4 */
  air: 1.4,
  /** Metano: 1.31 (poliatómico) */
  methane: 1.31,
  /** Hidrógeno: 1.41 (diatómico) */
  hydrogen: 1.41,
  /** H2S: 1.32 */
  h2s: 1.32,
  /** Cloro: 1.34 */
  chlorine: 1.34,
  /** Amoníaco: 1.31 */
  ammonia: 1.31,
  /** Vapor: 1.33 */
  steam: 1.33,
} as const;

/**
 * Velocidad del sonido en gas ideal: c = √(γ R T) (m/s).
 *
 * @param tempK Temperatura absoluta (K). Cero absoluto = 0 K.
 * @param gamma Razón de calores específicos (adimensional, ≥1).
 * @param specificGasConstantJPerKgK R específico del gas (J/(kg·K)).
 *
 * Ejemplo: aire a 293 K → c ≈ 343 m/s.
 */
export function speedOfSoundIdealGas(
  tempK: number,
  gamma: number,
  specificGasConstantJPerKgK: number,
): number {
  if (tempK <= 0) {
    throw new Error('speedOfSoundIdealGas: tempK must be > 0');
  }
  if (gamma < 1) {
    throw new Error('speedOfSoundIdealGas: gamma must be >= 1');
  }
  if (specificGasConstantJPerKgK <= 0) {
    throw new Error('speedOfSoundIdealGas: R must be > 0');
  }
  return Math.sqrt(gamma * specificGasConstantJPerKgK * tempK);
}

/**
 * Mach number M = v / c (adimensional). Régimen subsónico M<1, sónico M=1, supersónico M>1.
 */
export function machNumber(velocityMs: number, speedOfSoundMs: number): number {
  if (speedOfSoundMs <= 0) {
    throw new Error('machNumber: speedOfSoundMs must be > 0');
  }
  return velocityMs / speedOfSoundMs;
}

/**
 * Razón de presión de estancamiento sobre presión estática para flujo
 * isentrópico (extensión compresible de Bernoulli):
 *
 *   p₀/p = (1 + (γ−1)/2 · M²)^(γ/(γ−1))
 *
 * Para M → 0 colapsa a Bernoulli incompresible (1 + ½ρv²/p para M«1).
 * Para M = 1 da el "valor crítico" p₀/p* ≈ 1.893 con γ=1.4.
 */
export function stagnationPressureRatio(machNumber: number, gamma: number): number {
  if (machNumber < 0) {
    throw new Error('stagnationPressureRatio: machNumber must be >= 0');
  }
  if (gamma <= 1) {
    throw new Error('stagnationPressureRatio: gamma must be > 1');
  }
  const exponent = gamma / (gamma - 1);
  return Math.pow(1 + ((gamma - 1) / 2) * machNumber * machNumber, exponent);
}

/**
 * Razón de temperatura de estancamiento sobre temperatura estática:
 *
 *   T₀/T = 1 + (γ−1)/2 · M²
 */
export function stagnationTemperatureRatio(machNumber: number, gamma: number): number {
  if (machNumber < 0) {
    throw new Error('stagnationTemperatureRatio: machNumber must be >= 0');
  }
  if (gamma <= 1) {
    throw new Error('stagnationTemperatureRatio: gamma must be > 1');
  }
  return 1 + ((gamma - 1) / 2) * machNumber * machNumber;
}

/**
 * ¿Está el flujo "ahogado" (choked)? Esto ocurre cuando la razón de
 * presiones aguas-abajo / aguas-arriba está por debajo del valor
 * crítico:
 *
 *   p_amb/p₀ ≤ (2/(γ+1))^(γ/(γ−1))
 *
 * Cuando se ahoga, la velocidad en la garganta = velocidad-del-sonido
 * local y el flujo másico es máximo (independiente de p_amb más bajo).
 */
export function isChokedFlow(
  upstreamPressurePa: number,
  ambientPressurePa: number,
  gamma: number,
): boolean {
  if (upstreamPressurePa <= 0) {
    throw new Error('isChokedFlow: upstreamPressurePa must be > 0');
  }
  if (ambientPressurePa < 0) {
    throw new Error('isChokedFlow: ambientPressurePa must be >= 0');
  }
  if (gamma <= 1) {
    throw new Error('isChokedFlow: gamma must be > 1');
  }
  const criticalRatio = Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
  return ambientPressurePa / upstreamPressurePa <= criticalRatio;
}

/**
 * Flujo másico crítico (kg/s) a través de un orificio de área `A` cuando
 * el flujo está ahogado. Es la TASA MÁXIMA posible — útil para
 * dimensionar peor caso de fuga HAZMAT:
 *
 *   ṁ = C_d · A · p₀ · √(γ/(R T₀)) · (2/(γ+1))^((γ+1)/(2(γ−1)))
 *
 * Donde C_d es el coeficiente de descarga (típico 0.6–0.85; default 0.61
 * para orificio de borde-cuadrado en aire).
 */
export function chokedMassFlowRate(
  upstreamPressurePa: number,
  upstreamTempK: number,
  orificeAreaM2: number,
  gamma: number,
  specificGasConstantJPerKgK: number,
  dischargeCoefficient: number = 0.61,
): number {
  if (upstreamPressurePa <= 0) throw new Error('chokedMassFlowRate: upstreamPressurePa must be > 0');
  if (upstreamTempK <= 0) throw new Error('chokedMassFlowRate: upstreamTempK must be > 0');
  if (orificeAreaM2 <= 0) throw new Error('chokedMassFlowRate: orificeAreaM2 must be > 0');
  if (gamma <= 1) throw new Error('chokedMassFlowRate: gamma must be > 1');
  if (specificGasConstantJPerKgK <= 0)
    throw new Error('chokedMassFlowRate: R must be > 0');
  if (dischargeCoefficient <= 0 || dischargeCoefficient > 1)
    throw new Error('chokedMassFlowRate: dischargeCoefficient must be in (0, 1]');

  const term1 = Math.sqrt(gamma / (specificGasConstantJPerKgK * upstreamTempK));
  const term2 = Math.pow(2 / (gamma + 1), (gamma + 1) / (2 * (gamma - 1)));
  return dischargeCoefficient * orificeAreaM2 * upstreamPressurePa * term1 * term2;
}

/**
 * Volumen de gas peligroso liberado tras un tiempo `dt` (s) asumiendo
 * flujo crítico continuo. Convierte el flujo másico en volumen-gas a
 * condiciones ambiente (no upstream):
 *
 *   V_amb = (ṁ · dt) · (R T_amb / p_amb)
 *
 * Útil para predecir cuánto gas está afuera del contenedor en T+30s,
 * T+60s, T+5min — alimenta directamente a `gasDispersionCloud` (Bernoulli)
 * para predecir radio de afectación.
 */
export function chokedReleaseVolume(
  massFlowRateKgPerS: number,
  durationS: number,
  ambientTempK: number,
  ambientPressurePa: number,
  specificGasConstantJPerKgK: number,
): number {
  if (massFlowRateKgPerS < 0) throw new Error('chokedReleaseVolume: massFlowRateKgPerS must be >= 0');
  if (durationS < 0) throw new Error('chokedReleaseVolume: durationS must be >= 0');
  if (ambientTempK <= 0) throw new Error('chokedReleaseVolume: ambientTempK must be > 0');
  if (ambientPressurePa <= 0) throw new Error('chokedReleaseVolume: ambientPressurePa must be > 0');
  if (specificGasConstantJPerKgK <= 0)
    throw new Error('chokedReleaseVolume: R must be > 0');
  const massKg = massFlowRateKgPerS * durationS;
  return (massKg * specificGasConstantJPerKgK * ambientTempK) / ambientPressurePa;
}
