import { describe, it, expect } from 'vitest';
import {
  createCorrectiveAction,
  assessProgressPDCA,
  scheduleEffectivenessReview,
  closeAction,
  linkToSemaforo,
  linkToExpiration,
  phaseOf,
  toLegacy,
  type CorrectiveActionRecord,
  type CorrectiveActionInput,
} from './correctiveActionsCenter.js';

const baseInput: CorrectiveActionInput = {
  source: 'inspection',
  sourceNodeId: 'insp-2026-001',
  responsibleUid: 'uid-daho',
  dueDate: '2026-06-01T00:00:00.000Z',
  description: 'Instalar barrera física en el área de prensa.',
  level: 'engineering',
};

describe('createCorrectiveAction', () => {
  it('crea registro con ID determinístico', () => {
    const a = createCorrectiveAction(baseInput);
    const b = createCorrectiveAction(baseInput);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^ca_inspection_insp-2026-001_/);
  });

  it('asigna defaults sensatos', () => {
    const a = createCorrectiveAction(baseInput);
    expect(a.status).toBe('open');
    expect(a.evidenceRequired).toBe(true);
    expect(a.effectivenessReviewAt).toBeNull();
    expect(a.closedAt).toBeNull();
    expect(a.isSystemic).toBe(false);
  });

  it('rechaza source inválido', () => {
    expect(() =>
      createCorrectiveAction({ ...baseInput, source: 'bogus' as any }),
    ).toThrow(RangeError);
  });

  it('rechaza dueDate inválido', () => {
    expect(() =>
      createCorrectiveAction({ ...baseInput, dueDate: 'mañana' }),
    ).toThrow(RangeError);
  });

  it('rechaza responsibleUid vacío', () => {
    expect(() =>
      createCorrectiveAction({ ...baseInput, responsibleUid: '' }),
    ).toThrow(TypeError);
  });

  it('acepta las 5 fuentes del plan', () => {
    const sources: Array<CorrectiveActionInput['source']> = [
      'inspection',
      'audit',
      'document_expiry',
      'incident',
      'training_gap',
    ];
    for (const s of sources) {
      const a = createCorrectiveAction({ ...baseInput, source: s });
      expect(a.source).toBe(s);
    }
  });
});

describe('phaseOf + assessProgressPDCA', () => {
  it('mapea status a fase PDCA correctamente', () => {
    expect(phaseOf('open')).toBe('plan');
    expect(phaseOf('in_progress')).toBe('do');
    expect(phaseOf('closed')).toBe('check');
    expect(phaseOf('verified')).toBe('act');
    expect(phaseOf('reopened')).toBe('plan');
  });

  it('agrega progreso PDCA', () => {
    const actions: CorrectiveActionRecord[] = [
      { ...createCorrectiveAction(baseInput), status: 'open' },
      { ...createCorrectiveAction({ ...baseInput, sourceNodeId: 'n2' }), status: 'in_progress' },
      { ...createCorrectiveAction({ ...baseInput, sourceNodeId: 'n3' }), status: 'closed' },
      { ...createCorrectiveAction({ ...baseInput, sourceNodeId: 'n4' }), status: 'verified' },
      { ...createCorrectiveAction({ ...baseInput, sourceNodeId: 'n5' }), status: 'verified' },
    ];
    const r = assessProgressPDCA(actions);
    expect(r.total).toBe(5);
    expect(r.byPhase.plan).toBe(1);
    expect(r.byPhase.do).toBe(1);
    expect(r.byPhase.check).toBe(1);
    expect(r.byPhase.act).toBe(2);
    expect(r.closureRate).toBeCloseTo(0.4);
  });

  it('detecta reabiertas y emite mensaje crítico', () => {
    const a = createCorrectiveAction(baseInput);
    const r = assessProgressPDCA([{ ...a, status: 'reopened' }]);
    expect(r.hasReopened).toBe(true);
    expect(r.message).toMatch(/reabierta/i);
  });

  it('mensaje vacío cuando no hay acciones', () => {
    const r = assessProgressPDCA([]);
    expect(r.total).toBe(0);
    expect(r.closureRate).toBe(0);
  });
});

