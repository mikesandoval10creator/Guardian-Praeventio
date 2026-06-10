import { describe, it, expect } from 'vitest';
import { INDUSTRY_SECTORS } from '../../constants';
import {
  SII_ACTIVIDADES_ECONOMICAS,
  type SiiActividadEconomica,
} from './actividadesEconomicas';

/** Every valid GP-* subsector id derivable from INDUSTRY_SECTORS ('GP-CONS-RES', …). */
const VALID_SECTOR_IDS = new Set(
  INDUSTRY_SECTORS.flatMap((s) => s.subsectors).map((sub) => sub.split(':')[0].trim()),
);

describe('SII_ACTIVIDADES_ECONOMICAS catalogue', () => {
  it('contains a curated subset of at least 60 verified codes', () => {
    expect(SII_ACTIVIDADES_ECONOMICAS.length).toBeGreaterThanOrEqual(60);
  });

  it('every codigo is a positive integer that fits 6 digits (leading zeros implied)', () => {
    for (const entry of SII_ACTIVIDADES_ECONOMICAS) {
      expect(Number.isInteger(entry.codigo), `codigo ${entry.codigo}`).toBe(true);
      expect(entry.codigo).toBeGreaterThan(0);
      expect(entry.codigo).toBeLessThanOrEqual(999999);
      // Padded to 6 digits it must be exactly 6 chars (the SII canonical form).
      expect(String(entry.codigo).padStart(6, '0')).toHaveLength(6);
    }
  });

  it('has no duplicated codigos', () => {
    const codes = SII_ACTIVIDADES_ECONOMICAS.map((e) => e.codigo);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every descripcion is non-empty trimmed text', () => {
    for (const entry of SII_ACTIVIDADES_ECONOMICAS) {
      expect(entry.descripcion.trim().length, `codigo ${entry.codigo}`).toBeGreaterThan(3);
      expect(entry.descripcion).toBe(entry.descripcion.trim());
    }
  });

  it('every sectorId exists in INDUSTRY_SECTORS', () => {
    for (const entry of SII_ACTIVIDADES_ECONOMICAS) {
      expect(
        VALID_SECTOR_IDS.has(entry.sectorId),
        `codigo ${entry.codigo} → sectorId desconocido "${entry.sectorId}"`,
      ).toBe(true);
    }
  });

  it('covers every target product rubro with at least one code', () => {
    const prefixes = new Set(
      SII_ACTIVIDADES_ECONOMICAS.map((e) => e.sectorId.split('-').slice(0, 2).join('-')),
    );
    for (const major of [
      'GP-AGR',
      'GP-MIN',
      'GP-MANU',
      'GP-ELEC',
      'GP-ENERG',
      'GP-CONS',
      'GP-COM',
      'GP-TRANS',
    ]) {
      expect(prefixes.has(major), `falta cobertura del rubro ${major}`).toBe(true);
    }
  });

  describe('spot-checks against official SII data (verified 2026-06-10)', () => {
    const byCode = new Map<number, SiiActividadEconomica>(
      SII_ACTIVIDADES_ECONOMICAS.map((e) => [e.codigo, e]),
    );

    it('410010 = construcción de edificios para uso residencial → GP-CONS-RES', () => {
      const entry = byCode.get(410010);
      expect(entry?.descripcion).toMatch(/CONSTRUCCIÓN DE EDIFICIOS PARA USO RESIDENCIAL/i);
      expect(entry?.sectorId).toBe('GP-CONS-RES');
    });

    it('040000 = extracción y procesamiento de cobre → GP-MIN-MET', () => {
      const entry = byCode.get(40000);
      expect(entry?.descripcion).toMatch(/EXTRACCIÓN Y PROCESAMIENTO DE COBRE/i);
      expect(entry?.sectorId).toBe('GP-MIN-MET');
    });

    it('089110 = extracción y procesamiento de litio → GP-MIN-NOMET', () => {
      const entry = byCode.get(89110);
      expect(entry?.descripcion).toMatch(/LITIO/i);
      expect(entry?.sectorId).toBe('GP-MIN-NOMET');
    });

    it('492300 = transporte de carga por carretera → GP-TRANS-TER', () => {
      const entry = byCode.get(492300);
      expect(entry?.descripcion).toMatch(/TRANSPORTE DE CARGA POR CARRETERA/i);
      expect(entry?.sectorId).toBe('GP-TRANS-TER');
    });

    it('351011 = generación hidroeléctrica → GP-ELEC-GEN', () => {
      const entry = byCode.get(351011);
      expect(entry?.descripcion).toMatch(/CENTRALES HIDROELÉCTRICAS/i);
      expect(entry?.sectorId).toBe('GP-ELEC-GEN');
    });

    it('022000 = extracción de madera → GP-AGR-SIL', () => {
      const entry = byCode.get(22000);
      expect(entry?.descripcion).toMatch(/EXTRACCIÓN DE MADERA/i);
      expect(entry?.sectorId).toBe('GP-AGR-SIL');
    });

    it('102020 = elaboración y conservación de salmónidos → GP-MANU-ALI', () => {
      const entry = byCode.get(102020);
      expect(entry?.descripcion).toMatch(/SALMÓNIDOS/i);
      expect(entry?.sectorId).toBe('GP-MANU-ALI');
    });
  });
});
