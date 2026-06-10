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

// AUDIT-2026-06 B22 — normas chilenas citadas extensamente en el código
// (DS 132 aparece 124 veces) pero ausentes del pack. URLs verificadas
// contra BCN (idNorma) el 2026-06-10 — jamás fabricar datos legales.
describe('CL pack — normas B22 (verificadas contra BCN)', () => {
  const cl = COUNTRY_PACKS.CL;
  const byId = new Map(cl.regulations.map((r) => [r.id, r]));

  it.each([
    ['cl-ds-132', 'Seguridad Minera', 'idNorma=221064'],
    ['cl-ds-76', '66 bis', 'idNorma=257601'],
    ['cl-ds-67', 'cotización adicional', 'idNorma=159800'],
    ['cl-ds-148', 'residuos peligrosos', 'idNorma=226458'],
    ['cl-ley-19628', 'vida privada', 'idNorma=141599'],
  ])('%s existe con scope sobre %s y URL BCN %s', (id, scopeFragment, idNorma) => {
    const reg = byId.get(id);
    expect(reg, `${id} ausente del CL pack`).toBeDefined();
    expect(`${reg!.title} ${reg!.scope}`.toLowerCase()).toContain(
      scopeFragment.toLowerCase()
    );
    expect(reg!.url).toContain(idNorma);
  });
});
