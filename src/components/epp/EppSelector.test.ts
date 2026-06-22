// @vitest-environment jsdom
// Unit tests for EppSelector pure logic — rubro→EPP mapping and selector helpers.
// No React rendering needed for the logic layer.

import { describe, it, expect } from 'vitest';
import {
  EPP_SELECTOR_RUBROS,
  getEppForRubro,
  type EppSelectorRubro,
  type EppCardItem,
} from './eppSelectorData';

describe('EPP_SELECTOR_RUBROS', () => {
  it('contains all founder-required industries', () => {
    const ids = EPP_SELECTOR_RUBROS.map((r) => r.id);
    expect(ids).toContain('GP-MIN');
    expect(ids).toContain('GP-CONS');
    expect(ids).toContain('GP-AGR-SIL');
    expect(ids).toContain('GP-AGR-PES');
    expect(ids).toContain('GP-AGR');
    expect(ids).toContain('GP-TRANS-MAR');
    expect(ids).toContain('GP-ELEC-EOL');
    expect(ids).toContain('GP-ALOJA-COM');
    expect(ids).toContain('GP-SAL');
  });

  it('every rubro has a label, id, and at least 3 EPP items', () => {
    EPP_SELECTOR_RUBROS.forEach((rubro: EppSelectorRubro) => {
      expect(rubro.id, `${rubro.id} missing id`).toBeTruthy();
      expect(rubro.label, `${rubro.id} missing label`).toBeTruthy();
      expect(rubro.items.length, `${rubro.id} needs ≥3 EPP items`).toBeGreaterThanOrEqual(3);
    });
  });

  it('every EPP item has emoji and label', () => {
    EPP_SELECTOR_RUBROS.forEach((rubro: EppSelectorRubro) => {
      rubro.items.forEach((item: EppCardItem) => {
        expect(item.emoji, `${rubro.id} item missing emoji`).toBeTruthy();
        expect(item.label, `${rubro.id} item missing label`).toBeTruthy();
      });
    });
  });
});

describe('getEppForRubro', () => {
  it('returns Construcción EPP for GP-CONS', () => {
    const items = getEppForRubro('GP-CONS');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Casco de seguridad');
    expect(labels).toContain('Zapatos de seguridad');
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('returns Gastronomía EPP for GP-ALOJA-COM', () => {
    const items = getEppForRubro('GP-ALOJA-COM');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Gorro de cocinero');
    expect(labels).toContain('Calzado antideslizante');
  });

  it('returns Salud EPP for GP-SAL with N95 and gloves', () => {
    const items = getEppForRubro('GP-SAL');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Mascarilla N95');
    expect(labels).toContain('Guantes desechables');
  });

  it('returns Minería EPP for GP-MIN', () => {
    const items = getEppForRubro('GP-MIN');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Casco minero');
  });

  it('returns default EPP for unknown rubro', () => {
    const items = getEppForRubro('GP-UNKNOWN');
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('is referentially stable — same call returns same items', () => {
    const a = getEppForRubro('GP-MIN');
    const b = getEppForRubro('GP-MIN');
    expect(a).toBe(b); // same array reference (pure data)
  });
});
