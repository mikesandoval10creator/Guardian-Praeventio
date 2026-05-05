// Sprint 31 Bucket SS — Tests cultural conventions framework.

import { describe, it, expect } from 'vitest';
import {
  getDateFormat,
  getNameOrder,
  getHonorific,
  formatPersonName,
  getPictogramStandard,
} from './culturalConventions.js';

describe('getDateFormat (Sprint 31 SS)', () => {
  it('returns DD/MM/YYYY for ES/FR/IT/ES-MX', () => {
    expect(getDateFormat('es')).toBe('DD/MM/YYYY');
    expect(getDateFormat('fr')).toBe('DD/MM/YYYY');
    expect(getDateFormat('it')).toBe('DD/MM/YYYY');
    expect(getDateFormat('es-MX')).toBe('DD/MM/YYYY');
  });

  it('returns MM/DD/YYYY for en (US default)', () => {
    expect(getDateFormat('en')).toBe('MM/DD/YYYY');
    expect(getDateFormat('en-US')).toBe('MM/DD/YYYY');
  });

  it('returns DD.MM.YYYY for de and ru', () => {
    expect(getDateFormat('de')).toBe('DD.MM.YYYY');
    expect(getDateFormat('ru')).toBe('DD.MM.YYYY');
  });

  it('returns YYYY年MM月DD日 for ja, zh-CN and zh-TW', () => {
    expect(getDateFormat('ja')).toBe('YYYY年MM月DD日');
    expect(getDateFormat('zh-CN')).toBe('YYYY年MM月DD日');
    expect(getDateFormat('zh-TW')).toBe('YYYY年MM月DD日');
  });

  it('falls back to ISO 8601 for unknown locales', () => {
    expect(getDateFormat('xx-YY')).toBe('YYYY-MM-DD');
  });
});

describe('getNameOrder (Sprint 31 SS)', () => {
  it('returns family-first for zh-CN / zh-TW / ja / ko', () => {
    expect(getNameOrder('zh-CN')).toBe('family-first');
    expect(getNameOrder('zh-TW')).toBe('family-first');
    expect(getNameOrder('ja')).toBe('family-first');
    expect(getNameOrder('ko')).toBe('family-first');
  });

  it('returns family-first for hu (Hungarian)', () => {
    expect(getNameOrder('hu')).toBe('family-first');
  });

  it('returns given-first for occidental locales', () => {
    expect(getNameOrder('es')).toBe('given-first');
    expect(getNameOrder('en')).toBe('given-first');
    expect(getNameOrder('fr')).toBe('given-first');
    expect(getNameOrder('ru')).toBe('given-first');
  });
});

describe('getHonorific (Sprint 31 SS)', () => {
  it('returns 先生/女士 for zh-CN by gender', () => {
    expect(getHonorific('zh-CN', 'male')).toBe('先生');
    expect(getHonorific('zh-CN', 'female')).toBe('女士');
  });

  it('returns さん for ja regardless of gender', () => {
    expect(getHonorific('ja', 'male')).toBe('さん');
    expect(getHonorific('ja', 'female')).toBe('さん');
    expect(getHonorific('ja')).toBe('さん');
  });

  it('returns господин/госпожа for ru', () => {
    expect(getHonorific('ru', 'male')).toBe('господин');
    expect(getHonorific('ru', 'female')).toBe('госпожа');
  });

  it('returns null for occidental locales', () => {
    expect(getHonorific('en')).toBeNull();
    expect(getHonorific('es')).toBeNull();
    expect(getHonorific('fr')).toBeNull();
  });
});

describe('formatPersonName (Sprint 31 SS)', () => {
  it('zh-CN family-first: "Wang Wei"', () => {
    expect(formatPersonName({ given: 'Wei', family: 'Wang' }, 'zh-CN')).toBe('Wang Wei');
  });

  it('en given-first: "Daho Sandoval"', () => {
    expect(formatPersonName({ given: 'Daho', family: 'Sandoval' }, 'en')).toBe('Daho Sandoval');
  });

  it('appends honorific in zh-CN with male gender', () => {
    expect(
      formatPersonName(
        { given: 'Wei', family: 'Wang' },
        'zh-CN',
        { gender: 'male', withHonorific: true },
      ),
    ).toBe('Wang Wei 先生');
  });

  it('does NOT append honorific in en even when requested (no convention)', () => {
    expect(
      formatPersonName(
        { given: 'Daho', family: 'Sandoval' },
        'en',
        { withHonorific: true },
      ),
    ).toBe('Daho Sandoval');
  });
});

describe('getPictogramStandard (Sprint 31 SS)', () => {
  it('returns ANSI Z535 for US-OSHA', () => {
    expect(getPictogramStandard('US-OSHA')).toBe('ANSI-Z535');
  });

  it('returns GB 2893 for China', () => {
    expect(getPictogramStandard('CN')).toBe('GB-2893');
  });

  it('returns ISO 7010 for everywhere else (CL, EU, JP, RU, TW, AU)', () => {
    expect(getPictogramStandard('CL')).toBe('ISO-7010');
    expect(getPictogramStandard('EU')).toBe('ISO-7010');
    expect(getPictogramStandard('JP')).toBe('ISO-7010');
    expect(getPictogramStandard('RU')).toBe('ISO-7010');
    expect(getPictogramStandard('TW')).toBe('ISO-7010');
    expect(getPictogramStandard('AU')).toBe('ISO-7010');
  });
});
