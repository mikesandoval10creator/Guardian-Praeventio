// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  speedOfSoundIdealGas,
  machNumber,
  stagnationPressureRatio,
  stagnationTemperatureRatio,
  isChokedFlow,
  chokedMassFlowRate,
  chokedReleaseVolume,
  GAS_CONSTANTS_J_PER_KG_K,
  HEAT_CAPACITY_RATIOS,
} from './inviscidFlow';

describe('speedOfSoundIdealGas', () => {
  it('air at 293 K → ~343 m/s (textbook value)', () => {
    const c = speedOfSoundIdealGas(293, HEAT_CAPACITY_RATIOS.air, GAS_CONSTANTS_J_PER_KG_K.air);
    expect(c).toBeCloseTo(343.1, 0); // ±1 m/s
  });

  it('air at 0°C (273.15 K) → ~331 m/s', () => {
    const c = speedOfSoundIdealGas(273.15, HEAT_CAPACITY_RATIOS.air, GAS_CONSTANTS_J_PER_KG_K.air);
    expect(c).toBeCloseTo(331.3, 0);
  });

  it('hydrogen at 293 K is much faster than air (lighter molecule)', () => {
    const cAir = speedOfSoundIdealGas(293, HEAT_CAPACITY_RATIOS.air, GAS_CONSTANTS_J_PER_KG_K.air);
    const cH2 = speedOfSoundIdealGas(
      293,
      HEAT_CAPACITY_RATIOS.hydrogen,
      GAS_CONSTANTS_J_PER_KG_K.hydrogen,
    );
    expect(cH2).toBeGreaterThan(cAir * 3); // ~1290 m/s vs 343
  });

  it('throws on tempK <= 0', () => {
    expect(() => speedOfSoundIdealGas(0, 1.4, 287)).toThrow(/tempK/);
    expect(() => speedOfSoundIdealGas(-10, 1.4, 287)).toThrow(/tempK/);
  });

  it('throws on gamma < 1', () => {
    expect(() => speedOfSoundIdealGas(293, 0.5, 287)).toThrow(/gamma/);
  });

  it('throws on R <= 0', () => {
    expect(() => speedOfSoundIdealGas(293, 1.4, 0)).toThrow(/R/);
  });
});

describe('machNumber', () => {
  it('subsonic: 100 m/s in 343 m/s air → M ≈ 0.29', () => {
    expect(machNumber(100, 343)).toBeCloseTo(0.2915, 3);
  });

  it('sonic: M = 1 when v = c', () => {
    expect(machNumber(343, 343)).toBe(1);
  });

  it('supersonic: M > 1', () => {
    expect(machNumber(686, 343)).toBeCloseTo(2, 5);
  });

  it('throws on c <= 0', () => {
    expect(() => machNumber(100, 0)).toThrow(/speedOfSound/);
  });
});

describe('stagnationPressureRatio', () => {
  it('M=0 → ratio = 1 (no compression effect at zero velocity)', () => {
    expect(stagnationPressureRatio(0, 1.4)).toBe(1);
  });

  it('M=1 critical ratio for air (γ=1.4) ≈ 1.8929', () => {
    // Textbook value: p₀/p* = ((γ+1)/2)^(γ/(γ−1)) = 1.2^3.5 ≈ 1.8929
    expect(stagnationPressureRatio(1, 1.4)).toBeCloseTo(1.8929, 3);
  });

  it('M=2 (supersonic) → ratio ≈ 7.824 for γ=1.4', () => {
    // Textbook: (1 + 0.2·4)^3.5 = 1.8^3.5 ≈ 7.824
    expect(stagnationPressureRatio(2, 1.4)).toBeCloseTo(7.824, 2);
  });

  it('throws on M < 0', () => {
    expect(() => stagnationPressureRatio(-1, 1.4)).toThrow(/machNumber/);
  });

  it('throws on gamma <= 1', () => {
    expect(() => stagnationPressureRatio(1, 1)).toThrow(/gamma/);
  });
});

describe('stagnationTemperatureRatio', () => {
  it('M=0 → ratio = 1', () => {
    expect(stagnationTemperatureRatio(0, 1.4)).toBe(1);
  });

  it('M=1 (γ=1.4) → ratio = 1.2', () => {
    expect(stagnationTemperatureRatio(1, 1.4)).toBeCloseTo(1.2, 6);
  });

  it('M=2 (γ=1.4) → ratio = 1.8', () => {
    expect(stagnationTemperatureRatio(2, 1.4)).toBeCloseTo(1.8, 6);
  });
});

