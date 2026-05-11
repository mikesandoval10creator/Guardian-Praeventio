import { describe, it, expect } from 'vitest';
import {
  getIndustryPreset,
  listIndustryPresets,
  buildPresetApplication,
} from './industryRuleEngine.js';

describe('listIndustryPresets', () => {
  it('lista al menos 7 industrias', () => {
    const list = listIndustryPresets();
    expect(list.length).toBeGreaterThanOrEqual(7);
    const prefixes = list.map((p) => p.prefix);
    expect(prefixes).toContain('GP-MIN');
    expect(prefixes).toContain('GP-CONS');
    expect(prefixes).toContain('GP-AGR');
    expect(prefixes).toContain('GP-SAL');
    expect(prefixes).toContain('GP-ELEC');
  });
});

describe('getIndustryPreset', () => {
  it('GP-MIN tiene DS 132 + protocolo silice', () => {
    const p = getIndustryPreset('GP-MIN');
    expect(p.typicalRisks).toContain('silice');
    expect(p.applicableRegulations.some((r) => /DS 132/.test(r))).toBe(true);
    expect(p.minsalProtocols).toContain('PREXOR_silice');
    expect(p.baseEpp.length).toBeGreaterThan(0);
  });

  it('GP-CONS tiene altura + DS 76', () => {
    const p = getIndustryPreset('GP-CONS');
    expect(p.typicalRisks).toContain('altura');
    expect(p.applicableRegulations.some((r) => /DS 76/.test(r))).toBe(true);
  });

  it('GP-SAL tiene riesgo biológico + DS 6 REAS', () => {
    const p = getIndustryPreset('GP-SAL');
    expect(p.typicalRisks).toContain('biologico');
    expect(p.applicableRegulations.some((r) => /DS 6/.test(r))).toBe(true);
  });

  it('GP-ELEC tiene LOTO + Reglamento SEC', () => {
    const p = getIndustryPreset('GP-ELEC');
    expect(p.mandatoryTrainings).toContain('loto_bloqueo');
    expect(p.applicableRegulations.some((r) => /SEC/.test(r))).toBe(true);
  });

  it('industria desconocida → preset genérico con DS 594', () => {
    const p = getIndustryPreset('GP-INVENTADO');
    expect(p.label).toContain('Genérico');
    expect(p.applicableRegulations).toContain('DS 594');
  });

  it('cada preset tiene al menos 1 riesgo, 1 documento, 1 training', () => {
    for (const { prefix } of listIndustryPresets()) {
      const p = getIndustryPreset(prefix);
      expect(p.typicalRisks.length).toBeGreaterThan(0);
      expect(p.mandatoryDocuments.length).toBeGreaterThan(0);
      expect(p.mandatoryTrainings.length).toBeGreaterThan(0);
    }
  });
});

describe('buildPresetApplication', () => {
  it('genera acciones según industria', () => {
    const app = buildPresetApplication('proj-1', 'GP-MIN');
    expect(app.projectId).toBe('proj-1');
    expect(app.industryPrefix).toBe('GP-MIN');
    expect(app.risksToCreate.length).toBeGreaterThan(0);
    expect(app.documentsToGenerate.length).toBeGreaterThan(0);
    expect(app.regulationsToLink.length).toBeGreaterThan(0);
  });

  it('silice marcado como severity=high', () => {
    const app = buildPresetApplication('p', 'GP-MIN');
    const silice = app.risksToCreate.find((r) => r.riskType === 'silice');
    expect(silice?.severity).toBe('high');
  });

  it('protocolos MINSAL se incluyen', () => {
    const app = buildPresetApplication('p', 'GP-MIN');
    expect(app.protocolsToActivate).toContain('PREXOR_silice');
  });
});