describe('scheduleEffectivenessReview (F.11)', () => {
  it('retorna null si la acción no está cerrada', () => {
    const a = createCorrectiveAction(baseInput);
    expect(scheduleEffectivenessReview(a)).toBeNull();
  });

  it('agenda 30 días después de closedAt por defecto', () => {
    const a = createCorrectiveAction(baseInput);
    const closed = closeAction(a, '2026-06-01T00:00:00.000Z');
    const r = scheduleEffectivenessReview(closed);
    expect(r).not.toBeNull();
    expect(r!.reviewAt).toBe('2026-07-01T00:00:00.000Z');
    expect(r!.responsibleUid).toBe('uid-daho');
    expect(r!.prompt).toMatch(/problema volvió/i);
  });

  it('respeta daysAfterClose customizado', () => {
    const a = createCorrectiveAction(baseInput);
    const closed = closeAction(a, '2026-06-01T00:00:00.000Z', 60);
    const r = scheduleEffectivenessReview(closed, 60);
    expect(r!.reviewAt).toBe('2026-07-31T00:00:00.000Z');
  });
});

describe('closeAction', () => {
  it('marca status=closed y popula effectivenessReviewAt', () => {
    const a = createCorrectiveAction(baseInput);
    const closed = closeAction(a, '2026-06-01T00:00:00.000Z');
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(closed.effectivenessReviewAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rechaza closedAt inválido', () => {
    const a = createCorrectiveAction(baseInput);
    expect(() => closeAction(a, 'ayer')).toThrow(RangeError);
  });
});

describe('linkToSemaforo (F.2 wire)', () => {
  const today = new Date('2026-05-12T00:00:00.000Z');

  it('rojo si reopened', () => {
    const a = { ...createCorrectiveAction(baseInput), status: 'reopened' as const };
    expect(linkToSemaforo(a, today).color).toBe('red');
  });

  it('rojo si vencida y abierta', () => {
    const a = createCorrectiveAction({ ...baseInput, dueDate: '2026-05-01T00:00:00.000Z' });
    const r = linkToSemaforo(a, today);
    expect(r.color).toBe('red');
    expect(r.weight).toBe(3);
  });

  it('ámbar si vence en ≤7 días', () => {
    const a = createCorrectiveAction({ ...baseInput, dueDate: '2026-05-15T00:00:00.000Z' });
    const r = linkToSemaforo(a, today);
    expect(r.color).toBe('amber');
  });

  it('verde si cerrada', () => {
    const a = { ...createCorrectiveAction(baseInput), status: 'closed' as const };
    expect(linkToSemaforo(a, today).color).toBe('green');
    expect(linkToSemaforo(a, today).weight).toBe(0);
  });

  it('verde con peso 1 si en plazo lejano', () => {
    const a = createCorrectiveAction({ ...baseInput, dueDate: '2027-01-01T00:00:00.000Z' });
    const r = linkToSemaforo(a, today);
    expect(r.color).toBe('green');
    expect(r.weight).toBe(1);
  });
});

describe('linkToExpiration (B.9 wire)', () => {
  it('true para source=document_expiry', () => {
    const a = createCorrectiveAction({ ...baseInput, source: 'document_expiry' });
    expect(linkToExpiration(a)).toBe(true);
  });

  it('false para otras fuentes', () => {
    const a = createCorrectiveAction({ ...baseInput, source: 'incident' });
    expect(linkToExpiration(a)).toBe(false);
  });
});

describe('toLegacy bridge', () => {
  it('mapea record extendido a CorrectiveAction legacy', () => {
    const a = createCorrectiveAction(baseInput);
    const legacy = toLegacy(a);
    expect(legacy.id).toBe(a.id);
    expect(legacy.description).toBe(a.description);
    expect(legacy.status).toBe('open');
    expect(legacy.sourceCause).toBe('insp-2026-001');
  });

  it('verified pasa a verified, in_progress cae a open', () => {
    const a = createCorrectiveAction(baseInput);
    expect(toLegacy({ ...a, status: 'verified' }).status).toBe('verified');
    expect(toLegacy({ ...a, status: 'in_progress' }).status).toBe('open');
  });
});
