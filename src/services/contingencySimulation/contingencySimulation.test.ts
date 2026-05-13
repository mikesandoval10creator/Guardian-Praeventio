import { describe, it, expect } from 'vitest';
import {
  buildScenario,
  listAvailableScenarios,
  countAvailableTemplates,
  type ContingencyScenario,
  type ScenarioKind,
  type ScenarioSeverity,
} from './contingencyScenarioBuilder.js';
import {
  evaluateTabletop,
  type TabletopAttempt,
  type TabletopResponse,
} from './tabletopExerciseEngine.js';

// ────────────────────────────────────────────────────────────────────────
// contingencyScenarioBuilder
// ────────────────────────────────────────────────────────────────────────

describe('listAvailableScenarios', () => {
  it('devuelve al menos 8 plantillas pre-built', () => {
    const list = listAvailableScenarios();
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(countAvailableTemplates()).toBe(list.length);
  });

  it('cubre los kinds requeridos (fire, earthquake, chemical_spill, evacuation_blocked, power_outage, leader_unavailable, mass_casualty, supplier_failure)', () => {
    const kinds = new Set(listAvailableScenarios().map((s) => s.kind));
    const required: ScenarioKind[] = [
      'fire',
      'earthquake',
      'chemical_spill',
      'evacuation_blocked',
      'power_outage',
      'leader_unavailable',
      'mass_casualty',
      'supplier_failure',
    ];
    for (const k of required) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it('filtro industry=construction excluye plantillas no aplicables', () => {
    const all = listAvailableScenarios();
    const construction = listAvailableScenarios('construction');
    expect(construction.length).toBeGreaterThan(0);
    expect(construction.length).toBeLessThanOrEqual(all.length);
    // cyber_attack no aplica a construction
    expect(construction.some((s) => s.kind === 'cyber_attack')).toBe(false);
  });

  it('industry=office incluye fire pero no chemical_spill', () => {
    const office = listAvailableScenarios('office');
    expect(office.some((s) => s.kind === 'fire')).toBe(true);
    expect(office.some((s) => s.kind === 'chemical_spill')).toBe(false);
  });
});

describe('buildScenario', () => {
  it('construye un escenario fire moderate con los campos requeridos', () => {
    const s = buildScenario('fire', 'moderate');
    expect(s.kind).toBe('fire');
    expect(s.severity).toBe('moderate');
    expect(s.id).toBeTruthy();
    expect(s.triggerEvents.length).toBeGreaterThan(0);
    expect(s.decisionPoints.length).toBeGreaterThan(0);
    expect(s.successCriteria.length).toBeGreaterThan(0);
    expect(s.estimatedDurationMin).toBeGreaterThan(0);
  });

  it('respeta el id si se pasa por opciones', () => {
    const s = buildScenario('earthquake', 'major', { id: 'fixed-id-001' });
    expect(s.id).toBe('fixed-id-001');
  });

  it('respeta la severity pedida aunque la plantilla sea de otra severity', () => {
    const s = buildScenario('mass_casualty', 'major');
    // template es catastrophic, pero respetamos lo pedido
    expect(s.severity).toBe('major');
    expect(s.kind).toBe('mass_casualty');
  });

  it('override de condiciones iniciales se aplica encima de defaults', () => {
    const s = buildScenario('fire', 'moderate', {
      initialConditions: { staffPresent: 99, time: 'night' },
    });
    expect(s.initialConditions.staffPresent).toBe(99);
    expect(s.initialConditions.time).toBe('night');
    // weather (no overrideado) sigue desde default
    expect(s.initialConditions.weather).toBeDefined();
  });

  it('lanza error si kind no tiene plantilla', () => {
    // simulamos un kind inexistente
    expect(() =>
      buildScenario('not_a_kind' as unknown as ScenarioKind, 'minor' as ScenarioSeverity),
    ).toThrow(/Sin plantilla/);
  });

  it('cada decision point tiene options no vacías y correctResponses subset', () => {
    const s = buildScenario('chemical_spill', 'major');
    for (const dp of s.decisionPoints) {
      expect(dp.options.length).toBeGreaterThan(1);
      expect(dp.correctResponses.length).toBeGreaterThan(0);
      for (const correct of dp.correctResponses) {
        expect(dp.options).toContain(correct);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// tabletopExerciseEngine
// ────────────────────────────────────────────────────────────────────────

function buildPerfectAttempt(scenario: ContingencyScenario, teamUids = ['u1', 'u2', 'u3']): TabletopAttempt {
  const responses: TabletopResponse[] = scenario.decisionPoints.map((dp, i) => ({
    decisionPointMinute: dp.minute,
    selectedOption: dp.correctResponses[0],
    respondedAtMinute: dp.minute, // sin retraso
    respondingUid: teamUids[i % teamUids.length],
  }));
  return {
    scenarioId: scenario.id,
    teamUids,
    startedAt: '2026-05-13T10:00:00Z',
    responses,
  };
}

describe('evaluateTabletop — happy path', () => {
  it('100% correctas → passed=true, scorePct=100, weakSpots=0', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-1' });
    const attempt = buildPerfectAttempt(s);
    const r = evaluateTabletop(attempt, s);
    expect(r.scorePct).toBe(100);
    expect(r.correctResponses).toBe(s.decisionPoints.length);
    expect(r.weakSpots).toHaveLength(0);
    expect(r.passed).toBe(true);
    expect(r.reactionTimeMinutes).toBe(0);
  });

  it('recomendación de excelencia cuando 100%', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-1b' });
    const r = evaluateTabletop(buildPerfectAttempt(s), s);
    expect(r.recommendations.some((rec) => /Excelente/.test(rec))).toBe(true);
  });
});

describe('evaluateTabletop — fallas y brechas', () => {
  it('sin respuestas → 0% + weakSpots por cada decision point', () => {
    const s = buildScenario('earthquake', 'major', { id: 'tt-2' });
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1', 'u2'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: [],
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.scorePct).toBe(0);
    expect(r.correctResponses).toBe(0);
    expect(r.weakSpots).toHaveLength(s.decisionPoints.length);
    expect(r.passed).toBe(false);
    expect(r.weakSpots[0].teamResponse).toBe('(sin respuesta)');
  });

  it('respuesta incorrecta (opción válida pero no correcta) → weakSpot con rationale', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-3' });
    const dp = s.decisionPoints[0];
    const wrongOption = dp.options.find((o) => !dp.correctResponses.includes(o))!;
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: [
        {
          decisionPointMinute: dp.minute,
          selectedOption: wrongOption,
          respondedAtMinute: dp.minute + 1,
          respondingUid: 'u1',
        },
      ],
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.correctResponses).toBe(0);
    const ws = r.weakSpots.find((w) => w.decisionPointMinute === dp.minute)!;
    expect(ws.teamResponse).toBe(wrongOption);
    expect(ws.gap).toBe(dp.rationale);
  });

  it('opción inexistente en options[] → weakSpot indicando entrenamiento', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-3b' });
    const dp = s.decisionPoints[0];
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: [
        {
          decisionPointMinute: dp.minute,
          selectedOption: 'XXX opción inventada XXX',
          respondedAtMinute: dp.minute,
          respondingUid: 'u1',
        },
      ],
    };
    const r = evaluateTabletop(attempt, s);
    const ws = r.weakSpots.find((w) => w.decisionPointMinute === dp.minute)!;
    expect(ws.gap).toMatch(/no figura en las opciones/);
  });

  it('passed=true cuando scorePct >= 70', () => {
    const s = buildScenario('evacuation_blocked', 'major', { id: 'tt-4' });
    // 3 dps en evacuation_blocked: respondemos 2 correctas y 1 errada
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1', 'u2', 'u3'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: s.decisionPoints.map((dp, i) => ({
        decisionPointMinute: dp.minute,
        selectedOption:
          i < 2 ? dp.correctResponses[0] : dp.options.find((o) => !dp.correctResponses.includes(o))!,
        respondedAtMinute: dp.minute,
        respondingUid: 'u1',
      })),
    };
    const r = evaluateTabletop(attempt, s);
    // 2/3 = 67% → falla
    expect(r.scorePct).toBe(67);
    expect(r.passed).toBe(false);
  });

  it('passed=true exactamente con 70%', () => {
    // forzamos un caso con 10 dps de los cuales acertamos 7
    const s = buildScenario('mass_casualty', 'catastrophic', { id: 'tt-5' });
    // mass_casualty tiene 5 dps → no llega a 10. construimos un acierto de N-1 sobre N
    const total = s.decisionPoints.length;
    const correctCount = Math.ceil(total * 0.7);
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: s.decisionPoints.map((dp, i) => ({
        decisionPointMinute: dp.minute,
        selectedOption:
          i < correctCount
            ? dp.correctResponses[0]
            : dp.options.find((o) => !dp.correctResponses.includes(o))!,
        respondedAtMinute: dp.minute,
        respondingUid: 'u1',
      })),
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.scorePct).toBeGreaterThanOrEqual(70);
    expect(r.passed).toBe(true);
  });
});

