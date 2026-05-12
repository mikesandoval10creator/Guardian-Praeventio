import { describe, it, expect } from 'vitest';
import {
  detectWeakLanguage,
  classifyActionLevel,
  buildBalanceReport,
  detectDuplicateActions,
  checkRecidivism,
  type CorrectiveAction,
} from './weakActionDetector.js';

function action(over: Partial<CorrectiveAction> & { id: string }): CorrectiveAction {
  return {
    id: over.id,
    description: over.description ?? 'placeholder de descripción larga suficiente.',
    status: over.status ?? 'open',
    isSystemic: over.isSystemic ?? false,
    level: over.level,
    sourceCause: over.sourceCause,
  };
}

describe('detectWeakLanguage', () => {
  it('detecta "capacitar" y sugiere especificar', () => {
    const r = detectWeakLanguage(action({ id: 'a', description: 'Capacitar al personal involucrado' }));
    expect(r).not.toBeNull();
    expect(r!.weakPhrases).toContain('Capacitar');
    expect(r!.suggestion).toMatch(/Especifica|EPP|individual/i);
  });

  it('detecta "tener más cuidado"', () => {
    const r = detectWeakLanguage(action({ id: 'a', description: 'Tener más cuidado al operar' }));
    expect(r).not.toBeNull();
  });

  it('descripción corta también es débil', () => {
    const r = detectWeakLanguage(action({ id: 'a', description: 'Corregir.' }));
    expect(r).not.toBeNull();
    expect(r!.weakPhrases).toContain('descripcion_corta');
  });

  it('acción concreta no detectada', () => {
    const r = detectWeakLanguage(
      action({
        id: 'a',
        description: 'Instalar baranda físicamente en el perímetro del segundo nivel del andamio.',
      }),
    );
    expect(r).toBeNull();
  });
});

describe('classifyActionLevel', () => {
  it('"instalar baranda" → engineering', () => {
    expect(classifyActionLevel('Instalar baranda en perímetro')).toBe('engineering');
  });

  it('"capacitar al equipo" → training', () => {
    expect(classifyActionLevel('Capacitar al equipo de mantenimiento')).toBe('training');
  });

  it('"eliminar uso de químico" → elimination', () => {
    expect(classifyActionLevel('Eliminar uso de químico ABC del proceso')).toBe('elimination');
  });

  it('"entregar arnés" → epp', () => {
    expect(classifyActionLevel('Entregar arnés certificado a cuadrilla altura')).toBe('epp');
  });

  it('texto sin keywords → null', () => {
    expect(classifyActionLevel('Algo genérico sin verbo claro')).toBeNull();
  });
});

describe('buildBalanceReport', () => {
  it('detecta desequilibrio cuando training > 70%', () => {
    const actions: CorrectiveAction[] = [
      action({ id: 'a1', description: 'Capacitar a w1' }),
      action({ id: 'a2', description: 'Capacitar a w2' }),
      action({ id: 'a3', description: 'Capacitar a w3' }),
      action({ id: 'a4', description: 'Capacitar a w4' }),
      action({ id: 'a5', description: 'Instalar baranda' }),
    ];
    const r = buildBalanceReport(actions);
    expect(r.byLevel.training).toBe(4);
    expect(r.byLevel.engineering).toBe(1);
    expect(r.isImbalanced).toBe(true);
    expect(r.message).toMatch(/Desequilibrio/);
  });

  it('alerta si 0 acciones de ingeniería/eliminación', () => {
    const actions: CorrectiveAction[] = [
      action({ id: 'a1', description: 'Comunicar la situación al equipo' }),
      action({ id: 'a2', description: 'Capacitar a w1' }),
    ];
    const r = buildBalanceReport(actions);
    expect(r.highTierShare).toBe(0);
    expect(r.message).toMatch(/ingeniería|eliminación/);
  });

  it('balanceado si hay diversidad', () => {
    const actions: CorrectiveAction[] = [
      action({ id: 'a1', description: 'Instalar barrera física' }),
      action({ id: 'a2', description: 'Eliminar producto químico viejo' }),
      action({ id: 'a3', description: 'Capacitar a w1' }),
    ];
    const r = buildBalanceReport(actions);
    expect(r.isImbalanced).toBe(false);
  });
});

describe('detectDuplicateActions', () => {
  it('agrupa por fingerprint (primeras 8 palabras)', () => {
    const actions: CorrectiveAction[] = [
      action({ id: 'a1', description: 'Capacitar al personal en uso de EPP correcto' }),
      action({ id: 'a2', description: 'Capacitar al personal en uso de EPP correcto durante turno' }),
      action({ id: 'a3', description: 'Capacitar al personal en uso de EPP correcto y validar' }),
      action({ id: 'a4', description: 'Instalar baranda en andamio del nivel 3 sector norte' }),
    ];
    const clusters = detectDuplicateActions(actions, 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].actionIds).toHaveLength(3);
    expect(clusters[0].suggestion).toMatch(/sistémica/);
  });

  it('no detecta clusters bajo el minSize', () => {
    const actions: CorrectiveAction[] = [
      action({ id: 'a1', description: 'Instalar baranda' }),
      action({ id: 'a2', description: 'Instalar baranda en otro sector' }),
    ];
    expect(detectDuplicateActions(actions, 3)).toHaveLength(0);
  });
});

describe('checkRecidivism', () => {
  it('reincidencia <30d → severity high', () => {
    const r = checkRecidivism({
      closedAction: { id: 'a1', sourceCause: 'altura sin arnés', closedAt: '2026-05-01T00:00:00Z' },
      laterIncidentsSameCause: [{ id: 'i1', occurredAt: '2026-05-15T00:00:00Z' }],
    });
    expect(r.hasRecurrence).toBe(true);
    expect(r.recurredInDays).toBe(14);
    expect(r.severity).toBe('high');
  });

  it('reincidencia 60d → medium', () => {
    const r = checkRecidivism({
      closedAction: { id: 'a1', sourceCause: 'x', closedAt: '2026-03-01T00:00:00Z' },
      laterIncidentsSameCause: [{ id: 'i1', occurredAt: '2026-05-01T00:00:00Z' }],
    });
    expect(r.severity).toBe('medium');
  });

  it('sin reincidencia → severity none', () => {
    const r = checkRecidivism({
      closedAction: { id: 'a1', sourceCause: 'x', closedAt: '2026-05-01T00:00:00Z' },
      laterIncidentsSameCause: [],
    });
    expect(r.hasRecurrence).toBe(false);
    expect(r.severity).toBe('none');
  });

  it('ignora incidentes ANTES del cierre', () => {
    const r = checkRecidivism({
      closedAction: { id: 'a1', sourceCause: 'x', closedAt: '2026-05-01T00:00:00Z' },
      laterIncidentsSameCause: [{ id: 'i1', occurredAt: '2026-04-15T00:00:00Z' }],
    });
    expect(r.hasRecurrence).toBe(false);
  });
});
