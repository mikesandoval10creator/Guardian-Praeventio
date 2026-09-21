import { describe, it, expect } from 'vitest';
import {
  composeShiftRiskPanel,
  type ShiftRiskInputs,
} from './preShiftRiskComposer.js';

function inputs(over: Partial<ShiftRiskInputs> = {}): ShiftRiskInputs {
  return {
    projectId: 'p1',
    shift: 'day',
    date: '2026-05-12',
    weather: {
      rainProbability: 0,
      windSpeedMs: 3,
      uvIndex: 5,
      temperatureC: 20,
      visibilityKm: 10,
    },
    workers: [],
    plannedTasks: [],
    equipment: [],
    recentIncidents: [],
    activePermitsCount: 0,
    emergencyBrigadeReady: true,
    ...over,
  };
}

describe('composeShiftRiskPanel - happy path', () => {
  it('día perfecto sin factores → score 0 + green', () => {
    const r = composeShiftRiskPanel(inputs());
    expect(r.riskScore).toBe(0);
    expect(r.level).toBe('green');
    expect(r.factors).toHaveLength(0);
    expect(r.recommendDelayShiftStart).toBe(false);
  });
});

describe('shift period base weight', () => {
  it('turno noche aporta peso base', () => {
    const r = composeShiftRiskPanel(inputs({ shift: 'night' }));
    expect(r.factors.find((f) => f.id === 'shift-base')).toBeDefined();
    expect(r.riskScore).toBeGreaterThan(0);
  });

  it('turno día sin factores → no factor shift-base', () => {
    const r = composeShiftRiskPanel(inputs({ shift: 'day' }));
    expect(r.factors.find((f) => f.id === 'shift-base')).toBeUndefined();
  });
});

describe('weather factors', () => {
  it('tormenta eléctrica próxima → factor con peso 25', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: {
          rainProbability: 0,
          windSpeedMs: 3,
          uvIndex: 5,
          temperatureC: 20,
          visibilityKm: 10,
          lightningRiskWithinHours: 2,
        },
      }),
    );
    const f = r.factors.find((x) => x.id === 'lightning');
    expect(f?.weight).toBe(25);
  });

  it('lluvia >70% → factor rain', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: {
          rainProbability: 0.8,
          windSpeedMs: 3,
          uvIndex: 5,
          temperatureC: 20,
          visibilityKm: 10,
        },
      }),
    );
    expect(r.factors.find((x) => x.id === 'rain')).toBeDefined();
  });

  it('viento >11 m/s → factor wind con recomendación izaje', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: {
          rainProbability: 0,
          windSpeedMs: 14,
          uvIndex: 5,
          temperatureC: 20,
          visibilityKm: 10,
        },
      }),
    );
    const f = r.factors.find((x) => x.id === 'wind');
    expect(f?.recommendation).toMatch(/Suspender izaje/);
  });

  it('UV ≥ 11 → factor uv-extreme', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: { rainProbability: 0, windSpeedMs: 3, uvIndex: 12, temperatureC: 20, visibilityKm: 10 },
      }),
    );
    expect(r.factors.find((x) => x.id === 'uv-extreme')).toBeDefined();
  });

  it('temp ≥32°C → factor heat', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: { rainProbability: 0, windSpeedMs: 3, uvIndex: 5, temperatureC: 35, visibilityKm: 10 },
      }),
    );
    expect(r.factors.find((x) => x.id === 'heat')).toBeDefined();
  });

  it('visibilidad <1km → factor low-visibility', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: { rainProbability: 0, windSpeedMs: 3, uvIndex: 5, temperatureC: 20, visibilityKm: 0.5 },
      }),
    );
    expect(r.factors.find((x) => x.id === 'low-visibility')).toBeDefined();
  });
});

