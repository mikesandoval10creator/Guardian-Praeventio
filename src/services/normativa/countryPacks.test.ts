/**
 * Country-pack registry tests.
 *
 * Verifies every supported country pack is registered, has at least 5 real
 * regulation entries, exposes correct thresholds (CL Comité @ 25), and that
 * the ISO pack is the documented default fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_PACKS,
  getDefaultPack,
  getPackByCode,
  type CountryCode,
} from './countryPacks';

const ALL_CODES: CountryCode[] = ['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO'];

describe('COUNTRY_PACKS registry', () => {
  it('registers every supported country code', () => {
    for (const code of ALL_CODES) {
      expect(COUNTRY_PACKS[code]).toBeDefined();
      expect(COUNTRY_PACKS[code].code).toBe(code);
    }
  });

  it('every pack ships at least 5 regulation entries', () => {
    for (const code of ALL_CODES) {
      expect(COUNTRY_PACKS[code].regulations.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('getPackByCode', () => {
  it('CL Comité Paritario threshold is 25 workers (DS 54 art. 1)', () => {
    expect(getPackByCode('CL').thresholds.comiteRequiredAtWorkers).toBe(25);
  });

  it('throws on invalid code', () => {
    expect(() => getPackByCode('ZZ' as CountryCode)).toThrow();
  });
});

describe('getDefaultPack', () => {
  it('returns the ISO 45001 pack as last-resort fallback', () => {
    expect(getDefaultPack().code).toBe('ISO');
  });
});
