import { describe, it, expect } from 'vitest';
import { EPP_BY_SECTOR, EPP_DEFAULT } from '../../constants';
import { CL_PACK } from '../../data/normativa/cl';
import type { CountryPack } from '../normativa/countryPacks';
import {
  getRiskProfileForSector,
  obligacionesPorDotacion,
} from './industryRiskProfile';

const CL_REGULATION_IDS = new Set(CL_PACK.regulations.map((r) => r.id));

describe('getRiskProfileForSector', () => {
  it('every sector includes the universal base: Ley 16.744 + DS 44/2024', () => {
    for (const sectorId of ['GP-MIN-MET', 'GP-CONS-RES', 'GP-AGR-CULT', 'GP-COM-MEN', 'GP-INF-TI']) {
      const ids = getRiskProfileForSector(sectorId).regulations.map((r) => r.id);
      expect(ids, sectorId).toContain('cl-ley-16744');
      expect(ids, sectorId).toContain('cl-ds-44');
    }
  });

  it('minería includes DS 132 (Reglamento de Seguridad Minera)', () => {
    const ids = getRiskProfileForSector('GP-MIN-MET').regulations.map((r) => r.id);
    expect(ids).toContain('cl-ds-132');
  });

  it('construcción includes DS 76 and a nota about registro/bitácora de faena', () => {
    const profile = getRiskProfileForSector('GP-CONS-RES');
    expect(profile.regulations.map((r) => r.id)).toContain('cl-ds-76');
    expect(profile.notasPreventivas.join(' ')).toMatch(/bitácora|registro/i);
  });

  it('agro includes DS 594 and a nota about plaguicidas (texto, no id fabricado)', () => {
    const profile = getRiskProfileForSector('GP-AGR-CULT');
    expect(profile.regulations.map((r) => r.id)).toContain('cl-ds-594');
    expect(profile.notasPreventivas.join(' ')).toMatch(/plaguicida/i);
  });

  it('gestión de residuos includes DS 148 (residuos peligrosos)', () => {
    const ids = getRiskProfileForSector('GP-ENERG-RES').regulations.map((r) => r.id);
    expect(ids).toContain('cl-ds-148');
  });

  it('only returns regulation objects that really exist in the CL pack', () => {
    for (const sectorId of ['GP-MIN-MET', 'GP-CONS-DEM', 'GP-AGR-PES', 'GP-ENERG-RES', 'GP-TRANS-TER']) {
      for (const reg of getRiskProfileForSector(sectorId).regulations) {
        expect(CL_REGULATION_IDS.has(reg.id), `${sectorId} → ${reg.id}`).toBe(true);
        expect(reg.title.length).toBeGreaterThan(0);
        expect(reg.reference.length).toBeGreaterThan(0);
      }
    }
  });

  it('does not duplicate regulations', () => {
    for (const sectorId of ['GP-MIN-MET', 'GP-CONS-RES', 'GP-AGR-CULT']) {
      const ids = getRiskProfileForSector(sectorId).regulations.map((r) => r.id);
      expect(new Set(ids).size, sectorId).toBe(ids.length);
    }
  });

  it('accepts the full subsector label used by the onboarding wizard', () => {
    const profile = getRiskProfileForSector('GP-CONS-RES: Construcción de edificios residenciales');
    expect(profile.sectorId).toBe('GP-CONS-RES');
    expect(profile.regulations.map((r) => r.id)).toContain('cl-ds-76');
  });

  it('returns 5-8 seed riesgos típicos in es-CL for every major target sector', () => {
    for (const sectorId of [
      'GP-AGR-CULT',
      'GP-MIN-MET',
      'GP-MANU-ALI',
      'GP-ELEC-GEN',
      'GP-ENERG-RES',
      'GP-CONS-RES',
      'GP-COM-MEN',
      'GP-TRANS-TER',
    ]) {
      const { riesgosTipicos } = getRiskProfileForSector(sectorId);
      expect(riesgosTipicos.length, sectorId).toBeGreaterThanOrEqual(5);
      expect(riesgosTipicos.length, sectorId).toBeLessThanOrEqual(8);
      for (const riesgo of riesgosTipicos) {
        expect(riesgo.trim().length).toBeGreaterThan(5);
      }
    }
  });

  it('minería seeds include the classic high-fatality risks', () => {
    const text = getRiskProfileForSector('GP-MIN-MET').riesgosTipicos.join(' ');
    expect(text).toMatch(/roca/i);
    expect(text).toMatch(/sílice/i);
    expect(text).toMatch(/tronadura/i);
  });

  it('construcción seeds include caída a distinto nivel y derrumbe de excavaciones', () => {
    const text = getRiskProfileForSector('GP-CONS-RES').riesgosTipicos.join(' ');
    expect(text).toMatch(/caída.*distinto nivel/i);
    expect(text).toMatch(/excavaci/i);
  });

  it('reuses EPP_BY_SECTOR with longest-prefix matching and EPP_DEFAULT fallback', () => {
    expect(getRiskProfileForSector('GP-MIN-MET').epp).toEqual(EPP_BY_SECTOR['GP-MIN']);
    // 'GP-ADM-SEG' is more specific than the (absent) 'GP-ADM' entry.
    expect(getRiskProfileForSector('GP-ADM-SEG').epp).toEqual(EPP_BY_SECTOR['GP-ADM-SEG']);
    // No EPP entry for education → default kit.
    expect(getRiskProfileForSector('GP-EDU-PRE').epp).toEqual(EPP_DEFAULT);
  });

  it('unknown sector ids degrade to the generic base profile (pure & total)', () => {
    const profile = getRiskProfileForSector('GP-XXX-NOPE');
    expect(profile.regulations.map((r) => r.id)).toContain('cl-ley-16744');
    expect(profile.epp).toEqual(EPP_DEFAULT);
    expect(profile.riesgosTipicos.length).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic and side-effect free (mutating a result does not leak)', () => {
    const a = getRiskProfileForSector('GP-MIN-MET');
    a.regulations.pop();
    a.riesgosTipicos.pop();
    const b = getRiskProfileForSector('GP-MIN-MET');
    expect(b.regulations.map((r) => r.id)).toContain('cl-ds-132');
    expect(b.riesgosTipicos.length).toBeGreaterThanOrEqual(5);
  });
});

