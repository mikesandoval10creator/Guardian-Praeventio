import { describe, it, expect } from 'vitest';
import {
  buildInductionQrPayload,
  getInductionChecklist,
  completeInduction,
  canEnterZone,
  validateCheckIn,
  summarizeVisitors,
  VisitorValidationError,
  type VisitorAccess,
} from './visitorAccessService.js';

function visitor(over: Partial<VisitorAccess> = {}): VisitorAccess {
  return {
    id: over.id ?? 'v1',
    fullName: 'María Visitante',
    identityDocument: '12345678-9',
    organization: 'Mandante SA',
    kind: over.kind ?? 'mandante',
    hostUid: over.hostUid ?? 'host1',
    checkedInAt: over.checkedInAt ?? '2026-05-11T08:00:00Z',
    checkedOutAt: over.checkedOutAt,
    authorizedZones: over.authorizedZones ?? ['zone-common'],
    inductionCompletedAt: over.inductionCompletedAt,
    inductionItemsAcked: over.inductionItemsAcked ?? [],
    eppHandedOver: over.eppHandedOver ?? false,
  };
}

describe('buildInductionQrPayload', () => {
  it('crea payload con TTL y checklist standard', () => {
    const p = buildInductionQrPayload('v1', 30, '2026-05-11T08:00:00Z');
    expect(p.sessionId).toContain('v1');
    expect(p.checklist.length).toBeGreaterThanOrEqual(5);
    expect(new Date(p.expiresAt).getUTCMinutes()).toBe(30);
  });
});

describe('completeInduction', () => {
  it('throws si faltan items', () => {
    const v = visitor();
    expect(() => completeInduction(v, ['i1', 'i2'])).toThrow(VisitorValidationError);
  });

  it('completa correctamente con todos los items', () => {
    const allIds = getInductionChecklist().map((i) => i.id);
    const updated = completeInduction(visitor(), allIds);
    expect(updated.inductionCompletedAt).toBeDefined();
    expect(updated.inductionItemsAcked).toEqual(allIds);
  });
});

describe('canEnterZone', () => {
  it('false si no completó inducción', () => {
    expect(canEnterZone(visitor({ eppHandedOver: true }), 'zone-common')).toBe(false);
  });

  it('false si no recibió EPP', () => {
    expect(
      canEnterZone(
        visitor({ inductionCompletedAt: '2026-05-11T08:30:00Z' }),
        'zone-common',
      ),
    ).toBe(false);
  });

  it('false si ya hizo checkout', () => {
    expect(
      canEnterZone(
        visitor({
          inductionCompletedAt: '2026-05-11T08:30:00Z',
          eppHandedOver: true,
          checkedOutAt: '2026-05-11T16:00:00Z',
        }),
        'zone-common',
      ),
    ).toBe(false);
  });

  it('false si zona no autorizada', () => {
    expect(
      canEnterZone(
        visitor({
          inductionCompletedAt: '2026-05-11T08:30:00Z',
          eppHandedOver: true,
        }),
        'restricted-zone',
      ),
    ).toBe(false);
  });

  it('true si todas las condiciones', () => {
    expect(
      canEnterZone(
        visitor({
          inductionCompletedAt: '2026-05-11T08:30:00Z',
          eppHandedOver: true,
          authorizedZones: ['zone-common', 'zone-office'],
        }),
        'zone-office',
      ),
    ).toBe(true);
  });
});

describe('validateCheckIn', () => {
  it('detecta múltiples campos faltantes', () => {
    const r = validateCheckIn({});
    expect(r.passed).toBe(false);
    expect(r.blockingIssues.length).toBeGreaterThan(2);
  });

  it('checkin completo pasa', () => {
    const r = validateCheckIn({
      fullName: 'Carlos',
      identityDocument: '11111111-1',
      hostUid: 'h1',
      organization: 'Empresa X',
    });
    expect(r.passed).toBe(true);
  });
});

describe('summarizeVisitors', () => {
  it('detecta overdue exits >12h', () => {
    const r = summarizeVisitors(
      [
        visitor({
          id: 'v1',
          checkedInAt: '2026-05-10T20:00:00Z',
          inductionCompletedAt: '2026-05-10T20:30:00Z',
        }),
        visitor({
          id: 'v2',
          checkedInAt: '2026-05-11T07:30:00Z',
          inductionCompletedAt: '2026-05-11T08:00:00Z',
        }),
      ],
      '2026-05-11T10:00:00Z',
    );
    expect(r.overdueExits).toHaveLength(1);
    expect(r.overdueExits[0].id).toBe('v1');
  });

  it('cuenta withoutInduction', () => {
    const r = summarizeVisitors(
      [
        visitor({ id: 'v1' }), // sin inducción
        visitor({ id: 'v2', inductionCompletedAt: '2026-05-11T08:30:00Z' }),
      ],
      '2026-05-11T10:00:00Z',
    );
    expect(r.withoutInduction).toBe(1);
  });
});
