// Bernoulli engine — fluid dynamics for ventilation, hazmat, structural and EPP modules. SI units.

/** Dynamic pressure: q = ½ρv² (Pa) */
export function dynamicPressure(rhoKgM3: number, vMs: number): number {
  return 0.5 * rhoKgM3 * vMs * vMs;
}

/** Static pressure delta along a streamline: Δp = ½ρ(v₂² − v₁²) (Pa) */
export function staticPressureDelta(rhoKgM3: number, v1Ms: number, v2Ms: number): number {
  return 0.5 * rhoKgM3 * (v2Ms * v2Ms - v1Ms * v1Ms);
}

/** Venturi flow rate: Q = A₂·√(2Δp / (ρ(1 − (A₂/A₁)²))) (m³/s) */
export function venturiFlowRate(
  a1M2: number,
  a2M2: number,
  deltaPPa: number,
  rhoKgM3: number,
): number {
  if (rhoKgM3 <= 0) {
    throw new Error('venturiFlowRate: rho must be > 0');
  }
  if (a1M2 <= a2M2) {
    throw new Error('venturiFlowRate: A1 must be > A2');
  }
  const ratio = a2M2 / a1M2;
  return a2M2 * Math.sqrt((2 * deltaPPa) / (rhoKgM3 * (1 - ratio * ratio)));
}

/** Wind load on a surface: F = Cp · q · A (N). Default rho = 1.225 kg/m³ (sea-level air). */
export function windLoadOnSurface(
  areaM2: number,
  vMs: number,
  pressureCoeff: number,
  rhoKgM3: number = 1.225,
): number {
  return pressureCoeff * dynamicPressure(rhoKgM3, vMs) * areaM2;
}

/** Respirator pressure drop (steady-state, linear): Δp = R·Q (Pa) */
export function respiratorPressureDrop(
  filterResistancePaSPerM3: number,
  flowRateM3PerS: number,
): number {
  return filterResistancePaSPerM3 * flowRateM3PerS;
}

/** Wind speed conversion: kmh / 3.6 (m/s) */
export function windSpeedKmhToMs(kmh: number): number {
  return kmh / 3.6;
}
