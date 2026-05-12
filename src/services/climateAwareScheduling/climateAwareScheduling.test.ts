import { describe, it, expect } from 'vitest';
import {
  assessTaskWeather,
  buildDailyPlanAdjustment,
  type ScheduledTask,
  type WeatherConditions,
} from './climateAwareScheduling.js';

function task(over: Partial<ScheduledTask> & { id: string }): ScheduledTask {
  return {
    id: over.id,
    category: over.category ?? 'altura',
    scheduledHour: over.scheduledHour ?? 10,
    outdoor: over.outdoor ?? true,
    workerUids: ['w1'],
  };
}

const calmDay: WeatherConditions = {
  temperatureC: 22,
  humidityPercent: 50,
  windSpeedMs: 3,
  rainProbability: 0.1,
  uvIndex: 4,
  visibilityKm: 10,
};

describe('assessTaskWeather', () => {
  it('día calmo → proceed', () => {
    const r = assessTaskWeather(task({ id: 't1' }), calmDay);
    expect(r.decision).toBe('proceed');
  });

  it('viento >= 11 m/s en izaje → suspend', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'izaje' }), {
      ...calmDay,
      windSpeedMs: 12,
    });
    expect(r.decision).toBe('suspend');
  });

  it('lluvia >70% en excavación → suspend', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'excavacion' }), {
      ...calmDay,
      rainProbability: 0.8,
    });
    expect(r.decision).toBe('suspend');
  });

  it('calor 35°C en horario crítico 11-16 → reschedule', () => {
    const r = assessTaskWeather(task({ id: 't1', scheduledHour: 13, category: 'pintura_exterior' }), {
      ...calmDay,
      temperatureC: 36,
    });
    expect(r.decision).toBe('reschedule');
    expect(r.suggestedHour).toBeDefined();
  });

  it('UV extremo fuera horario crítico → add_controls', () => {
    const r = assessTaskWeather(task({ id: 't1', scheduledHour: 9, category: 'transporte' }), {
      ...calmDay,
      uvIndex: 12,
    });
    expect(r.decision).toBe('add_controls');
    expect(r.additionalControls).toContain('FPS 50+');
  });

  it('tormenta eléctrica próxima → suspend si outdoor', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'altura' }), {
      ...calmDay,
      lightningRiskWithinHours: 2,
    });
    expect(r.decision).toBe('suspend');
  });

  it('frío extremo → add_controls con multicapa', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'soldadura' }), {
      ...calmDay,
      temperatureC: -12,
    });
    expect(r.additionalControls).toContain('Vestimenta multicapa');
  });

  it('tareas oficina (no outdoor) inmunes', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'oficina', outdoor: false }), {
      ...calmDay,
      rainProbability: 0.95,
    });
    expect(r.decision).toBe('proceed');
  });

  it('visibilidad <0.5km en transporte → suspend', () => {
    const r = assessTaskWeather(task({ id: 't1', category: 'transporte' }), {
      ...calmDay,
      visibilityKm: 0.2,
    });
    expect(r.decision).toBe('suspend');
  });
});

describe('buildDailyPlanAdjustment', () => {
  it('agrupa por decisión', () => {
    const r = buildDailyPlanAdjustment(
      [
        task({ id: 'a', category: 'oficina', outdoor: false }), // proceed
        task({ id: 'b', category: 'izaje' }), // suspend (viento)
      ],
      { ...calmDay, windSpeedMs: 12 },
    );
    expect(r.proceed).toBe(1);
    expect(r.suspend).toBe(1);
    expect(r.assessments).toHaveLength(2);
  });
});
