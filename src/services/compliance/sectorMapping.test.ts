import { describe, expect, it } from 'vitest';
import { resolveComplianceSector } from './sectorMapping.js';

describe('resolveComplianceSector', () => {
  it.each([
    [{ industry_code: 'mining' }, 'GP-MIN'],
    [{ industry_code: 'construction' }, 'GP-CONS'],
    [{ industry_code: 'energy', sectorId: 'invalid' }, 'GP-ELEC'],
    [{ industry_code: 'mining', sectorId: 'GP-ELEC' }, 'GP-ELEC'],
    [{ industry_code: 'retail' }, undefined],
    [{}, undefined],
  ])('resolves %j to %s', (project, sector) => {
    expect(resolveComplianceSector(project)).toBe(sector);
  });
});