// CEAL-SM/SUSESO pure engine — boundary tests on every official threshold.
//
// LEGAL SOURCES under test (transcribed in cealSmDefinition.ts):
//   - Manual del Método Cuestionario CEAL-SM/SUSESO (cealsm.suseso.cl,
//     vigente 2023-12): Tabla 2 (tertile cut-offs per dimension), Anexo Nº 1
//     (item point values), §2.1.x (item composition).
//   - Protocolo de Vigilancia de Riesgos Psicosociales MINSAL oct. 2022:
//     Tabla 3 (center points per dimension, >=50% prevalence, tie → higher
//     risk), Tabla 4 (center risk bands -24..+1 / +2..+12 / +13..+24),
//     sección 9 (validity >= 60% participation), sección 8 (reevaluación
//     cada 2 años).

import { describe, it, expect } from 'vitest';
import {
  CEAL_DIMENSIONS,
  CEAL_ITEM_CODES,
  CEAL_SCALE_OPTIONS,
  CEAL_ANONYMITY_THRESHOLD,
  type CealDimension,
  type CealRiskLevel,
} from './cealSmDefinition';
import {
  validateCealAnswers,
  scoreCealDimension,
  classifyCealDimension,
  classifyCealCenter,
  evaluateCealSmCenter,
  type CealAnswers,
} from './cealSm';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimum valid points for an item of the given dimension. */
function itemMin(d: CealDimension, idx: number): number {
  const opts = CEAL_SCALE_OPTIONS[d.items[idx].scale].map((o) => o.points);
  return Math.min(...opts);
}
function itemMax(d: CealDimension, idx: number): number {
  const opts = CEAL_SCALE_OPTIONS[d.items[idx].scale].map((o) => o.points);
  return Math.max(...opts);
}

/**
 * Build a full 54-item answer set where every dimension scores exactly the
 * requested target (greedy distribution across the dimension's items).
 */
function answersWithDimensionScores(
  targets: Partial<Record<string, number>>,
): CealAnswers {
  const answers: CealAnswers = {};
  for (const d of CEAL_DIMENSIONS) {
    const min = d.scoreRange.min;
    const target = targets[d.id] ?? min;
    let remaining = target - min;
    if (remaining < 0) throw new Error(`target below min for ${d.id}`);
    d.items.forEach((item, idx) => {
      const lo = itemMin(d, idx);
      const hi = itemMax(d, idx);
      const add = Math.min(remaining, hi - lo);
      answers[item.code] = lo + add;
      remaining -= add;
    });
    if (remaining > 0) throw new Error(`target above max for ${d.id}`);
  }
  return answers;
}

/** A target score producing the requested individual risk level. */
function targetFor(d: CealDimension, level: CealRiskLevel): number {
  if (level === 'bajo') return d.scoreRange.min;
  if (level === 'medio') return d.cutoffs.lowMax + 1;
  return d.cutoffs.mediumMax + 1;
}

/** Full answer set placing EVERY dimension at the same risk level. */
function uniformAnswers(level: CealRiskLevel): CealAnswers {
  const targets: Partial<Record<string, number>> = {};
  for (const d of CEAL_DIMENSIONS) targets[d.id] = targetFor(d, level);
  return answersWithDimensionScores(targets);
}

// ── Instrument definition invariants (anti-drift) ────────────────────────

