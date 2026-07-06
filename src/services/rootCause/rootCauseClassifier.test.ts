import { describe, it, expect } from 'vitest';
import {
  buildAnalysis,
  computeStats,
  normalizeRootCauseAnalysis,
  RootCauseValidationError,
  type BuildAnalysisInput,
} from './rootCauseClassifier.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function input(over: Partial<BuildAnalysisInput> = {}): BuildAnalysisInput {
  return {
    incidentId: 'inc-1',
    factors: ['falla_procedimiento', 'falla_supervision'],
    primaryFactor: 'falla_procedimiento',
    fiveWhys: [
      'Por qué el trabajador no usó arnés en el techo',
      'Por qué el supervisor no controló previamente',
      'Por qué el procedimiento no exigía verificación documentada',
      'Por qué nadie había actualizado el procedimiento en 3 años',
    ],
    analyzedByUid: 'prev-1',
    suggestedActions: ['Actualizar procedimiento RIOHS punto 4.2', 'Capacitar supervisores'],
    now: NOW,
    ...over,
  };
}

describe('buildAnalysis', () => {
  it('crea análisis válido', () => {
    const a = buildAnalysis(input());
    expect(a.primaryFactor).toBe('falla_procedimiento');
    expect(a.factors).toContain('falla_supervision');
    expect(a.fiveWhys).toHaveLength(4);
  });

  it('rechaza factors vacío', () => {
    expect(() => buildAnalysis(input({ factors: [] }))).toThrow(/NO_FACTORS/);
  });

  it('rechaza primaryFactor no presente en factors', () => {
    expect(() =>
      buildAnalysis(input({ primaryFactor: 'falla_diseno' as any })),
    ).toThrow(/PRIMARY_NOT_IN_FACTORS/);
  });

  it('rechaza fiveWhys > 5 entradas', () => {
    expect(() =>
      buildAnalysis(
        input({
          fiveWhys: [
            'Por qué ocurrió el incidente original a las 14:00',
            'Por qué el operador no usó EPP completo en altura',
            'Por qué la supervisión no detectó el ausente',
            'Por qué el procedimiento no preveía esa condición específica',
            'Por qué no se hizo análisis de cambio cuando hubo turno nuevo',
            'Por qué la cultura organizacional no priorizó update procedural',
          ],
        }),
      ),
    ).toThrow(/FIVE_WHYS_OUT_OF_RANGE/);
  });

  it('rechaza "porqué" corto', () => {
    expect(() => buildAnalysis(input({ fiveWhys: ['corto'] }))).toThrow(/WHY_TOO_SHORT/);
  });

  it('rechaza sin suggestedActions', () => {
    expect(() => buildAnalysis(input({ suggestedActions: [] }))).toThrow(/NO_ACTIONS/);
  });

  it('deduplica factors', () => {
    const a = buildAnalysis(
      input({
        factors: ['falla_procedimiento', 'falla_procedimiento', 'falla_supervision'],
      }),
    );
    expect(a.factors).toHaveLength(2);
  });
});

describe('computeStats', () => {
  it('cuenta por factor + top 3 primary', () => {
    const analyses = [
      buildAnalysis(
        input({
          incidentId: 'i1',
          factors: ['falla_procedimiento'],
          primaryFactor: 'falla_procedimiento',
        }),
      ),
      buildAnalysis(
        input({
          incidentId: 'i2',
          factors: ['falla_procedimiento', 'falla_capacitacion'],
          primaryFactor: 'falla_procedimiento',
        }),
      ),
      buildAnalysis(
        input({
          incidentId: 'i3',
          factors: ['falla_supervision'],
          primaryFactor: 'falla_supervision',
        }),
      ),
    ];
    const stats = computeStats(analyses);
    expect(stats.totalAnalyses).toBe(3);
    expect(stats.countByFactor.falla_procedimiento).toBe(2);
    expect(stats.countByFactor.falla_supervision).toBe(1);
    expect(stats.topPrimaryFactors[0].factor).toBe('falla_procedimiento');
    expect(stats.topPrimaryFactors[0].percentOfTotal).toBe(67); // 2/3
  });

  it('lista vacía → todo cero', () => {
    const stats = computeStats([]);
    expect(stats.totalAnalyses).toBe(0);
    expect(stats.topPrimaryFactors).toEqual([]);
  });
});

