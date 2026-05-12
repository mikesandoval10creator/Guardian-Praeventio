import { describe, it, expect } from 'vitest';
import {
  thermalStep,
  simulateThermalEvolution,
  steadyStateTemperatureC,
  co2Step,
  simulateCO2Evolution,
  steadyStateCO2Ppm,
  classifyAirQuality,
  recommendVentilation,
  CO2_OUTSIDE_PPM,
  type ThermalZone,
  type ThermalDriver,
  type CO2Zone,
  type CO2Driver,
} from './thermalModel.js';

describe('thermal 1R1C', () => {
  const zone: ThermalZone = {
    thermalCapacityJperK: 100_000, // pequeña zona ~50m³
    thermalResistanceKperW: 0.01, // muy conductiva
  };

  it('thermalStep: sin gananacias, T → T_amb', () => {
    const driver: ThermalDriver = { ambientC: 20, internalGainW: 0, hvacW: 0 };
    const { newCurrentC } = thermalStep(zone, driver, {
      currentC: 25,
      dtSeconds: 60,
    });
    expect(newCurrentC).toBeLessThan(25);
    expect(newCurrentC).toBeGreaterThan(20);
  });

  it('steadyStateTemperatureC con HVAC enfriando', () => {
    const driver: ThermalDriver = { ambientC: 30, internalGainW: 500, hvacW: -1000 };
    const ss = steadyStateTemperatureC(zone, driver);
    // 30 + 0.01 × (500 − 1000) = 25
    expect(ss).toBeCloseTo(25, 5);
  });

  it('simulación converge hacia steady-state', () => {
    const driver: ThermalDriver = { ambientC: 20, internalGainW: 200, hvacW: 0 };
    const series = simulateThermalEvolution(zone, driver, 20, 30, 200);
    const ss = steadyStateTemperatureC(zone, driver);
    expect(series[series.length - 1].temperatureC).toBeCloseTo(ss, 0);
  });
});

describe('CO2 balance', () => {
  const zone: CO2Zone = {
    volumeM3: 100,
    airExchangeM3perH: 200, // 2 ACH
  };

  it('co2Step: zona vacía mantiene ppm exterior', () => {
    const driver: CO2Driver = { occupancyCount: 0 };
    const { newPpm } = co2Step(zone, driver, {
      currentPpm: CO2_OUTSIDE_PPM,
      dtSeconds: 60,
    });
    expect(newPpm).toBe(CO2_OUTSIDE_PPM);
  });

  it('ocupantes → ppm sube con el tiempo', () => {
    const driver: CO2Driver = { occupancyCount: 10 };
    const series = simulateCO2Evolution(zone, driver, CO2_OUTSIDE_PPM, 60, 30);
    expect(series[series.length - 1].ppm).toBeGreaterThan(series[0].ppm);
  });

  it('steady-state CO2 con 10 personas, 200m³/h vent', () => {
    const driver: CO2Driver = { occupancyCount: 10 };
    // G = 10 × 17.28 L/h × 1m³/1000L = 0.1728 m³/h
    // ΔC = 0.1728 / 200 × 1e6 ≈ 864 ppm
    // ss = 420 + 864 ≈ 1284 ppm
    const ss = steadyStateCO2Ppm(zone, driver);
    expect(ss).toBeGreaterThan(1200);
    expect(ss).toBeLessThan(1400);
  });

  it('sin ventilación → CO2 acumula sin tope (steady = ∞)', () => {
    const ss = steadyStateCO2Ppm(
      { ...zone, airExchangeM3perH: 0 },
      { occupancyCount: 5 },
    );
    expect(ss).toBe(Number.POSITIVE_INFINITY);
  });

  it('activity factor 2.5 incrementa generación', () => {
    const ssRest = steadyStateCO2Ppm(zone, { occupancyCount: 5, activityFactor: 1 });
    const ssActive = steadyStateCO2Ppm(zone, {
      occupancyCount: 5,
      activityFactor: 2.5,
    });
    expect(ssActive).toBeGreaterThan(ssRest);
  });
});

describe('classifyAirQuality', () => {
  it('mapea ppm → category según ASHRAE', () => {
    expect(classifyAirQuality(500)).toBe('excellent');
    expect(classifyAirQuality(700)).toBe('good');
    expect(classifyAirQuality(900)).toBe('acceptable');
    expect(classifyAirQuality(1200)).toBe('poor');
    expect(classifyAirQuality(2000)).toBe('critical');
  });
});

describe('recommendVentilation', () => {
  it('critical genera múltiples acciones', () => {
    const r = recommendVentilation(2500);
    expect(r.level).toBe('critical');
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.actions.some((a) => /Evacuar/.test(a))).toBe(true);
  });

  it('excellent → sin acciones', () => {
    const r = recommendVentilation(500);
    expect(r.actions).toHaveLength(0);
  });
});