describe('CEAL-SM instrument definition (Manual SUSESO)', () => {
  it('contiene 12 dimensiones y 54 ítems (Sección II) con códigos únicos', () => {
    expect(CEAL_DIMENSIONS).toHaveLength(12);
    expect(CEAL_ITEM_CODES).toHaveLength(54);
    expect(new Set(CEAL_ITEM_CODES).size).toBe(54);
  });

  it('los rangos de puntaje coinciden con la suma de mínimos/máximos por ítem', () => {
    for (const d of CEAL_DIMENSIONS) {
      const min = d.items.reduce((s, _i, idx) => s + itemMin(d, idx), 0);
      const max = d.items.reduce((s, _i, idx) => s + itemMax(d, idx), 0);
      expect(d.scoreRange, d.id).toEqual({ min, max });
      expect(d.cutoffs.lowMax).toBeGreaterThanOrEqual(min - 1);
      expect(d.cutoffs.lowMax).toBeLessThan(d.cutoffs.mediumMax);
      expect(d.cutoffs.mediumMax).toBeLessThan(max);
    }
  });

  it('Tabla 2: puntos de corte oficiales por dimensión', () => {
    // Pinned verbatim from Tabla 2 (manual p. 27) — any edit to the
    // definition file that drifts from the official cut-offs fails here.
    const expected: Record<string, [number, number]> = {
      CT: [1, 4],
      EM: [1, 5],
      DP: [1, 5],
      RC: [4, 9],
      CR: [2, 5],
      QL: [2, 7],
      CM: [0, 4],
      IT: [2, 5],
      TV: [2, 5],
      CJ: [7, 12],
      VU: [6, 11],
      VA: [0, 14],
    };
    for (const d of CEAL_DIMENSIONS) {
      expect([d.cutoffs.lowMax, d.cutoffs.mediumMax], d.id).toEqual(
        expected[d.id],
      );
    }
  });
});

// ── Answer validation ────────────────────────────────────────────────────

describe('validateCealAnswers', () => {
  it('acepta un set completo y válido', () => {
    expect(() => validateCealAnswers(uniformAnswers('bajo'))).not.toThrow();
  });

  it('rechaza un ítem faltante', () => {
    const a = uniformAnswers('bajo');
    delete a.QD1;
    expect(() => validateCealAnswers(a)).toThrow(/CEAL-SM:.*QD1/);
  });

  it('rechaza códigos desconocidos', () => {
    const a = { ...uniformAnswers('bajo'), ZZ9: 0 };
    expect(() => validateCealAnswers(a)).toThrow(/CEAL-SM:.*ZZ9/);
  });

  it('rechaza valores no enteros y fuera de rango (0-4 frecuencia)', () => {
    const base = uniformAnswers('bajo');
    expect(() => validateCealAnswers({ ...base, QD1: 2.5 })).toThrow(/CEAL-SM/);
    expect(() => validateCealAnswers({ ...base, QD1: 5 })).toThrow(/CEAL-SM/);
    expect(() => validateCealAnswers({ ...base, QD1: -1 })).toThrow(/CEAL-SM/);
    expect(() => validateCealAnswers({ ...base, QD1: Number.NaN })).toThrow(/CEAL-SM/);
  });

  it('escala vulnerabilidad parte en 1: VU1=0 inválido, VU1=1 válido', () => {
    const base = uniformAnswers('bajo');
    expect(() => validateCealAnswers({ ...base, VU1: 0 })).toThrow(/CEAL-SM/);
    expect(() => validateCealAnswers({ ...base, VU1: 1 })).not.toThrow();
    expect(() => validateCealAnswers({ ...base, VU1: 4 })).not.toThrow();
  });
});

// ── Dimension scoring + tertile classification (Tabla 2) ─────────────────

