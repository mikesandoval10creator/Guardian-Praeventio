import { describe, it, expect } from 'vitest';
import {
  declareChange,
  acknowledgeChange,
  revertChange,
  summarizeAcknowledgments,
  ChangeValidationError,
  type DeclareChangeInput,
} from './operationalChangeService.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function input(over: Partial<DeclareChangeInput> = {}): DeclareChangeInput {
  return {
    projectId: 'p1',
    kind: 'procedure',
    whatChanged: 'Procedimiento de izaje crítico',
    previousValue: 'PROC-IZ-001 v2',
    newValue: 'PROC-IZ-001 v3',
    rationale: 'Incorpora validación de radio de exclusión por radio operador',
    impact: 'high',
    affectedWorkerUids: ['w1', 'w2', 'w3'],
    declaredByUid: 'prev-1',
    declaredByRole: 'prevencionista',
    effectiveFrom: '2026-05-12T08:00:00Z',
    now: NOW,
    ...over,
  };
}

describe('declareChange', () => {
  it('crea change con acks vacíos', () => {
    const c = declareChange(input());
    expect(c.acknowledgments).toEqual([]);
    expect(c.affectedWorkerUids).toHaveLength(3);
    expect(c.declaredAt).toBe(NOW.toISOString());
  });

  it('rechaza role no autorizado', () => {
    expect(() => declareChange(input({ declaredByRole: 'operador' }))).toThrow(
      /ROLE_NOT_ALLOWED/,
    );
  });

  it('rechaza rationale corto', () => {
    expect(() => declareChange(input({ rationale: 'corto' }))).toThrow(
      /RATIONALE_TOO_SHORT/,
    );
  });

  it('rechaza previousValue === newValue', () => {
    expect(() =>
      declareChange(input({ previousValue: 'X', newValue: 'X' })),
    ).toThrow(/NO_DIFFERENCE/);
  });

  it('rechaza impact != low sin affectedWorkerUids', () => {
    expect(() =>
      declareChange(input({ affectedWorkerUids: [], impact: 'high' })),
    ).toThrow(/AFFECTED_REQUIRED/);
  });

  it('permite impact=low sin affected', () => {
    const c = declareChange(input({ affectedWorkerUids: [], impact: 'low' }));
    expect(c.affectedWorkerUids).toEqual([]);
  });

  it('deduplica affectedWorkerUids', () => {
    const c = declareChange(input({ affectedWorkerUids: ['w1', 'w1', 'w2'] }));
    expect(c.affectedWorkerUids).toEqual(['w1', 'w2']);
  });
});

describe('acknowledgeChange', () => {
  it('agrega ack al worker correcto', () => {
    const c = declareChange(input());
    const after = acknowledgeChange(c, 'w1', NOW.toISOString());
    expect(after.acknowledgments).toHaveLength(1);
    expect(after.acknowledgments[0].workerUid).toBe('w1');
  });

  it('idempotente: ack 2 veces mantiene 1', () => {
    const c = declareChange(input());
    const a1 = acknowledgeChange(c, 'w1', NOW.toISOString());
    const a2 = acknowledgeChange(a1, 'w1', '2026-05-13T00:00:00Z');
    expect(a2.acknowledgments).toHaveLength(1);
  });

  it('rechaza ack de worker no afectado', () => {
    const c = declareChange(input());
    expect(() => acknowledgeChange(c, 'w-extranio', NOW.toISOString())).toThrow(
      /NOT_IN_AUDIENCE/,
    );
  });

  it('rechaza ack sobre change reverted', () => {
    const c = revertChange(declareChange(input()), 'razón suficiente válida', NOW);
    expect(() => acknowledgeChange(c, 'w1', NOW.toISOString())).toThrow(
      /CHANGE_REVERTED/,
    );
  });
});

describe('revertChange', () => {
  it('marca revertedAt + revertedReason', () => {
    const c = revertChange(declareChange(input()), 'nueva versión introduce regresión', NOW);
    expect(c.revertedAt).toBe(NOW.toISOString());
    expect(c.revertedReason).toContain('regresión');
  });

  it('rechaza doble revert', () => {
    const c = revertChange(declareChange(input()), 'razón válida primera', NOW);
    expect(() => revertChange(c, 'razón válida segunda', NOW)).toThrow(
      /ALREADY_REVERTED/,
    );
  });

  it('rechaza reason corto', () => {
    expect(() => revertChange(declareChange(input()), 'corto', NOW)).toThrow(
      /REASON_TOO_SHORT/,
    );
  });
});

describe('summarizeAcknowledgments', () => {
  it('calcula coverage %', () => {
    let c = declareChange(input());
    c = acknowledgeChange(c, 'w1', NOW.toISOString());
    c = acknowledgeChange(c, 'w2', NOW.toISOString());
    const summary = summarizeAcknowledgments(c);
    expect(summary.totalAffected).toBe(3);
    expect(summary.acknowledged).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.coveragePercent).toBe(67);
    expect(summary.pendingWorkerUids).toEqual(['w3']);
  });

  it('coverage 100% cuando no hay afectados', () => {
    const c = declareChange(input({ affectedWorkerUids: [], impact: 'low' }));
    const summary = summarizeAcknowledgments(c);
    expect(summary.coveragePercent).toBe(100);
  });
});
