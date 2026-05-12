import { describe, it, expect } from 'vitest';
import {
  classifyField,
  detectGaps,
  reapExpiredRecords,
  type DataField,
} from './piiClassifier.js';

function field(over: Partial<DataField> & { fieldPath: string }): DataField {
  return {
    fieldPath: over.fieldPath,
    category: over.category ?? 'identity',
    encrypted: over.encrypted ?? false,
    authorizedRoles: over.authorizedRoles,
  };
}

describe('classifyField', () => {
  it('health → special_category con 10 años retención', () => {
    const r = classifyField(field({ fieldPath: 'medical.bloodType', category: 'health' }));
    expect(r.sensitivity).toBe('special_category');
    expect(r.retentionDays).toBe(3650);
    expect(r.requiresExplicitConsent).toBe(true);
    expect(r.mustEncryptAtRest).toBe(true);
  });

  it('identity → medium retención 2 años', () => {
    const r = classifyField(field({ fieldPath: 'fullName', category: 'identity' }));
    expect(r.sensitivity).toBe('medium');
    expect(r.retentionDays).toBe(730);
    expect(r.mustMaskInLogs).toBe(true);
  });

  it('observation → low, no requiere consentimiento explícito', () => {
    const r = classifyField(field({ fieldPath: 'attendance', category: 'observation' }));
    expect(r.requiresExplicitConsent).toBe(false);
    expect(r.mustMaskInLogs).toBe(false);
  });
});

describe('detectGaps', () => {
  it('detecta unencrypted_special_category', () => {
    const gaps = detectGaps([field({ fieldPath: 'med', category: 'health', encrypted: false, authorizedRoles: ['medical'] })]);
    expect(gaps.some((g) => g.gap === 'unencrypted_special_category')).toBe(true);
  });

  it('detecta missing_role_restriction_on_health', () => {
    const gaps = detectGaps([
      field({ fieldPath: 'med', category: 'health', encrypted: true }),
    ]);
    expect(gaps.some((g) => g.gap === 'missing_role_restriction_on_health')).toBe(true);
  });

  it('campo OK no genera gaps', () => {
    const gaps = detectGaps([
      field({
        fieldPath: 'name',
        category: 'identity',
        encrypted: false,
      }),
    ]);
    expect(gaps).toEqual([]);
  });
});

describe('reapExpiredRecords', () => {
  it('detecta records vencidos por categoría', () => {
    const r = reapExpiredRecords(
      [
        { id: 'old-obs', category: 'observation', createdAt: '2024-05-01T00:00:00Z' }, // > 365d
        { id: 'recent-obs', category: 'observation', createdAt: '2026-05-01T00:00:00Z' },
        { id: 'recent-id', category: 'identity', createdAt: '2025-05-01T00:00:00Z' }, // < 730d
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.toReap).toContain('old-obs');
    expect(r.toReap).not.toContain('recent-obs');
    expect(r.toReap).not.toContain('recent-id');
  });
});
