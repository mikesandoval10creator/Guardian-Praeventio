// Praeventio Guard — Tests del registro de adapters compliance (Bloque 7).
//
// Cubre que getJurisdictionMeta + isAdapterFullyImplemented + filtros
// respondan correctamente para los 7 países del registro inicial.

import { describe, it, expect } from 'vitest';
import {
  getJurisdictionMeta,
  isAdapterFullyImplemented,
  getFullyImplementedCountries,
  getScaffoldedCountries,
  ADAPTER_STATUS,
  JURISDICTION_META_BY_COUNTRY,
  AdapterNotImplementedError,
  type SupportedCountry,
} from './index';

describe('getJurisdictionMeta', () => {
  it('CL retorna meta SUSESO + DS 44', () => {
    const meta = getJurisdictionMeta('CL');
    expect(meta.country).toBe('CL');
    expect(meta.regulator).toContain('SUSESO');
    expect(meta.language).toBe('es-CL');
    expect(meta.currency).toBe('CLP');
    expect(meta.reportingFramework).toContain('DS44-2024');
  });

  it('UK retorna meta HSE + RIDDOR', () => {
    const meta = getJurisdictionMeta('UK');
    expect(meta.country).toBe('UK');
    expect(meta.regulator).toBe('HSE');
    expect(meta.reportingFramework).toBe('RIDDOR-2013');
    expect(meta.language).toBe('en-GB');
  });

  it('JP retorna meta MHLW + ISHA', () => {
    const meta = getJurisdictionMeta('JP');
    expect(meta.country).toBe('JP');
    expect(meta.regulator).toContain('MHLW');
    expect(meta.language).toBe('ja-JP');
    expect(meta.currency).toBe('JPY');
  });

  it('KR retorna meta KOSHA + SAPA 2022', () => {
    const meta = getJurisdictionMeta('KR');
    expect(meta.country).toBe('KR');
    expect(meta.regulator).toContain('KOSHA');
    expect(meta.reportingFramework).toContain('SAPA-2022');
    expect(meta.language).toBe('ko-KR');
  });

  it('IN retorna meta DGFASLI + Factories Act / OSHWC', () => {
    const meta = getJurisdictionMeta('IN');
    expect(meta.country).toBe('IN');
    expect(meta.regulator).toContain('DGFASLI');
    expect(meta.reportingFramework).toContain('FactoriesAct');
    expect(meta.language).toBe('en-IN');
  });

  it('todos los 7 países exponen reportingDeadlines.fatalInjury', () => {
    const countries: SupportedCountry[] = ['CL', 'UK', 'CA', 'AU', 'JP', 'KR', 'IN'];
    for (const c of countries) {
      const meta = getJurisdictionMeta(c);
      expect(meta.reportingDeadlines).toHaveProperty('fatalInjury');
    }
  });
});

describe('isAdapterFullyImplemented', () => {
  it('CL es full', () => {
    expect(isAdapterFullyImplemented('CL')).toBe(true);
  });

  it('UK/CA/AU/JP/KR/IN son scaffolds (Bloque 7 frontend pendiente)', () => {
    for (const c of ['UK', 'CA', 'AU', 'JP', 'KR', 'IN'] as const) {
      expect(isAdapterFullyImplemented(c)).toBe(false);
    }
  });
});

describe('getFullyImplementedCountries', () => {
  it('actualmente solo CL', () => {
    expect(getFullyImplementedCountries()).toEqual(['CL']);
  });
});

describe('getScaffoldedCountries', () => {
  it('los 6 nuevos (UK/CA/AU/JP/KR/IN)', () => {
    expect(getScaffoldedCountries()).toEqual(['UK', 'CA', 'AU', 'JP', 'KR', 'IN']);
  });
});

describe('JURISDICTION_META_BY_COUNTRY type-safety', () => {
  it('todos los 7 países están en el mapa', () => {
    expect(Object.keys(JURISDICTION_META_BY_COUNTRY).sort()).toEqual(
      ['AU', 'CA', 'CL', 'IN', 'JP', 'KR', 'UK'],
    );
  });

  it('todos tienen references object', () => {
    for (const country of Object.keys(JURISDICTION_META_BY_COUNTRY) as SupportedCountry[]) {
      const meta = getJurisdictionMeta(country);
      expect(meta).toHaveProperty('references');
      expect(typeof meta.references).toBe('object');
    }
  });
});

describe('AdapterNotImplementedError re-export', () => {
  it('está exportado desde el registry', () => {
    expect(AdapterNotImplementedError).toBeDefined();
    const err = new AdapterNotImplementedError('UK', 'test reason');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('UK');
    expect(err.message).toContain('test reason');
    expect(err.code).toBe('adapter_not_implemented_yet');
    expect(err.country).toBe('UK');
  });
});

describe('ADAPTER_STATUS coverage', () => {
  it('todos los 7 países tienen status definido', () => {
    expect(Object.keys(ADAPTER_STATUS).sort()).toEqual(
      ['AU', 'CA', 'CL', 'IN', 'JP', 'KR', 'UK'],
    );
  });
});
