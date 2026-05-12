import { describe, it, expect } from 'vitest';
import {
  createException,
  deriveStatus,
  revokeException,
  markFulfilled,
  filterActiveAt,
  summarize,
  ExceptionValidationError,
  type CreateExceptionInput,
} from './exceptionEngine.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function validInput(over: Partial<CreateExceptionInput> = {}): CreateExceptionInput {
  return {
    id: 'exc-1',
    domain: 'training_gap',
    subjectRef: { kind: 'WORKER', id: 'worker-juan' },
    reason: 'Trabajador con capacitación altura vencida ayer, debe completar tarea crítica hoy.',
    alternativeMitigation: 'Supervisor con altura vigente acompaña directamente; pausa cada 2h.',
    approvedByUid: 'sup-uid-1',
    approvedByRole: 'supervisor',
    durationHours: 24,
    now: NOW,
    ...over,
  };
}

describe('createException', () => {
  it('crea con status active + validUntil = now + durationHours', () => {
    const r = createException(validInput());
    expect(r.status).toBe('active');
    expect(r.approvedAt).toBe(NOW.toISOString());
    expect(new Date(r.validUntil).getTime() - NOW.getTime()).toBe(24 * 3_600_000);
  });

  it('rechaza reason < 20 chars', () => {
    expect(() => createException(validInput({ reason: 'corto' }))).toThrow(
      ExceptionValidationError,
    );
  });

  it('rechaza mitigation < 20 chars', () => {
    expect(() => createException(validInput({ alternativeMitigation: 'rapidito' }))).toThrow(
      /MITIGATION_TOO_SHORT/,
    );
  });

  it('rechaza durationHours > 168 (1 semana)', () => {
    expect(() => createException(validInput({ durationHours: 200 }))).toThrow(
      /DURATION_OUT_OF_RANGE/,
    );
  });

  it('rechaza durationHours = 0', () => {
    expect(() => createException(validInput({ durationHours: 0 }))).toThrow(
      /DURATION_OUT_OF_RANGE/,
    );
  });

  it('rechaza role no reconocido', () => {
    expect(() => createException(validInput({ approvedByRole: 'operador' }))).toThrow(
      /ROLE_NOT_ALLOWED/,
    );
  });

  it('acepta los 4 roles válidos', () => {
    for (const role of ['supervisor', 'prevencionista', 'gerente', 'admin']) {
      expect(() => createException(validInput({ approvedByRole: role }))).not.toThrow();
    }
  });
});

describe('deriveStatus', () => {
  it('active hasta validUntil', () => {
    const r = createException(validInput({ durationHours: 24 }));
    expect(deriveStatus(r, new Date(NOW.getTime() + 1_000))).toBe('active');
  });

  it('expired pasado validUntil', () => {
    const r = createException(validInput({ durationHours: 1 }));
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(deriveStatus(r, later)).toBe('expired');
  });

  it('revoked si tiene revokedAt', () => {
    const r = revokeException(createException(validInput()), 'sup-x', 'condición controlada', NOW);
    expect(deriveStatus(r, NOW)).toBe('revoked');
  });

  it('fulfilled si tiene fulfilledAt', () => {
    const r = markFulfilled(createException(validInput()), NOW);
    expect(deriveStatus(r, NOW)).toBe('fulfilled');
  });
});

describe('revokeException', () => {
  it('marca revoked + setea revokedAt/revokedByUid/reason', () => {
    const r = revokeException(
      createException(validInput()),
      'sup-x',
      'condición de seguridad restablecida',
      NOW,
    );
    expect(r.status).toBe('revoked');
    expect(r.revokedByUid).toBe('sup-x');
    expect(r.revokedReason).toBe('condición de seguridad restablecida');
  });

  it('no permite revocar dos veces', () => {
    const r = revokeException(createException(validInput()), 'sup-x', 'razón', NOW);
    expect(() => revokeException(r, 'sup-y', 'segundo intento', NOW)).toThrow(
      /NOT_ACTIVE/,
    );
  });
});

describe('markFulfilled', () => {
  it('marca fulfilled + setea fulfilledAt', () => {
    const r = markFulfilled(createException(validInput()), NOW);
    expect(r.status).toBe('fulfilled');
    expect(r.fulfilledAt).toBe(NOW.toISOString());
  });

  it('no permite mark fulfilled sobre revocada', () => {
    const r = revokeException(createException(validInput()), 'sup', 'razón válida x', NOW);
    expect(() => markFulfilled(r, NOW)).toThrow(/NOT_ACTIVE/);
  });
});

describe('filterActiveAt + summarize', () => {
  it('filterActiveAt excluye expiradas/revocadas/fulfilled', () => {
    const r1 = createException(validInput({ id: 'a', durationHours: 24 }));
    const r2 = revokeException(
      createException(validInput({ id: 'b' })),
      'sup',
      'control restablecido',
      NOW,
    );
    const r3 = createException(validInput({ id: 'c', durationHours: 1 }));
    const later = new Date(NOW.getTime() + 5 * 3_600_000);
    const actives = filterActiveAt([r1, r2, r3], later);
    expect(actives.map((r) => r.id)).toEqual(['a']);
  });

  it('summarize cuenta por status + por domain', () => {
    const r1 = createException(validInput({ id: 'a', domain: 'training_gap' }));
    const r2 = createException(validInput({ id: 'b', domain: 'epp_expired' }));
    const r3 = revokeException(
      createException(validInput({ id: 'c', domain: 'training_gap' })),
      'sup',
      'control reestablecido',
      NOW,
    );
    const summary = summarize([r1, r2, r3], NOW);
    expect(summary.totalActive).toBe(2);
    expect(summary.totalRevoked).toBe(1);
    expect(summary.byDomain.training_gap).toBe(2);
    expect(summary.byDomain.epp_expired).toBe(1);
  });
});
