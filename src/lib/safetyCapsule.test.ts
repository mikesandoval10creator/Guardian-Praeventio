import { describe, expect, it } from 'vitest';
import { normalizeSafetyCapsule } from './safetyCapsule';

const valid = { title: 'Título', content: 'Contenido', keyTip: 'Consejo', duration: '1 minuto' };

describe('normalizeSafetyCapsule', () => {
  it('strips unknown provider fields and normalizes whitespace', () => {
    expect(normalizeSafetyCapsule({ ...valid, content: ' Contenido ', userId: 'forged', projectId: 'other' }))
      .toEqual({ ...valid, schemaVersion: 1 });
  });
  it.each([
    { value: null }, { value: undefined }, { value: [] }, { value: 42 }, { value: true },
    { value: '' }, { value: '   ' }, { value: {} },
    { value: { ...valid, content: [] } }, { value: { ...valid, title: ' ' } },
    { value: { ...valid, schemaVersion: 2 } },
    { value: { ...valid, duration: 60 } },
    { value: { ...valid, keyTip: null } },
    { value: { ...valid, content: 'x'.repeat(20001) } },
    { value: 'x'.repeat(20001) },
  ])('rejects malformed or oversized data %#', ({ value }) => {
    expect(() => normalizeSafetyCapsule(value)).toThrow();
  });
  it('accepts an explicit supported version', () => {
    expect(normalizeSafetyCapsule({ ...valid, schemaVersion: 1 })).toEqual({ ...valid, schemaVersion: 1 });
  });
});