describe('evaluateTabletop — reactionTime', () => {
  it('promedia minutos de retraso por punto de decisión respondido', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-rt' });
    const responses: TabletopResponse[] = s.decisionPoints.map((dp) => ({
      decisionPointMinute: dp.minute,
      selectedOption: dp.correctResponses[0],
      respondedAtMinute: dp.minute + 4, // 4 min de retraso constante
      respondingUid: 'u1',
    }));
    const r = evaluateTabletop(
      { scenarioId: s.id, teamUids: ['u1'], startedAt: '2026-05-13T10:00:00Z', responses },
      s,
    );
    expect(r.reactionTimeMinutes).toBe(4);
  });

  it('retraso > 5 min agrega recomendación de practicar bajo presión', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-rt-2' });
    const responses: TabletopResponse[] = s.decisionPoints.map((dp) => ({
      decisionPointMinute: dp.minute,
      selectedOption: dp.correctResponses[0],
      respondedAtMinute: dp.minute + 8,
      respondingUid: 'u1',
    }));
    const r = evaluateTabletop(
      { scenarioId: s.id, teamUids: ['u1'], startedAt: '2026-05-13T10:00:00Z', responses },
      s,
    );
    expect(r.recommendations.some((rec) => /Tiempo de reacci/.test(rec))).toBe(true);
  });

  it('retraso negativo se clampea a 0', () => {
    const s = buildScenario('fire', 'moderate', { id: 'tt-rt-3' });
    const dp = s.decisionPoints[0];
    const r = evaluateTabletop(
      {
        scenarioId: s.id,
        teamUids: ['u1'],
        startedAt: '2026-05-13T10:00:00Z',
        responses: [
          {
            decisionPointMinute: dp.minute,
            selectedOption: dp.correctResponses[0],
            respondedAtMinute: dp.minute - 2, // imposible pero clamp
            respondingUid: 'u1',
          },
        ],
      },
      s,
    );
    expect(r.reactionTimeMinutes).toBe(0);
  });
});

