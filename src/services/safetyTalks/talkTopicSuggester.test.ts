import { describe, it, expect } from 'vitest';
import { suggestTalks, type ContextSignals } from './talkTopicSuggester.js';

function ctx(over: Partial<ContextSignals> = {}): ContextSignals {
  return {
    recentIncidents: [],
    activeRisks: [],
    todaysTaskCategories: [],
    openFindingsByCategory: {},
    newWorkersCount: 0,
    ...over,
  };
}

describe('suggestTalks', () => {
  it('sin signals → lista vacía', () => {
    expect(suggestTalks(ctx())).toEqual([]);
  });

  it('tareas en altura hoy → topic altura es top 1', () => {
    const result = suggestTalks(ctx({ todaysTaskCategories: ['altura'] }));
    expect(result[0].topicId).toBe('altura');
  });

  it('UV alto → topic uv aparece', () => {
    const result = suggestTalks(ctx({ weather: { uvIndex: 9 } }));
    expect(result.some((t) => t.topicId === 'uv')).toBe(true);
  });

  it('viento ≥40 → topic viento', () => {
    const result = suggestTalks(ctx({ weather: { windSpeedKmh: 50 } }));
    expect(result.some((t) => t.topicId === 'viento')).toBe(true);
  });

  it('incidente fatiga → topic fatiga', () => {
    const result = suggestTalks(
      ctx({ recentIncidents: [{ kind: 'microsueño detectado', severity: 'medium' }] }),
    );
    expect(result.some((t) => t.topicId === 'fatiga')).toBe(true);
  });

  it('hallazgos EPP repetidos → topic epp', () => {
    const result = suggestTalks(ctx({ openFindingsByCategory: { epp: 5 } }));
    expect(result.some((t) => t.topicId === 'epp')).toBe(true);
  });

  it('orden y aseo: suma categorías', () => {
    const result = suggestTalks(
      ctx({ openFindingsByCategory: { orden_aseo: 1, housekeeping: 3 } }),
    );
    expect(result.some((t) => t.topicId === 'orden_aseo')).toBe(true);
  });

  it('nuevos trabajadores → topic inducción', () => {
    const result = suggestTalks(ctx({ newWorkersCount: 2 }));
    expect(result.some((t) => t.topicId === 'induccion_nuevos')).toBe(true);
  });

  it('combos suman scores: confinado hoy + riesgo activo → score alto', () => {
    const result = suggestTalks(
      ctx({
        activeRisks: ['confinado'],
        todaysTaskCategories: ['confinado'],
      }),
    );
    const conf = result.find((t) => t.topicId === 'confinado')!;
    expect(conf.score).toBeGreaterThanOrEqual(120); // 55 + 75
    expect(conf.rationale).toHaveLength(2);
  });

  it('topN respeta el límite', () => {
    const result = suggestTalks(
      ctx({
        activeRisks: ['altura', 'electric', 'confinado'],
        weather: { uvIndex: 10, windSpeedKmh: 60 },
        openFindingsByCategory: { epp: 5, orden_aseo: 5 },
      }),
      3,
    );
    expect(result).toHaveLength(3);
  });

  it('todo viene ordenado por score desc', () => {
    const result = suggestTalks(
      ctx({
        activeRisks: ['altura', 'confinado'],
        todaysTaskCategories: ['confinado'],
      }),
    );
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
