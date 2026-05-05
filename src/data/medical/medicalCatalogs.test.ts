/**
 * Sprint 21 — Bucket R · Tests de integridad para catálogos médicos.
 * Verifica carga, tamaño mínimo, schema y validez de códigos CIE-10/ATC.
 */
import { describe, it, expect } from 'vitest';
import {
  diagnoses,
  drugs,
  anatomy,
  diagnosesMeta,
  drugsMeta,
  anatomyMeta,
} from './index';

describe('medical catalogs — diagnoses (ICD-10 subset)', () => {
  it('loads and contains > 50 entries', () => {
    expect(Array.isArray(diagnoses)).toBe(true);
    expect(diagnoses.length).toBeGreaterThan(50);
  });

  it('every entry has code + name + category', () => {
    for (const d of diagnoses) {
      expect(typeof d.code).toBe('string');
      expect(d.code.length).toBeGreaterThan(0);
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.category).toBe('string');
    }
  });

  it('all ICD-10 codes match the official format', () => {
    // Letter + 2 digits; optional .digit(s) (e.g. J62.8, J64, T70.2)
    const icd10 = /^[A-Z]\d{2}(\.\d+)?$/;
    for (const d of diagnoses) {
      expect(icd10.test(d.code), `invalid ICD-10: ${d.code}`).toBe(true);
    }
  });

  it('exposes license + source metadata', () => {
    expect(diagnosesMeta.license).toMatch(/CC0|CC BY/);
    expect(diagnosesMeta.source).toBeTruthy();
  });
});

describe('medical catalogs — drugs (ATC + occupational relevance)', () => {
  it('loads and contains > 50 entries', () => {
    expect(Array.isArray(drugs)).toBe(true);
    expect(drugs.length).toBeGreaterThan(50);
  });

  it('every entry has name + atc + category + occupationalRelevance', () => {
    for (const d of drugs) {
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.atc).toBe('string');
      expect(typeof d.category).toBe('string');
      expect(typeof d.occupationalRelevance).toBe('string');
    }
  });

  it('exposes license + source metadata', () => {
    expect(drugsMeta.license).toMatch(/CC0|CC BY/);
    expect(drugsMeta.source).toBeTruthy();
  });
});

describe('medical catalogs — anatomy (occupational mapping)', () => {
  it('loads and contains > 30 entries', () => {
    expect(Array.isArray(anatomy)).toBe(true);
    expect(anatomy.length).toBeGreaterThan(30);
  });

  it('every entry has id + name + system + occupationalRisks + commonInjuries', () => {
    for (const a of anatomy) {
      expect(typeof a.id).toBe('string');
      expect(a.id.length).toBeGreaterThan(0);
      expect(typeof a.name).toBe('string');
      expect(typeof a.system).toBe('string');
      expect(Array.isArray(a.occupationalRisks)).toBe(true);
      expect(Array.isArray(a.commonInjuries)).toBe(true);
    }
  });

  it('ids are unique (used as React keys)', () => {
    const ids = anatomy.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes license + source metadata', () => {
    expect(anatomyMeta.license).toMatch(/CC0|CC BY/);
    expect(anatomyMeta.source).toBeTruthy();
  });
});