describe('scoreCealDimension + classifyCealDimension', () => {
  it('suma los puntajes oficiales de los ítems de la dimensión', () => {
    const answers = answersWithDimensionScores({ CT: 7 });
    expect(scoreCealDimension('CT', answers)).toBe(7);
    // VU floor: 6 ítems × 1 punto.
    expect(scoreCealDimension('VU', answers)).toBe(6);
  });

  it('borde exacto de cada punto de corte para las 12 dimensiones', () => {
    for (const d of CEAL_DIMENSIONS) {
      // El valor del punto de corte se incluye en el nivel SUPERIOR
      // (manual, nota al pie 2 de la Tabla 2).
      expect(classifyCealDimension(d.id, d.scoreRange.min), d.id).toBe('bajo');
      if (d.cutoffs.lowMax >= d.scoreRange.min) {
        expect(classifyCealDimension(d.id, d.cutoffs.lowMax), d.id).toBe('bajo');
      }
      expect(classifyCealDimension(d.id, d.cutoffs.lowMax + 1), d.id).toBe('medio');
      expect(classifyCealDimension(d.id, d.cutoffs.mediumMax), d.id).toBe('medio');
      expect(classifyCealDimension(d.id, d.cutoffs.mediumMax + 1), d.id).toBe('alto');
      expect(classifyCealDimension(d.id, d.scoreRange.max), d.id).toBe('alto');
    }
  });

  it('ejemplo del manual (p. 27): RC bajo 0-4, medio 5-9, alto 10-32', () => {
    expect(classifyCealDimension('RC', 4)).toBe('bajo');
    expect(classifyCealDimension('RC', 5)).toBe('medio');
    expect(classifyCealDimension('RC', 9)).toBe('medio');
    expect(classifyCealDimension('RC', 10)).toBe('alto');
  });

  it('rechaza puntajes fuera del rango de la dimensión', () => {
    expect(() => classifyCealDimension('CT', 13)).toThrow(/CEAL-SM/);
    expect(() => classifyCealDimension('VU', 5)).toThrow(/CEAL-SM/);
  });
});

// ── Center risk bands (Protocolo Tabla 4) ────────────────────────────────

describe('classifyCealCenter (Tabla 4)', () => {
  it('bordes oficiales: +1→bajo, +2→medio, +12→medio, +13→alto', () => {
    expect(classifyCealCenter(-24)).toBe('bajo');
    expect(classifyCealCenter(0)).toBe('bajo');
    expect(classifyCealCenter(1)).toBe('bajo');
    expect(classifyCealCenter(2)).toBe('medio');
    expect(classifyCealCenter(12)).toBe('medio');
    expect(classifyCealCenter(13)).toBe('alto');
    expect(classifyCealCenter(24)).toBe('alto');
  });
});

// ── Center evaluation end-to-end (Tabla 3 + Tabla 4 + sección 9) ─────────