describe('obligacionesPorDotacion (umbrales leídos del pack, no hardcodeados)', () => {
  it('10 trabajadores → delegado de SST, sin CPHS ni depto', () => {
    const o = obligacionesPorDotacion(10, CL_PACK);
    expect(o.delegadoSstRequired).toBe(true);
    expect(o.cphsRequired).toBe(false);
    expect(o.preventionDeptRequired).toBe(false);
  });

  it('24 trabajadores (borde inferior) → todavía delegado', () => {
    const o = obligacionesPorDotacion(24, CL_PACK);
    expect(o.delegadoSstRequired).toBe(true);
    expect(o.cphsRequired).toBe(false);
  });

  it('25 trabajadores (borde) → CPHS, sin delegado ni depto', () => {
    const o = obligacionesPorDotacion(25, CL_PACK);
    expect(o.cphsRequired).toBe(true);
    expect(o.delegadoSstRequired).toBe(false);
    expect(o.preventionDeptRequired).toBe(false);
  });

  it('99 trabajadores → CPHS, sin depto', () => {
    const o = obligacionesPorDotacion(99, CL_PACK);
    expect(o.cphsRequired).toBe(true);
    expect(o.preventionDeptRequired).toBe(false);
  });

  it('100 trabajadores (borde) → CPHS + Departamento de Prevención', () => {
    const o = obligacionesPorDotacion(100, CL_PACK);
    expect(o.cphsRequired).toBe(true);
    expect(o.preventionDeptRequired).toBe(true);
  });

  it('0 trabajadores → ninguna obligación de órgano preventivo', () => {
    const o = obligacionesPorDotacion(0, CL_PACK);
    expect(o.cphsRequired).toBe(false);
    expect(o.delegadoSstRequired).toBe(false);
    expect(o.preventionDeptRequired).toBe(false);
    expect(o.obligaciones).toEqual([]);
  });

  it('reads thresholds from the pack argument (no hardcoded 25/100)', () => {
    const syntheticPack: CountryPack = {
      ...CL_PACK,
      thresholds: {
        comiteRequiredAtWorkers: 30,
        preventionDeptRequiredAtWorkers: 80,
        monthlyMeetingsRequired: false,
      },
    };
    expect(obligacionesPorDotacion(29, syntheticPack).cphsRequired).toBe(false);
    expect(obligacionesPorDotacion(29, syntheticPack).delegadoSstRequired).toBe(true);
    expect(obligacionesPorDotacion(30, syntheticPack).cphsRequired).toBe(true);
    expect(obligacionesPorDotacion(79, syntheticPack).preventionDeptRequired).toBe(false);
    expect(obligacionesPorDotacion(80, syntheticPack).preventionDeptRequired).toBe(true);
  });

  it('emits es-CL obligation copy for each required organ', () => {
    const o = obligacionesPorDotacion(120, CL_PACK);
    const text = o.obligaciones.join(' ');
    expect(text).toMatch(/Comité Paritario/);
    expect(text).toMatch(/Departamento de Prevención/);
    // CL pack mandates monthly meetings → the copy must mention them.
    expect(text).toMatch(/mensual/i);
  });
});
