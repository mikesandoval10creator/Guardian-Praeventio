import { describe, it, expect } from 'vitest';
import { rubroIdForIndustry, EPP_SELECTOR_RUBROS } from './eppSelectorData';

describe('rubroIdForIndustry — EPP auto-contexto por rubro', () => {
  it('mapea minería/mining → GP-MIN', () => {
    expect(rubroIdForIndustry('mining')).toBe('GP-MIN');
    expect(rubroIdForIndustry('Minería')).toBe('GP-MIN');
    expect(rubroIdForIndustry('minera')).toBe('GP-MIN');
  });
  it('mapea construcción → GP-CONS', () => {
    expect(rubroIdForIndustry('construccion')).toBe('GP-CONS');
    expect(rubroIdForIndustry('Construction')).toBe('GP-CONS');
  });
  it('acepta el id de rubro directo (GP-*)', () => {
    expect(rubroIdForIndustry('GP-AGR')).toBe('GP-AGR');
  });
  it('cae al primer rubro ante vacío o desconocido', () => {
    expect(rubroIdForIndustry(undefined)).toBe(EPP_SELECTOR_RUBROS[0].id);
    expect(rubroIdForIndustry('')).toBe(EPP_SELECTOR_RUBROS[0].id);
    expect(rubroIdForIndustry('zzz-desconocido')).toBe(EPP_SELECTOR_RUBROS[0].id);
  });
});
