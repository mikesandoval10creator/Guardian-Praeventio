// Tests para §12.4.3 — audit log mutations normativa.

import { describe, it, expect } from 'vitest';
import {
  validateMutationEvent,
  createAuditEntry,
  verifyAuditChain,
  shallowDiff,
  RegulatoryAuditError,
  type RegulatoryMutationEvent,
  type RegulatoryAuditEntry,
} from './normativeAuditLog';

const baseEvent: RegulatoryMutationEvent = {
  kind: 'update_regulation',
  byUid: 'uid-test',
  byRole: 'admin',
  regulationId: 'CL/DS-44-2024',
  reason: 'Actualización editorial de definiciones (DS 44 art. 2)',
  before: { description: 'old text' },
  after: { description: 'new text' },
  at: '2026-05-21T03:00:00.000Z',
  tenantId: 't-test',
};

describe('validateMutationEvent', () => {
  it('acepta evento válido', () => {
    expect(() => validateMutationEvent(baseEvent)).not.toThrow();
  });

  it('rechaza byUid vacío', () => {
    expect(() =>
      validateMutationEvent({ ...baseEvent, byUid: '' }),
    ).toThrow(RegulatoryAuditError);
  });

  it('rechaza reason muy corto', () => {
    try {
      validateMutationEvent({ ...baseEvent, reason: 'short' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RegulatoryAuditError);
      expect((e as RegulatoryAuditError).code).toBe('reason_too_short');
    }
  });

  it('rechaza reason muy largo', () => {
    try {
      validateMutationEvent({ ...baseEvent, reason: 'a'.repeat(2001) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RegulatoryAuditError).code).toBe('reason_too_long');
    }
  });

  it('rechaza at inválido', () => {
    try {
      validateMutationEvent({ ...baseEvent, at: 'no-iso' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RegulatoryAuditError).code).toBe('invalid_at');
    }
  });

  it('rechaza tenantId vacío', () => {
    try {
      validateMutationEvent({ ...baseEvent, tenantId: '' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RegulatoryAuditError).code).toBe('invalid_tenant');
    }
  });
});

describe('createAuditEntry', () => {
  it('crea entry con hash + previousHash + schemaVersion', async () => {
    const entry = await createAuditEntry(baseEvent, null, 'entry-1');
    expect(entry.entryId).toBe('entry-1');
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.previousHash).toBeNull();
    expect(entry.schemaVersion).toBe(1);
    expect(entry.kind).toBe('update_regulation');
  });

  it('valida antes de crear (rechaza reason corto)', async () => {
    try {
      await createAuditEntry({ ...baseEvent, reason: 'no' }, null, 'e');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as RegulatoryAuditError).code).toBe('reason_too_short');
    }
  });

  it('mismo input → mismo hash (determinístico)', async () => {
    const a = await createAuditEntry(baseEvent, null, 'entry-1');
    const b = await createAuditEntry(baseEvent, null, 'entry-1');
    expect(a.hash).toBe(b.hash);
  });

  it('previousHash en chain entries', async () => {
    const e1 = await createAuditEntry(baseEvent, null, 'entry-1');
    const e2 = await createAuditEntry(baseEvent, e1.hash, 'entry-2');
    expect(e2.previousHash).toBe(e1.hash);
  });
});

describe('verifyAuditChain', () => {
  it('chain válido sin errores', async () => {
    const e1 = await createAuditEntry(baseEvent, null, 'entry-1');
    const e2 = await createAuditEntry(
      { ...baseEvent, kind: 'attach_evidence' },
      e1.hash,
      'entry-2',
    );
    const result = await verifyAuditChain([e1, e2]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detecta tamper: hash modificado', async () => {
    const e1 = await createAuditEntry(baseEvent, null, 'entry-1');
    const tampered: RegulatoryAuditEntry = {
      ...e1,
      reason: 'TAMPERED reason text', // cambia content pero hash sigue siendo original
    };
    const result = await verifyAuditChain([tampered]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.reason).toMatch(/hash mismatch/);
  });

  it('detecta previousHash roto', async () => {
    const e1 = await createAuditEntry(baseEvent, null, 'entry-1');
    const e2 = await createAuditEntry(baseEvent, 'INVALID_HASH', 'entry-2');
    const result = await verifyAuditChain([e1, e2]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.reason.includes('previousHash'))).toBe(true);
  });

  it('chain vacío → válido', async () => {
    const result = await verifyAuditChain([]);
    expect(result.valid).toBe(true);
  });
});

describe('shallowDiff', () => {
  it('detecta keys cambiadas', () => {
    const diff = shallowDiff(
      { a: 1, b: 2 },
      { a: 1, b: 3, c: 4 },
    );
    expect(diff).toEqual([
      { key: 'b', before: 2, after: 3 },
      { key: 'c', before: undefined, after: 4 },
    ]);
  });

  it('detecta keys eliminadas', () => {
    const diff = shallowDiff({ a: 1, b: 2 }, { a: 1 });
    expect(diff).toEqual([{ key: 'b', before: 2, after: undefined }]);
  });

  it('detecta valores complejos (JSON-aware)', () => {
    const diff = shallowDiff(
      { nested: { x: 1 } },
      { nested: { x: 2 } },
    );
    expect(diff).toHaveLength(1);
    expect(diff[0]?.key).toBe('nested');
  });

  it('sin cambios → array vacío', () => {
    expect(shallowDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('before null o undefined → diff vs all after keys', () => {
    expect(shallowDiff(null, { a: 1 })).toEqual([
      { key: 'a', before: undefined, after: 1 },
    ]);
    expect(shallowDiff(undefined, { a: 1 })).toEqual([
      { key: 'a', before: undefined, after: 1 },
    ]);
  });
});