describe('isChokedFlow', () => {
  it('air with p_amb/p₀ = 0.5 < 0.528 → choked', () => {
    // Critical ratio for air: (2/2.4)^3.5 ≈ 0.5283
    expect(isChokedFlow(200000, 100000, 1.4)).toBe(true);
  });

  it('air with p_amb/p₀ = 0.7 > 0.528 → NOT choked', () => {
    expect(isChokedFlow(100000, 70000, 1.4)).toBe(false);
  });

  it('vacuum downstream → always choked (extreme case)', () => {
    expect(isChokedFlow(100000, 0, 1.4)).toBe(true);
  });

  it('throws on upstream <= 0', () => {
    expect(() => isChokedFlow(0, 50000, 1.4)).toThrow(/upstream/);
  });
});

describe('chokedMassFlowRate', () => {
  it('air leak from 10-bar tank through 1 cm² hole at 293 K — sanity range', () => {
    // p₀ = 1 MPa = 1e6 Pa, T₀ = 293 K, A = 1e-4 m², gamma=1.4, R=287, Cd=0.61
    // Expected: O(0.1 kg/s) for air through 1 cm² at 10 bar.
    const m = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287, 0.61);
    expect(m).toBeGreaterThan(0.1);
    expect(m).toBeLessThan(0.3);
  });

  it('larger orifice → linearly more mass flow', () => {
    const small = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287);
    const big = chokedMassFlowRate(1e6, 293, 4e-4, 1.4, 287); // 4× area
    expect(big).toBeCloseTo(4 * small, 8);
  });

  it('higher upstream pressure → linearly more mass flow', () => {
    const low = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287);
    const high = chokedMassFlowRate(2e6, 293, 1e-4, 1.4, 287); // 2× pressure
    expect(high).toBeCloseTo(2 * low, 8);
  });

  it('hotter gas → less mass flow (lower density)', () => {
    const cold = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287);
    const hot = chokedMassFlowRate(1e6, 600, 1e-4, 1.4, 287);
    // m ∝ 1/√T → ratio = √(293/600) ≈ 0.699
    expect(hot / cold).toBeCloseTo(Math.sqrt(293 / 600), 3);
  });

  it('default Cd=0.61 used when not specified', () => {
    const def = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287);
    const explicit = chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287, 0.61);
    expect(def).toBeCloseTo(explicit, 10);
  });

  it('throws on out-of-range Cd', () => {
    expect(() => chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287, 0)).toThrow(/dischargeCoefficient/);
    expect(() => chokedMassFlowRate(1e6, 293, 1e-4, 1.4, 287, 1.5)).toThrow(/dischargeCoefficient/);
  });
});

describe('chokedReleaseVolume', () => {
  it('1 kg/s for 60s at 1 atm 293 K (air) → ~50 m³', () => {
    // V = m·R·T / p = 60·287·293 / 101325 ≈ 49.79 m³
    const v = chokedReleaseVolume(1, 60, 293, 101325, 287);
    expect(v).toBeCloseTo(49.79, 1);
  });

  it('zero duration → zero volume', () => {
    expect(chokedReleaseVolume(1, 0, 293, 101325, 287)).toBe(0);
  });

  it('zero mass flow → zero volume', () => {
    expect(chokedReleaseVolume(0, 60, 293, 101325, 287)).toBe(0);
  });

  it('integrates with chokedMassFlowRate end-to-end (HAZMAT scenario)', () => {
    // Escape de cloro Cl2 a 5 bar, 293 K, orificio 5 mm² = 5e-6 m², Cd=0.61.
    // Cuánto Cl2 (gas a ambiente) sale en 30 s tras la ruptura?
    const massPerSec = chokedMassFlowRate(
      5e5, // 5 bar
      293,
      5e-6, // 5 mm²
      HEAT_CAPACITY_RATIOS.chlorine,
      GAS_CONSTANTS_J_PER_KG_K.chlorine,
    );
    const volAmbient = chokedReleaseVolume(
      massPerSec,
      30,
      293,
      101325,
      GAS_CONSTANTS_J_PER_KG_K.chlorine,
    );
    // Para Cl2, R=117.3, gamma=1.34. Sanity: O(few liters of ambient-gas).
    expect(volAmbient).toBeGreaterThan(0);
    expect(volAmbient).toBeLessThan(10); // plausible scale for 5 mm² hole
  });
});

describe('gas constant + heat capacity tables', () => {
  it('air R is closest to 287.058', () => {
    expect(GAS_CONSTANTS_J_PER_KG_K.air).toBeCloseTo(287.058, 3);
  });

  it('air gamma is 1.4', () => {
    expect(HEAT_CAPACITY_RATIOS.air).toBe(1.4);
  });

  it('hazmat gases (H2S, Cl2, NH3) all present', () => {
    expect(GAS_CONSTANTS_J_PER_KG_K.h2s).toBeDefined();
    expect(GAS_CONSTANTS_J_PER_KG_K.chlorine).toBeDefined();
    expect(GAS_CONSTANTS_J_PER_KG_K.ammonia).toBeDefined();
  });
});
