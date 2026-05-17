// Praeventio Guard — Sprint K §23-24 unit tests for visitorRegistry.
//
// Pure tests, no Firestore, no Express. Exercises:
//   • registerVisitor: payload validation + event shape
//   • acknowledgeInduction: id/version checks + event timestamp
//   • checkOutVisitor: event shape
//   • applyEvent: register/ack/checkout reducer + NOT_FOUND guards
//   • isActive: filter helper

import { describe, it, expect } from 'vitest';
import {
  registerVisitor,
  acknowledgeInduction,
  checkOutVisitor,
  applyEvent,
  isActive,
  VisitorRegistryError,
  type RegisterVisitorPayload,
  type Visitor,
} from './visitorRegistry.js';

function payload(over: Partial<RegisterVisitorPayload> = {}): RegisterVisitorPayload {
  return {
    id: 'v_001',
    fullName: 'Carolina Visitante',
    rut: '12.345.678-9',
    company: 'Auditora SpA',
    hostUid: 'host_alpha',
    reason: 'Auditoría externa ISO 45001',
    projectId: 'proj-01',
    tenantId: 'tenant-01',
    ...over,
  };
}

describe('registerVisitor', () => {
  it('returns a visitor_registered event with canonical fields', () => {
    const event = registerVisitor(payload(), '2026-05-17T08:00:00.000Z');
    expect(event.type).toBe('visitor_registered');
    expect(event.visitor.id).toBe('v_001');
    expect(event.visitor.fullName).toBe('Carolina Visitante');
    expect(event.visitor.rut).toBe('12.345.678-9');
    expect(event.visitor.checkInAt).toBe('2026-05-17T08:00:00.000Z');
    expect(event.visitor.checkOutAt).toBeUndefined();
    expect(event.visitor.inductedAt).toBeUndefined();
    expect(event.visitor.inductionVersionId).toBe('');
  });

  it('trims whitespace from name/company/reason and upper-cases RUT', () => {
    const event = registerVisitor(
      payload({
        fullName: '  Ana Pérez  ',
        company: '  Mandante SA ',
        reason: '  Entrega de insumos  ',
        rut: '12345678-k',
      }),
      '2026-05-17T09:00:00.000Z',
    );
    expect(event.visitor.fullName).toBe('Ana Pérez');
    expect(event.visitor.company).toBe('Mandante SA');
    expect(event.visitor.reason).toBe('Entrega de insumos');
    expect(event.visitor.rut).toBe('12345678-K');
  });

  it('rejects missing required fields with INVALID_FIELD', () => {
    expect(() => registerVisitor(payload({ fullName: '' }))).toThrow(VisitorRegistryError);
    expect(() => registerVisitor(payload({ hostUid: '' }))).toThrow(VisitorRegistryError);
    expect(() => registerVisitor(payload({ projectId: '' }))).toThrow(VisitorRegistryError);
    expect(() => registerVisitor(payload({ tenantId: '' }))).toThrow(VisitorRegistryError);
  });

  it('rejects short fullName (<3 chars)', () => {
    expect(() => registerVisitor(payload({ fullName: 'X' }))).toThrow(
      /at least 3 characters/,
    );
  });

  it('rejects malformed RUT shapes', () => {
    expect(() => registerVisitor(payload({ rut: 'not-a-rut' }))).toThrow(
      VisitorRegistryError,
    );
    expect(() => registerVisitor(payload({ rut: '123' }))).toThrow(/INVALID_RUT/);
  });

  it('uses caller-provided checkInAt when present', () => {
    const event = registerVisitor(
      payload({ checkInAt: '2026-05-17T14:00:00.000Z' }),
      '2999-01-01T00:00:00.000Z',
    );
    expect(event.visitor.checkInAt).toBe('2026-05-17T14:00:00.000Z');
  });
});

describe('acknowledgeInduction', () => {
  it('emits a visitor_induction_acknowledged event with pinned version', () => {
    const event = acknowledgeInduction(
      'v_001',
      'ind-v2026-05',
      '2026-05-17T08:10:00.000Z',
    );
    expect(event.type).toBe('visitor_induction_acknowledged');
    expect(event.visitorId).toBe('v_001');
    expect(event.inductionVersionId).toBe('ind-v2026-05');
    expect(event.inductedAt).toBe('2026-05-17T08:10:00.000Z');
  });

  it('rejects empty visitorId or inductionVersionId', () => {
    expect(() => acknowledgeInduction('', 'ind-v1')).toThrow(VisitorRegistryError);
    expect(() => acknowledgeInduction('v_001', '')).toThrow(VisitorRegistryError);
  });
});

describe('checkOutVisitor', () => {
  it('emits a visitor_checked_out event', () => {
    const event = checkOutVisitor('v_001', '2026-05-17T17:00:00.000Z');
    expect(event.type).toBe('visitor_checked_out');
    expect(event.visitorId).toBe('v_001');
    expect(event.checkOutAt).toBe('2026-05-17T17:00:00.000Z');
  });

  it('rejects empty visitorId', () => {
    expect(() => checkOutVisitor('')).toThrow(VisitorRegistryError);
  });
});

describe('applyEvent', () => {
  it('applies visitor_registered from null base', () => {
    const ev = registerVisitor(payload(), '2026-05-17T08:00:00.000Z');
    const result = applyEvent(null, ev);
    expect(result.id).toBe('v_001');
    expect(result.checkInAt).toBe('2026-05-17T08:00:00.000Z');
  });

  it('applies visitor_induction_acknowledged onto an existing visitor', () => {
    const registered = registerVisitor(payload(), '2026-05-17T08:00:00.000Z');
    const ack = acknowledgeInduction('v_001', 'ind-2026', '2026-05-17T08:15:00.000Z');
    const next = applyEvent(registered.visitor, ack);
    expect(next.inductedAt).toBe('2026-05-17T08:15:00.000Z');
    expect(next.inductionVersionId).toBe('ind-2026');
    // Other fields preserved
    expect(next.fullName).toBe('Carolina Visitante');
  });

  it('applies visitor_checked_out onto an existing visitor', () => {
    const registered = registerVisitor(payload(), '2026-05-17T08:00:00.000Z');
    const out = checkOutVisitor('v_001', '2026-05-17T17:30:00.000Z');
    const next = applyEvent(registered.visitor, out);
    expect(next.checkOutAt).toBe('2026-05-17T17:30:00.000Z');
  });

  it('throws NOT_FOUND when applying ack to a null visitor', () => {
    const ack = acknowledgeInduction('v_missing', 'ind-2026');
    expect(() => applyEvent(null, ack)).toThrow(/NOT_FOUND/);
  });

  it('throws NOT_FOUND when applying checkout to a null visitor', () => {
    const out = checkOutVisitor('v_missing');
    expect(() => applyEvent(null, out)).toThrow(/NOT_FOUND/);
  });
});

describe('isActive', () => {
  function base(): Visitor {
    return registerVisitor(payload(), '2026-05-17T08:00:00.000Z').visitor;
  }
  it('true while checkOutAt is undefined', () => {
    expect(isActive(base())).toBe(true);
  });
  it('false after checkOutAt is set', () => {
    const v = applyEvent(base(), checkOutVisitor('v_001', '2026-05-17T17:00:00.000Z'));
    expect(isActive(v)).toBe(false);
  });
});
