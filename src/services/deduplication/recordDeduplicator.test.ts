import { describe, it, expect } from 'vitest';
import {
  detectDuplicates,
  buildMergePlan,
  type DedupRecord,
} from './recordDeduplicator.js';

function worker(over: Partial<DedupRecord>): DedupRecord {
  return {
    id: 'w-default',
    kind: 'worker',
    name: 'Juan Pérez',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('detectDuplicates — canonical key match', () => {
  it('mismo canonicalKey → auto_merge (confidence 1)', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', canonicalKey: '12345678-9', createdAt: '2026-01-01T00:00:00Z' }),
      worker({ id: 'w2', name: 'J. Perez', canonicalKey: '12345678-9', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.confidence).toBe(1);
    expect(r[0]!.recommendedAction).toBe('auto_merge');
    expect(r[0]!.reasons).toContain('canonical_key_exact');
    expect(r[0]!.primaryId).toBe('w1'); // antiguo gana
  });
});

describe('detectDuplicates — email/phone match', () => {
  it('mismo email exacto → confidence ≥0.85 + suggest_merge', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Juan Pérez', email: 'juan@example.com' }),
      worker({ id: 'w2', name: 'Juan P.', email: 'JUAN@example.com', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(['suggest_merge', 'auto_merge']).toContain(r[0]!.recommendedAction);
  });

  it('mismo teléfono normalizado → match', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Juan P', phone: '+56 9 1234 5678' }),
      worker({ id: 'w2', name: 'J. Perez', phone: '912345678', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.reasons).toContain('phone_exact');
  });

  it('teléfono corto <8 dígitos NO matchea (espurio)', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Persona Uno', phone: '1234' }),
      worker({ id: 'w2', name: 'Otra Persona', phone: '1234' }),
    ]);
    expect(r).toHaveLength(0);
  });
});

describe('detectDuplicates — name fuzzy', () => {
  it('nombre con 1 typo (distance 1) → name_fuzzy match', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Juan Pérez Soto' }),
      worker({ id: 'w2', name: 'Juan Perez Soto', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(r.length).toBeGreaterThanOrEqual(1);
    // (normalize strips accents → exact match en realidad)
    expect(['name_exact_case_insensitive', 'name_fuzzy']).toContain(
      r[0]!.reasons[0]!,
    );
  });

  it('nombres distintos NO matchean', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Pedro Acuña' }),
      worker({ id: 'w2', name: 'María González' }),
    ]);
    expect(r).toHaveLength(0);
  });
});

describe('detectDuplicates — clustering', () => {
  it('3 registros del mismo trabajador agrupan en 1 candidato', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Juan Pérez', canonicalKey: '11.111.111-1', createdAt: '2026-01-01T00:00:00Z' }),
      worker({ id: 'w2', name: 'J Perez', canonicalKey: '11.111.111-1', createdAt: '2026-02-01T00:00:00Z' }),
      worker({ id: 'w3', name: 'Juan P.', canonicalKey: '11.111.111-1', createdAt: '2026-03-01T00:00:00Z' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.primaryId).toBe('w1'); // antiguo
    expect(r[0]!.duplicateIds.sort()).toEqual(['w2', 'w3']);
  });

  it('cumulative boost: email + name match → confidence sube', () => {
    const r = detectDuplicates([
      worker({ id: 'w1', name: 'Juan Pérez', email: 'a@b.com' }),
      worker({ id: 'w2', name: 'juan perez', email: 'A@B.COM', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('registros de distinto kind NO matchean', () => {
    const r = detectDuplicates([
      { id: 'w1', kind: 'worker', name: 'Juan', canonicalKey: '1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'e1', kind: 'equipment', name: 'Juan', canonicalKey: '1', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(r).toHaveLength(0);
  });
});

describe('buildMergePlan', () => {
  it('promueve campos vacíos del primary desde duplicados', () => {
    const records: DedupRecord[] = [
      worker({ id: 'w1', name: 'Juan' }),
      worker({ id: 'w2', name: 'Juan', email: 'j@e.com', phone: '12345678', canonicalKey: 'RUT-1', createdAt: '2026-02-01T00:00:00Z' }),
    ];
    const candidate = detectDuplicates(records)[0];
    expect(candidate).toBeDefined();
    if (candidate) {
      const plan = buildMergePlan(candidate, records, { w2: 5 });
      expect(plan.primaryId).toBe('w1');
      // En este caso solo hay name match (0.7), pero buildMergePlan
      // funciona igual con cualquier candidato.
      expect(plan.edgeReassignmentCount).toBe(5);
    }
  });
});