describe('fatigue', () => {
  it('1+ trabajador high fatigue → factor fatigue con nombres', () => {
    const r = composeShiftRiskPanel(
      inputs({
        workers: [
          { uid: 'w1', fullName: 'Ana', fatigueRisk: 'high', daysSinceHire: 100 },
          { uid: 'w2', fullName: 'Bruno', fatigueRisk: 'low', daysSinceHire: 50 },
        ],
      }),
    );
    const f = r.factors.find((x) => x.id === 'fatigue');
    expect(f?.recommendation).toMatch(/Ana/);
  });
});

describe('new workers', () => {
  it('trabajadores <14 días → factor new-workers', () => {
    const r = composeShiftRiskPanel(
      inputs({
        workers: [
          { uid: 'w1', fullName: 'Nuevo1', daysSinceHire: 3 },
          { uid: 'w2', fullName: 'Nuevo2', daysSinceHire: 10 },
        ],
      }),
    );
    const f = r.factors.find((x) => x.id === 'new-workers');
    expect(f).toBeDefined();
    expect(f?.weight).toBe(10);
  });
});

describe('critical tasks', () => {
  it('tareas críticas → factor critical-tasks', () => {
    // [Hy3-audit] Resolves [Audit-2026-08-31] PreShiftRisk —
    // activePermitsCount y requiresPermit no afectan el score. The
    // legacy test defaulted `activePermitsCount` to 0 and asserted
    // weight=8 — which is the unmitigated-risk weight pre-fix but
    // depended on the tautology. Post-fix the same fixture would
    // show weight=20 (base 8 + 12 gap penalty). To preserve the
    // documented intent ("with sufficient permits, weight is 8"),
    // we now explicitly set activePermitsCount: 5 so 2 permit-
    // requiring tasks are fully covered.
    const r = composeShiftRiskPanel(
      inputs({
        activePermitsCount: 5,
        plannedTasks: [
          { id: 't1', category: 'altura', isCriticalTask: true, requiresPermit: true },
          { id: 't2', category: 'caliente', isCriticalTask: true, requiresPermit: true },
        ],
      }),
    );
    expect(r.factors.find((x) => x.id === 'critical-tasks')?.weight).toBe(8);
  });

  // [Hy3-audit] Resolves [Audit-2026-08-31] PreShiftRisk —
  // activePermitsCount y requiresPermit no afectan el score. The
  // legacy `criticalTasksFactor` used a tautological check
  // (`t.requiresPermit && !t.requiresPermit`) that always evaluated
  // to false, dropped the result with `void`, and returned a base
  // weight that ignored whether permits were actually active. A
  // turn with N critical tasks that all require permits got the
  // same score whether 0 or N permits were active — a real
  // vida-safety gap. The fix uses the `activePermitsCount` from
  // the route input: when permits-required tasks exceed the
  // active permits, the gap is unmitigated risk and the weight
  // scales up; when permits ≥ required, the gap is zero.
  it('crítico con requiresPermit y activePermitsCount=0 → factor sube (brecha sin mitigar)', () => {
    const r = composeShiftRiskPanel(
      inputs({
        activePermitsCount: 0,
        plannedTasks: [
          { id: 't1', category: 'altura', isCriticalTask: true, requiresPermit: true },
        ],
      }),
    );
    const f = r.factors.find((x) => x.id === 'critical-tasks');
    // Antes del fix: weight=4 (base). Después: weight sube para
    // reflejar la brecha (unmitigated). El número exacto lo decide
    // la implementación; lo importante es que sea MAYOR que la base
    // y mayor que el caso con permisos suficientes.
    expect(f).toBeDefined();
    expect(f!.weight).toBeGreaterThan(4);
  });

  it('crítico con requiresPermit y activePermitsCount suficiente → factor base (sin brecha)', () => {
    const r = composeShiftRiskPanel(
      inputs({
        activePermitsCount: 5,
        plannedTasks: [
          { id: 't1', category: 'altura', isCriticalTask: true, requiresPermit: true },
          { id: 't2', category: 'caliente', isCriticalTask: true, requiresPermit: true },
        ],
      }),
    );
    // Con permisos suficientes, el comportamiento actual (base
    // weight por número de tareas críticas) NO cambia — el fix solo
    // añade severidad cuando hay brecha, no cuando hay cobertura.
    expect(r.factors.find((x) => x.id === 'critical-tasks')?.weight).toBe(8);
  });

  it('crítico sin requiresPermit → factor base (la brecha de permisos no aplica)', () => {
    const r = composeShiftRiskPanel(
      inputs({
        activePermitsCount: 0,
        plannedTasks: [
          { id: 't1', category: 'tareas-generales', isCriticalTask: true, requiresPermit: false },
        ],
      }),
    );
    // No requiere permiso → la cuenta de permisos activos no
    // debería alterar el factor.
    expect(r.factors.find((x) => x.id === 'critical-tasks')?.weight).toBe(4);
  });
});