describe('evaluateCealSmCenter', () => {
  it('todas las dimensiones ≥50% en alto → +24 puntos, centro en riesgo alto', () => {
    const responses = Array.from({ length: 10 }, () => uniformAnswers('alto'));
    const r = evaluateCealSmCenter({ responses, totalWorkers: 10 });
    expect(r.centerScore).toBe(24);
    expect(r.centerRisk).toBe('alto');
    expect(r.dimensions).toHaveLength(12);
    for (const d of r.dimensions) {
      expect(d.centerPoints).toBe(2);
      expect(d.percentages.alto).toBe(100);
    }
    expect(r.participationRate).toBe(1);
    expect(r.evaluationValid).toBe(true);
    expect(r.reevaluationYears).toBe(2);
  });

  it('todas ≥50% en bajo → -24 puntos, riesgo bajo (dimensiones de protección)', () => {
    const responses = Array.from({ length: 10 }, () => uniformAnswers('bajo'));
    const r = evaluateCealSmCenter({ responses, totalWorkers: 10 });
    expect(r.centerScore).toBe(-24);
    expect(r.centerRisk).toBe('bajo');
    for (const d of r.dimensions) expect(d.centerPoints).toBe(-2);
  });

  it('umbral 50% exacto cuenta (≥, no >): 5 de 10 en alto → +2', () => {
    const responses = [
      ...Array.from({ length: 5 }, () => uniformAnswers('alto')),
      ...Array.from({ length: 5 }, () => uniformAnswers('bajo')),
    ];
    const r = evaluateCealSmCenter({ responses, totalWorkers: 10 });
    // Empate 50% alto / 50% bajo → se asigna el puntaje del riesgo MAYOR
    // (Protocolo Tabla 3, última fila).
    for (const d of r.dimensions) expect(d.centerPoints).toBe(2);
    expect(r.centerScore).toBe(24);
    expect(r.centerRisk).toBe('alto');
  });

  it('empate 50% medio / 50% bajo → riesgo mayor = medio → +1 por dimensión', () => {
    const responses = [
      ...Array.from({ length: 5 }, () => uniformAnswers('medio')),
      ...Array.from({ length: 5 }, () => uniformAnswers('bajo')),
    ];
    const r = evaluateCealSmCenter({ responses, totalWorkers: 10 });
    for (const d of r.dimensions) expect(d.centerPoints).toBe(1);
    expect(r.centerScore).toBe(12);
    expect(r.centerRisk).toBe('medio');
  });

  it('sin nivel ≥50% → 0 puntos (4 alto / 3 medio / 3 bajo en 10)', () => {
    const responses = [
      ...Array.from({ length: 4 }, () => uniformAnswers('alto')),
      ...Array.from({ length: 3 }, () => uniformAnswers('medio')),
      ...Array.from({ length: 3 }, () => uniformAnswers('bajo')),
    ];
    const r = evaluateCealSmCenter({ responses, totalWorkers: 10 });
    for (const d of r.dimensions) {
      expect(d.centerPoints).toBe(0);
      expect(d.counts).toEqual({ bajo: 3, medio: 3, alto: 4 });
    }
    expect(r.centerScore).toBe(0);
    expect(r.centerRisk).toBe('bajo');
  });

  it('validez de la evaluación: 59/100 inválida, 60/100 válida (sección 9)', () => {
    const mk = (n: number) =>
      evaluateCealSmCenter({
        responses: Array.from({ length: n }, () => uniformAnswers('bajo')),
        totalWorkers: 100,
      });
    const r59 = mk(59);
    expect(r59.participationRate).toBeCloseTo(0.59, 10);
    expect(r59.evaluationValid).toBe(false);
    const r60 = mk(60);
    expect(r60.participationRate).toBeCloseTo(0.6, 10);
    expect(r60.evaluationValid).toBe(true);
  });

  it('acciones exigidas: vigilancia ambiental con plazos 180/270/360 en riesgo alto', () => {
    const alto = evaluateCealSmCenter({
      responses: Array.from({ length: 10 }, () => uniformAnswers('alto')),
      totalWorkers: 10,
    });
    const joined = alto.requiredActions.join(' ');
    expect(joined).toMatch(/vigilancia/i);
    expect(joined).toMatch(/180/);
    expect(joined).toMatch(/270/);
    expect(joined).toMatch(/360/);

    const bajo = evaluateCealSmCenter({
      responses: Array.from({ length: 10 }, () => uniformAnswers('bajo')),
      totalWorkers: 10,
    });
    expect(bajo.requiredActions.join(' ')).toMatch(/2 años/);
  });

  it('participación deficiente agrega la acción de repetir el proceso', () => {
    const r = evaluateCealSmCenter({
      responses: Array.from({ length: 10 }, () => uniformAnswers('bajo')),
      totalWorkers: 100,
    });
    expect(r.evaluationValid).toBe(false);
    expect(r.requiredActions.join(' ')).toMatch(/60%/);
  });

  it('rechaza inputs inválidos (sin respuestas, totalWorkers no positivo, respuesta corrupta)', () => {
    expect(() =>
      evaluateCealSmCenter({ responses: [], totalWorkers: 10 }),
    ).toThrow(/CEAL-SM/);
    expect(() =>
      evaluateCealSmCenter({
        responses: [uniformAnswers('bajo')],
        totalWorkers: 0,
      }),
    ).toThrow(/CEAL-SM/);
    const bad = uniformAnswers('bajo');
    delete bad.HO;
    expect(() =>
      evaluateCealSmCenter({ responses: [bad], totalWorkers: 10 }),
    ).toThrow(/CEAL-SM/);
  });

  it('el umbral de anonimato exportado es ≥ al precedente k=5 del repo', () => {
    // El gate se aplica en la ruta (server) — aquí solo se fija la constante
    // para que un refactor no la degrade silenciosamente.
    expect(CEAL_ANONYMITY_THRESHOLD).toBeGreaterThanOrEqual(5);
    expect(CEAL_ANONYMITY_THRESHOLD).toBe(10);
  });
});
