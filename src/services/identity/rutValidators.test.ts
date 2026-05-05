// Praeventio Guard — Sprint 31 Bucket PP.
//
// Country-specific tax-id validator tests. Covers seven jurisdictions:
// CL (RUT), BR (CPF), MX (RFC), AR (CUIT), CO (NIT), US (SSN), GB (NI).

import { describe, it, expect } from 'vitest';
import {
  validateChileanRut,
  validateBrazilianCpf,
  validateMexicanRfc,
  validateArgentineCuit,
  validateColombianNit,
  validateSsn,
  validateNiNumber,
  validateGenericTaxId,
} from './rutValidators';

describe('validateChileanRut', () => {
  it('accepts canonical formatted RUT with K check digit', () => {
    // 11.111.111-1 — body 11111111 module-11 → DV 1 (well-known sample).
    const r = validateChileanRut('11.111.111-1');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('11111111-1');
  });

  it('accepts plain digits without separators', () => {
    expect(validateChileanRut('111111111').valid).toBe(true);
  });

  it('accepts K as check digit (lowercase normalized to upper)', () => {
    // Body 10000013 → DV K (mod-11 remainder 1 → 11-1=10 → K).
    const r = validateChileanRut('10.000.013-k');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('10000013-K');
  });

  it('rejects bad check digit', () => {
    const r = validateChileanRut('11.111.111-9');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_check_digit');
  });

  it('rejects malformed input', () => {
    expect(validateChileanRut('').reason).toBe('empty');
    expect(validateChileanRut('abc').reason).toBe('malformed');
    expect(validateChileanRut('12-3').reason).toBe('malformed');
  });
});

describe('validateBrazilianCpf', () => {
  it('accepts a valid CPF (well-known sample)', () => {
    // 111.444.777-35 is the canonical valid sample CPF used in BR docs.
    const r = validateBrazilianCpf('111.444.777-35');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('11144477735');
  });

  it('rejects all-same-digit CPFs (Receita Federal blocklist)', () => {
    const r = validateBrazilianCpf('111.111.111-11');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('blocked_pattern');
  });

  it('rejects bad check digit', () => {
    const r = validateBrazilianCpf('111.444.777-99');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_check_digit');
  });

  it('rejects wrong length', () => {
    expect(validateBrazilianCpf('123').reason).toBe('wrong_length');
  });
});

describe('validateMexicanRfc', () => {
  it('accepts a 13-char persona física RFC', () => {
    // VECJ880326XXX — V/E/C/J + 880326 (1988-03-26) + 3 alnum.
    const r = validateMexicanRfc('VECJ880326ABC');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('VECJ880326ABC');
  });

  it('accepts a 12-char persona moral RFC', () => {
    const r = validateMexicanRfc('GOO850101DF1');
    expect(r.valid).toBe(true);
  });

  it('rejects invalid month in date part', () => {
    const r = validateMexicanRfc('VECJ881326ABC');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_month');
  });

  it('rejects wrong length', () => {
    expect(validateMexicanRfc('ABCD').reason).toBe('wrong_length');
  });
});

describe('validateArgentineCuit', () => {
  it('accepts a valid CUIT (well-known AFIP sample)', () => {
    // 20-12345678-? — compute mod-11.
    // weights 5,4,3,2,7,6,5,4,3,2 over 2,0,1,2,3,4,5,6,7,8
    // = 10+0+3+4+21+24+25+24+21+16 = 148 → 148%11 = 148-143=5 → 11-5=6
    const r = validateArgentineCuit('20-12345678-6');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('20123456786');
  });

  it('rejects bad check digit', () => {
    const r = validateArgentineCuit('20-12345678-9');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_check_digit');
  });

  it('rejects wrong length', () => {
    expect(validateArgentineCuit('123').reason).toBe('wrong_length');
  });
});

describe('validateColombianNit', () => {
  it('accepts a valid NIT (computed sample)', () => {
    // body 800197268 — well-known sample in DIAN docs has DV 4.
    const r = validateColombianNit('800.197.268-4');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('800197268-4');
  });

  it('rejects bad check digit', () => {
    const r = validateColombianNit('800197268-9');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad_check_digit');
  });

  it('rejects wrong length', () => {
    expect(validateColombianNit('12').reason).toBe('wrong_length');
  });
});

describe('validateSsn', () => {
  it('accepts a structurally valid SSN', () => {
    const r = validateSsn('123-45-6789');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('123-45-6789');
  });

  it('rejects 000 area', () => {
    expect(validateSsn('000-12-3456').reason).toBe('reserved_area');
  });

  it('rejects 666 area', () => {
    expect(validateSsn('666-12-3456').reason).toBe('reserved_area');
  });

  it('rejects 900+ area', () => {
    expect(validateSsn('900-12-3456').reason).toBe('reserved_area');
  });

  it('rejects 00 group', () => {
    expect(validateSsn('123-00-3456').reason).toBe('reserved_group');
  });

  it('rejects 0000 serial', () => {
    expect(validateSsn('123-45-0000').reason).toBe('reserved_serial');
  });
});

describe('validateNiNumber', () => {
  it('accepts a valid NI', () => {
    const r = validateNiNumber('AB123456C');
    expect(r.valid).toBe(true);
  });

  it('rejects blocked prefix BG', () => {
    expect(validateNiNumber('BG123456A').reason).toBe('blocked_prefix');
  });

  it('rejects bad first letter (D)', () => {
    expect(validateNiNumber('DA123456A').reason).toBe('reserved_prefix_letter');
  });

  it('rejects bad suffix', () => {
    expect(validateNiNumber('AB123456E').reason).toBe('bad_suffix');
  });

  it('rejects malformed', () => {
    expect(validateNiNumber('').reason).toBe('empty');
    expect(validateNiNumber('ABC123').reason).toBe('malformed');
  });
});

describe('validateGenericTaxId', () => {
  it('dispatches CL → Chilean RUT', () => {
    expect(validateGenericTaxId('11.111.111-1', 'CL').valid).toBe(true);
  });

  it('dispatches BR → Brazilian CPF', () => {
    expect(validateGenericTaxId('111.444.777-35', 'BR').valid).toBe(true);
  });

  it('dispatches MX → Mexican RFC', () => {
    expect(validateGenericTaxId('VECJ880326ABC', 'MX').valid).toBe(true);
  });

  it('dispatches AR → Argentine CUIT', () => {
    expect(validateGenericTaxId('20-12345678-6', 'AR').valid).toBe(true);
  });

  it('dispatches CO → Colombian NIT', () => {
    expect(validateGenericTaxId('800.197.268-4', 'CO').valid).toBe(true);
  });

  it('dispatches US → SSN', () => {
    expect(validateGenericTaxId('123-45-6789', 'US').valid).toBe(true);
  });

  it('dispatches GB and UK → NI', () => {
    expect(validateGenericTaxId('AB123456C', 'GB').valid).toBe(true);
    expect(validateGenericTaxId('AB123456C', 'UK').valid).toBe(true);
  });

  it('returns unsupported_country for unknown ISO', () => {
    const r = validateGenericTaxId('123', 'XX');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unsupported_country');
  });

  it('is case-insensitive on country code', () => {
    expect(validateGenericTaxId('11.111.111-1', 'cl').valid).toBe(true);
  });
});