// Persisted Firestore docs are NOT guaranteed to match the current schema:
// a doc written by older code (or a partial/manual write) may lack the array
// fields. `subscribeRootCauseAnalyses` used to spread `d.data()` verbatim, so a
// doc missing `factors`/`fiveWhys`/`suggestedActions` reached the /root-cause
// page as `undefined` and crashed it (`a.factors.map` in analysisToTree,
// `for (const f of a.factors)` in computeStats). This normalizer is the single
// read-time guard every consumer now flows through.
describe('normalizeRootCauseAnalysis', () => {
  it('a partial doc (missing arrays) yields empty arrays, never undefined', () => {
    const n = normalizeRootCauseAnalysis({ analyzedAt: '2026-07-06T00:00:00Z' }, 'inc-partial');
    expect(n.incidentId).toBe('inc-partial');
    expect(Array.isArray(n.factors)).toBe(true);
    expect(n.factors).toEqual([]);
    expect(Array.isArray(n.fiveWhys)).toBe(true);
    expect(n.fiveWhys).toEqual([]);
    expect(Array.isArray(n.suggestedActions)).toBe(true);
    expect(n.suggestedActions).toEqual([]);
  });

  it('the normalized partial doc no longer crashes computeStats', () => {
    const n = normalizeRootCauseAnalysis({ analyzedAt: '2026-07-06T00:00:00Z' }, 'inc-partial');
    expect(() => computeStats([n])).not.toThrow();
    const stats = computeStats([n]);
    expect(stats.totalAnalyses).toBe(1);
  });

  it('primaryFactor falls back to a valid factor when missing', () => {
    const withFactors = normalizeRootCauseAnalysis({ factors: ['falla_epp'] }, 'i1');
    expect(withFactors.primaryFactor).toBe('falla_epp'); // first present factor
    const withNothing = normalizeRootCauseAnalysis({}, 'i2');
    expect(withNothing.primaryFactor).toBe('condicion_subestandar'); // neutral default
  });

  it('coerces non-array garbage to empty arrays', () => {
    const n = normalizeRootCauseAnalysis(
      { factors: 'falla_epp', fiveWhys: 42, suggestedActions: null },
      'i-garbage',
    );
    expect(n.factors).toEqual([]);
    expect(n.fiveWhys).toEqual([]);
    expect(n.suggestedActions).toEqual([]);
  });

  it('drops unknown factor strings but keeps valid ones', () => {
    const n = normalizeRootCauseAnalysis(
      { factors: ['falla_epp', 'not_a_real_factor', 'falla_diseno'] },
      'i-mixed',
    );
    expect(n.factors).toEqual(['falla_epp', 'falla_diseno']);
  });

  it('null / undefined raw input is safe', () => {
    expect(() => normalizeRootCauseAnalysis(null, 'i-null')).not.toThrow();
    expect(() => normalizeRootCauseAnalysis(undefined, 'i-undef')).not.toThrow();
    expect(normalizeRootCauseAnalysis(null, 'i-null').factors).toEqual([]);
  });

  it('a well-formed doc passes through, with incidentId forced from the doc id', () => {
    const full = buildAnalysis(input());
    const n = normalizeRootCauseAnalysis({ ...full, incidentId: 'stale-id' }, 'doc-id-wins');
    expect(n.incidentId).toBe('doc-id-wins');
    expect(n.factors).toEqual(full.factors);
    expect(n.fiveWhys).toEqual(full.fiveWhys);
    expect(n.suggestedActions).toEqual(full.suggestedActions);
    expect(n.primaryFactor).toBe(full.primaryFactor);
  });
});