describe('equipment overdue', () => {
  it('equipo con mantención vencida → factor + recomendación bloqueo', () => {
    const r = composeShiftRiskPanel(
      inputs({
        equipment: [
          { id: 'e1', code: 'CAEX-08', overdueMaintenance: true },
          { id: 'e2', code: 'GH-22', overdueMaintenance: true },
        ],
      }),
    );
    const f = r.factors.find((x) => x.id === 'equipment-overdue');
    expect(f?.recommendation).toMatch(/CAEX-08/);
  });
});

describe('recent incidents', () => {
  it('incidentes 7d → factor con peso sumado severity', () => {
    const r = composeShiftRiskPanel(
      inputs({
        recentIncidents: [
          { id: 'i1', severity: 'critical', occurredAt: '2026-05-10T00:00:00Z' },
          { id: 'i2', severity: 'low', occurredAt: '2026-05-11T00:00:00Z' },
        ],
      }),
    );
    expect(r.factors.find((x) => x.id === 'recent-incidents')?.weight).toBe(16);
  });
});

describe('brigade', () => {
  it('brigada no lista → factor brigade-not-ready', () => {
    const r = composeShiftRiskPanel(inputs({ emergencyBrigadeReady: false }));
    expect(r.factors.find((x) => x.id === 'brigade-not-ready')).toBeDefined();
  });
});

describe('score levels', () => {
  it('riesgo extremo → level=red + recommendDelayShiftStart', () => {
    const r = composeShiftRiskPanel(
      inputs({
        shift: 'night',
        weather: {
          rainProbability: 0.9,
          windSpeedMs: 18,
          uvIndex: 11,
          temperatureC: 34,
          visibilityKm: 0.5,
          lightningRiskWithinHours: 1,
        },
        workers: [
          { uid: 'w1', fullName: 'A', fatigueRisk: 'critical', daysSinceHire: 5 },
          { uid: 'w2', fullName: 'B', fatigueRisk: 'high', daysSinceHire: 2 },
        ],
        plannedTasks: [{ id: 't1', category: 'altura', isCriticalTask: true }],
        equipment: [{ id: 'e1', code: 'CAEX-01', overdueMaintenance: true }],
        recentIncidents: [
          { id: 'i1', severity: 'critical', occurredAt: '2026-05-10T00:00:00Z' },
        ],
        emergencyBrigadeReady: false,
      }),
    );
    expect(r.level).toBe('red');
    expect(r.recommendDelayShiftStart).toBe(true);
    expect(r.riskScore).toBeGreaterThanOrEqual(75);
  });

  it('topRecommendations devuelve max 3 ordenadas', () => {
    const r = composeShiftRiskPanel(
      inputs({
        weather: {
          rainProbability: 0.9,
          windSpeedMs: 18,
          uvIndex: 11,
          temperatureC: 34,
          visibilityKm: 5,
        },
      }),
    );
    expect(r.topRecommendations.length).toBeLessThanOrEqual(3);
    expect(r.topRecommendations.length).toBeGreaterThan(0);
  });
});