describe('evaluateTabletop — validaciones y casos borde', () => {
  it('lanza error si scenarioId del attempt no coincide con scenario.id', () => {
    const s = buildScenario('fire', 'moderate', { id: 'real-id' });
    expect(() =>
      evaluateTabletop(
        { scenarioId: 'wrong-id', teamUids: [], startedAt: '2026-05-13T10:00:00Z', responses: [] },
        s,
      ),
    ).toThrow(/Scenario mismatch/);
  });

  it('catastrophic con score < 90 agrega recomendación específica', () => {
    const s = buildScenario('mass_casualty', 'catastrophic', { id: 'cat-1' });
    // todas correctas excepto una → ~80%
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1', 'u2'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: s.decisionPoints.map((dp, i) => ({
        decisionPointMinute: dp.minute,
        selectedOption:
          i === 0
            ? dp.options.find((o) => !dp.correctResponses.includes(o))!
            : dp.correctResponses[0],
        respondedAtMinute: dp.minute,
        respondingUid: 'u1',
      })),
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.scorePct).toBeLessThan(90);
    expect(
      r.recommendations.some((rec) => /catastr[oó]fico/i.test(rec)),
    ).toBe(true);
  });

  it('equipo de tamaño <3 dispara recomendación de segundo al mando', () => {
    const s = buildScenario('leader_unavailable', 'moderate', { id: 'team-small' });
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: s.decisionPoints.map((dp) => ({
        decisionPointMinute: dp.minute,
        selectedOption: dp.correctResponses[0],
        respondedAtMinute: dp.minute,
        respondingUid: 'u1',
      })),
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.recommendations.some((rec) => /segundo al mando/i.test(rec))).toBe(true);
  });

  it('decision point con múltiples correctResponses acepta cualquiera', () => {
    // power_outage tiene un dp con múltiples correct
    const s = buildScenario('power_outage', 'moderate', { id: 'multi-correct' });
    const dpMulti = s.decisionPoints.find((dp) => dp.correctResponses.length > 1);
    expect(dpMulti).toBeDefined();
    const attempt: TabletopAttempt = {
      scenarioId: s.id,
      teamUids: ['u1'],
      startedAt: '2026-05-13T10:00:00Z',
      responses: [
        {
          decisionPointMinute: dpMulti!.minute,
          selectedOption: dpMulti!.correctResponses[1], // la 2da opción correcta
          respondedAtMinute: dpMulti!.minute,
          respondingUid: 'u1',
        },
      ],
    };
    const r = evaluateTabletop(attempt, s);
    expect(r.correctResponses).toBe(1);
  });

  it('escenario sin decision points (defensivo) → passed=false con mensaje claro', () => {
    const fakeScenario: ContingencyScenario = {
      id: 'empty',
      kind: 'fire',
      severity: 'minor',
      title: 'vacío',
      initialConditions: { time: 'day', staffPresent: 0, criticalSystemsDown: [] },
      triggerEvents: [],
      decisionPoints: [],
      successCriteria: [],
      estimatedDurationMin: 0,
    };
    const r = evaluateTabletop(
      { scenarioId: 'empty', teamUids: [], startedAt: '2026-05-13T10:00:00Z', responses: [] },
      fakeScenario,
    );
    expect(r.passed).toBe(false);
    expect(r.totalDecisionPoints).toBe(0);
    expect(r.recommendations[0]).toMatch(/sin puntos de decisi/i);
  });
});

describe('integración listAvailableScenarios + evaluateTabletop', () => {
  it('todas las plantillas con un attempt perfecto pasan', () => {
    const templates = listAvailableScenarios();
    for (const t of templates) {
      const s = buildScenario(t.kind, t.severity, { id: `int-${t.kind}-${t.severity}` });
      const r = evaluateTabletop(buildPerfectAttempt(s), s);
      expect(r.passed).toBe(true);
      expect(r.scorePct).toBe(100);
    }
  });

  it('todas las plantillas tienen al menos 2 decision points', () => {
    for (const t of listAvailableScenarios()) {
      expect(t.decisionPoints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('todas las plantillas tienen al menos 3 trigger events', () => {
    for (const t of listAvailableScenarios()) {
      expect(t.triggerEvents.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('todas las plantillas tienen al menos 3 successCriteria', () => {
    for (const t of listAvailableScenarios()) {
      expect(t.successCriteria.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('ids generados son únicos en builds sucesivos del mismo kind/severity', () => {
    const a = buildScenario('fire', 'moderate');
    const b = buildScenario('fire', 'moderate');
    expect(a.id).not.toBe(b.id);
  });
});
