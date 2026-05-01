import { describe, it, expect } from 'vitest';
import {
  assessClimateRisk,
  buildClimateRiskNodes,
  type ClimateForecastDay,
} from './climateRiskCoupling';

describe('assessClimateRisk', () => {
  it('1) rainy + outdoor + electrical work => slippery-surface + electrical-hazard', () => {
    const forecast: ClimateForecastDay = {
      date: new Date('2026-04-25T00:00:00.000Z'),
      conditionCode: 'rainy',
      temperatureC: 15,
      precipMm: 25,
    };
    const factors = assessClimateRisk(forecast, {
      outdoor: true,
      workTypes: ['altura', 'electrico'],
    });
    expect(factors).toContain('slippery-surface');
    expect(factors).toContain('electrical-hazard');
  });

  it('2) extreme-heat 38C outdoor => heat-stress', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'extreme-heat',
        temperatureC: 38,
      },
      { outdoor: true, workTypes: [] },
    );
    expect(factors).toContain('heat-stress');
  });

  it('3) sunny benign weather => no risk factors', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'sunny',
        temperatureC: 22,
      },
      { outdoor: true, workTypes: [] },
    );
    expect(factors).toEqual([]);
  });

  it('stormy => lightning-exposure + reduced-visibility', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'stormy',
        temperatureC: 18,
      },
      { outdoor: true, workTypes: [] },
    );
    expect(factors).toContain('lightning-exposure');
    expect(factors).toContain('reduced-visibility');
  });

  it('cold-snap => hypothermia', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-07-15T00:00:00.000Z'),
        conditionCode: 'cold-snap',
        temperatureC: -2,
      },
      { outdoor: true, workTypes: [] },
    );
    expect(factors).toContain('hypothermia');
  });

  it('windy with high speeds => falling-objects', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-07-15T00:00:00.000Z'),
        conditionCode: 'windy',
        temperatureC: 16,
        windKmh: 70,
      },
      { outdoor: true, workTypes: ['altura'] },
    );
    expect(factors).toContain('falling-objects');
  });

  it('indoor projects skip outdoor-only hazards', () => {
    const factors = assessClimateRisk(
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'rainy',
        temperatureC: 15,
        precipMm: 30,
      },
      { outdoor: false, workTypes: [] },
    );
    expect(factors).not.toContain('slippery-surface');
  });
});

describe('buildClimateRiskNodes', () => {
  it('4) builds up to 6 assessments for 3 days × 2 outdoor projects', () => {
    const forecasts: ClimateForecastDay[] = [
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'rainy',
        temperatureC: 15,
        precipMm: 25,
      },
      {
        date: new Date('2026-04-26T00:00:00.000Z'),
        conditionCode: 'stormy',
        temperatureC: 16,
      },
      {
        date: new Date('2026-04-27T00:00:00.000Z'),
        conditionCode: 'extreme-heat',
        temperatureC: 36,
      },
    ];
    const projects = [
      { id: 'proj-A', workTypes: ['altura'], outdoor: true },
      { id: 'proj-B', workTypes: ['general'], outdoor: true },
    ];
    const out = buildClimateRiskNodes(forecasts, projects);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(6);
    for (const a of out) {
      expect([projects[0].id, projects[1].id]).toContain(a.projectId);
      expect(a.riskNodePayload.connections).toContain(a.projectId);
      expect(a.riskNodePayload.type).toBe('CLIMATE_RISK');
      expect(a.riskNodePayload.title).toMatch(/Riesgo climático/);
    }
  });

  it('skips benign forecasts (no risk factors → no node)', () => {
    const forecasts: ClimateForecastDay[] = [
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'sunny',
        temperatureC: 22,
      },
    ];
    const out = buildClimateRiskNodes(forecasts, [
      { id: 'proj-A', workTypes: [], outdoor: true },
    ]);
    expect(out).toEqual([]);
  });

  it('riskNodePayload has Spanish recommendedControls', () => {
    const forecasts: ClimateForecastDay[] = [
      {
        date: new Date('2026-04-25T00:00:00.000Z'),
        conditionCode: 'rainy',
        temperatureC: 15,
        precipMm: 25,
      },
    ];
    const out = buildClimateRiskNodes(forecasts, [
      { id: 'proj-A', workTypes: ['electrico'], outdoor: true },
    ]);
    expect(out[0].recommendedControls.length).toBeGreaterThan(0);
    expect(out[0].recommendedControls.some(c => /[áéíóúñ]|piso|lluvia|EPP/i.test(c))).toBe(true);
  });
});
