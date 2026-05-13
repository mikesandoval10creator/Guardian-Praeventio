// Praeventio Guard — SII pre-flight checks tests. Sprint 50, E.5 P2 H5.
//
// Coverage matrix:
//   • happy path — factura with valid RUTs + cert ambiente + PSE token.
//   • blocking: missing PSE token, SII_RUT_EMPRESA missing, ambiente
//     missing/invalid, issuer RUT bad check digit, receiver missing for
//     factura, fractional/zero/negative/overflow amounts.
//   • allowed: boleta without receiver, certificacion ambiente, prod
//     ambiente, both casing tolerated for ambiente.
//   • warning: honorarios threshold for service > 5M CLP.
//   • computedTax math parity with `withIVA` rounding rule.
//   • validateChileanRut — 5 valid + 5 invalid cases.

import { describe, expect, it } from 'vitest';
import {
  runSiiPreflight,
  validateChileanRut,
  SII_FACTURA_MAX_NET_CLP,
  SII_HONORARIOS_WARNING_THRESHOLD_CLP,
  type SiiPreflightInput,
} from './siiPreflightCheck';

// Known-valid Chilean RUTs (mod-11 verified):
//   78231119-0  → Praeventio Guard SpA
//   12345678-5  → test issuer
//   11111111-1  → test receiver
//   22222222-2  → test receiver alt
//   76086438-7  → mod-11 valid (verified)
const RUT_PRAEVENTIO = '78231119-0';
const RUT_ISSUER_OK = '12345678-5';
const RUT_RECEIVER_OK = '11111111-1';
const RUT_RECEIVER_OK_2 = '22222222-2';

// Known-invalid (correct shape, wrong DV):
const RUT_ISSUER_BAD_DV = '12345678-9';
const RUT_RECEIVER_BAD_DV = '11111111-9';

const baseEnv: NodeJS.ProcessEnv = {
  BSALE_API_TOKEN: 'bsale-test-token',
  SII_RUT_EMPRESA: RUT_ISSUER_OK,
  SII_AMBIENTE: 'certificacion',
};

function makeInput(overrides: Partial<SiiPreflightInput> = {}): SiiPreflightInput {
  return {
    env: baseEnv,
    documentKind: 'factura_electronica',
    issuerTaxId: RUT_ISSUER_OK,
    receiverTaxId: RUT_RECEIVER_OK,
    amountNetClp: 10_000,
    itemKind: 'product',
    ...overrides,
  };
}

describe('runSiiPreflight — happy path', () => {
  it('factura with valid RUTs + cert ambiente + PSE token → ok', () => {
    const result = runSiiPreflight(makeInput());
    expect(result.ok).toBe(true);
    expect(result.blockingFailures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('boleta_electronica without receiverTaxId → ok (not required)', () => {
    const result = runSiiPreflight(
      makeInput({ documentKind: 'boleta_electronica', receiverTaxId: undefined }),
    );
    expect(result.ok).toBe(true);
    expect(result.blockingFailures).toEqual([]);
  });

  it('produccion ambiente → ok', () => {
    const env = { ...baseEnv, SII_AMBIENTE: 'produccion' };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(true);
  });

  it('accepts PSE_API_TOKEN as fallback when BSALE_API_TOKEN missing', () => {
    const env = {
      SII_RUT_EMPRESA: RUT_ISSUER_OK,
      SII_AMBIENTE: 'certificacion',
      PSE_API_TOKEN: 'generic-pse-token',
    };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(true);
  });

  it('accepts OPENFACTURA_API_KEY as PSE credential', () => {
    const env = {
      SII_RUT_EMPRESA: RUT_ISSUER_OK,
      SII_AMBIENTE: 'certificacion',
      OPENFACTURA_API_KEY: 'of-key',
    };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(true);
  });

  it('ambiente comparison is case-insensitive (PRODUCCION accepted)', () => {
    const env = { ...baseEnv, SII_AMBIENTE: 'PRODUCCION' };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(true);
  });
});

describe('runSiiPreflight — blocking failures', () => {
  it('missing PSE token → blocking PSE_TOKEN_MISSING', () => {
    const env = { SII_RUT_EMPRESA: RUT_ISSUER_OK, SII_AMBIENTE: 'certificacion' };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('PSE_TOKEN_MISSING');
  });

  it('empty string PSE token treated as missing', () => {
    const env = {
      SII_RUT_EMPRESA: RUT_ISSUER_OK,
      SII_AMBIENTE: 'certificacion',
      BSALE_API_TOKEN: '   ',
    };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('PSE_TOKEN_MISSING');
  });

  it('SII_RUT_EMPRESA missing → blocking', () => {
    const env = { BSALE_API_TOKEN: 'tok', SII_AMBIENTE: 'certificacion' };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('SII_RUT_EMPRESA_MISSING');
  });

  it('SII_RUT_EMPRESA mismatch with issuerTaxId → ISSUER_RUT_MISMATCH (anti-tampering)', () => {
    const env = {
      BSALE_API_TOKEN: 'tok',
      SII_AMBIENTE: 'certificacion',
      SII_RUT_EMPRESA: RUT_PRAEVENTIO,
    };
    const result = runSiiPreflight(
      makeInput({ env, issuerTaxId: RUT_ISSUER_OK }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('ISSUER_RUT_MISMATCH');
  });

  it('SII_RUT_EMPRESA matches issuer even with dots in env value', () => {
    const env = {
      BSALE_API_TOKEN: 'tok',
      SII_AMBIENTE: 'certificacion',
      // Same RUT as RUT_ISSUER_OK but formatted with dots.
      SII_RUT_EMPRESA: '12.345.678-5',
    };
    const result = runSiiPreflight(makeInput({ env, issuerTaxId: RUT_ISSUER_OK }));
    expect(result.blockingFailures.map((f) => f.code)).not.toContain(
      'ISSUER_RUT_MISMATCH',
    );
  });

  it('SII_AMBIENTE missing → blocking SII_AMBIENTE_MISSING', () => {
    const env = { BSALE_API_TOKEN: 'tok', SII_RUT_EMPRESA: RUT_ISSUER_OK };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('SII_AMBIENTE_MISSING');
  });

  it('SII_AMBIENTE = "staging" → SII_AMBIENTE_INVALID', () => {
    const env = { ...baseEnv, SII_AMBIENTE: 'staging' };
    const result = runSiiPreflight(makeInput({ env }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('SII_AMBIENTE_INVALID');
  });

  it('issuerTaxId with bad check digit → ISSUER_RUT_INVALID', () => {
    // Need env to match the (bad) issuer so we isolate the DV failure.
    const env = { ...baseEnv, SII_RUT_EMPRESA: RUT_ISSUER_BAD_DV };
    const result = runSiiPreflight(
      makeInput({ env, issuerTaxId: RUT_ISSUER_BAD_DV }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('ISSUER_RUT_INVALID');
  });

  it('factura_electronica without receiverTaxId → RECEIVER_RUT_MISSING', () => {
    const result = runSiiPreflight(
      makeInput({ documentKind: 'factura_electronica', receiverTaxId: undefined }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('RECEIVER_RUT_MISSING');
  });

  it('nota_credito without receiverTaxId → RECEIVER_RUT_MISSING', () => {
    const result = runSiiPreflight(
      makeInput({ documentKind: 'nota_credito', receiverTaxId: undefined }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('RECEIVER_RUT_MISSING');
  });

  it('factura_electronica with bad receiver DV → RECEIVER_RUT_INVALID', () => {
    const result = runSiiPreflight(makeInput({ receiverTaxId: RUT_RECEIVER_BAD_DV }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('RECEIVER_RUT_INVALID');
  });

  it('boleta with malformed receiver → warning, not blocking', () => {
    const result = runSiiPreflight(
      makeInput({
        documentKind: 'boleta_electronica',
        receiverTaxId: RUT_RECEIVER_BAD_DV,
      }),
    );
    expect(result.blockingFailures.map((f) => f.code)).not.toContain(
      'RECEIVER_RUT_INVALID',
    );
    expect(result.warnings.map((w) => w.code)).toContain('RECEIVER_RUT_INVALID_OPTIONAL');
  });

  it('amountNetClp = 0 → AMOUNT_NON_POSITIVE', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: 0 }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('AMOUNT_NON_POSITIVE');
  });

  it('amountNetClp negative → AMOUNT_NON_POSITIVE', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: -1 }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('AMOUNT_NON_POSITIVE');
  });

  it('amountNetClp fractional → AMOUNT_FRACTIONAL', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: 1000.5 }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('AMOUNT_FRACTIONAL');
  });

  it('amountNetClp NaN → AMOUNT_NOT_FINITE', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: Number.NaN }));
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('AMOUNT_NOT_FINITE');
  });

  it(`amountNetClp > ${SII_FACTURA_MAX_NET_CLP} → AMOUNT_EXCEEDS_LIMIT`, () => {
    const result = runSiiPreflight(
      makeInput({ amountNetClp: SII_FACTURA_MAX_NET_CLP + 1 }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('AMOUNT_EXCEEDS_LIMIT');
  });
});

describe('runSiiPreflight — warnings (non-blocking)', () => {
  it('service amount over honorarios threshold → HONORARIOS_THRESHOLD warning', () => {
    const result = runSiiPreflight(
      makeInput({
        itemKind: 'service',
        amountNetClp: SII_HONORARIOS_WARNING_THRESHOLD_CLP + 1,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('HONORARIOS_THRESHOLD');
  });

  it('product amount over honorarios threshold → NO warning (only services)', () => {
    const result = runSiiPreflight(
      makeInput({
        itemKind: 'product',
        amountNetClp: SII_HONORARIOS_WARNING_THRESHOLD_CLP + 1,
      }),
    );
    expect(result.warnings.map((w) => w.code)).not.toContain('HONORARIOS_THRESHOLD');
  });

  it('service amount under threshold → NO warning', () => {
    const result = runSiiPreflight(
      makeInput({ itemKind: 'service', amountNetClp: 1000 }),
    );
    expect(result.warnings.map((w) => w.code)).not.toContain('HONORARIOS_THRESHOLD');
  });
});

describe('runSiiPreflight — computedTax', () => {
  it('net 10000 → iva 1900 → total 11900', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: 10_000 }));
    expect(result.computedTax).toEqual({ netClp: 10_000, ivaClp: 1900, totalClp: 11_900 });
  });

  it('IVA rounds up (Math.ceil)', () => {
    // 10075 * 0.19 = 1914.25 → ceil 1915 → total 11990
    const result = runSiiPreflight(makeInput({ amountNetClp: 10_075 }));
    expect(result.computedTax).toEqual({ netClp: 10_075, ivaClp: 1915, totalClp: 11_990 });
  });

  it('computedTax is filled even when preflight failed', () => {
    const env = { SII_RUT_EMPRESA: RUT_ISSUER_OK, SII_AMBIENTE: 'certificacion' };
    const result = runSiiPreflight(makeInput({ env, amountNetClp: 5000 }));
    expect(result.ok).toBe(false); // missing PSE token
    expect(result.computedTax).toEqual({ netClp: 5000, ivaClp: 950, totalClp: 5950 });
  });

  it('zeros computedTax for non-positive amount', () => {
    const result = runSiiPreflight(makeInput({ amountNetClp: 0 }));
    expect(result.computedTax).toEqual({ netClp: 0, ivaClp: 0, totalClp: 0 });
  });
});

describe('validateChileanRut (boolean wrapper)', () => {
  it.each([
    ['78231119-0', 'Praeventio Guard'],
    ['12345678-5', 'plain'],
    ['11111111-1', 'repeated digits'],
    ['22222222-2', 'repeated digits 2'],
    ['12.345.678-5', 'with dots'],
  ])('valid: %s (%s)', (rut) => {
    expect(validateChileanRut(rut)).toBe(true);
  });

  it.each([
    ['12345678-9', 'wrong DV'],
    ['11111111-9', 'wrong DV 11M'],
    ['78231119-1', 'wrong DV Praeventio'],
    ['', 'empty'],
    ['not-a-rut', 'garbage'],
  ])('invalid: "%s" (%s)', (rut) => {
    expect(validateChileanRut(rut)).toBe(false);
  });
});

describe('runSiiPreflight — multi-failure accumulation', () => {
  it('accumulates multiple failures in one call', () => {
    // Empty env + bad RUT + zero amount + missing receiver.
    const result = runSiiPreflight({
      env: {},
      documentKind: 'factura_electronica',
      issuerTaxId: RUT_ISSUER_BAD_DV,
      receiverTaxId: undefined,
      amountNetClp: 0,
      itemKind: 'product',
    });
    expect(result.ok).toBe(false);
    const codes = result.blockingFailures.map((f) => f.code);
    expect(codes).toContain('PSE_TOKEN_MISSING');
    expect(codes).toContain('SII_RUT_EMPRESA_MISSING');
    expect(codes).toContain('SII_AMBIENTE_MISSING');
    expect(codes).toContain('ISSUER_RUT_INVALID');
    expect(codes).toContain('RECEIVER_RUT_MISSING');
    expect(codes).toContain('AMOUNT_NON_POSITIVE');
  });

  it('guia_despacho requires receiver', () => {
    const result = runSiiPreflight(
      makeInput({ documentKind: 'guia_despacho', receiverTaxId: undefined }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockingFailures.map((f) => f.code)).toContain('RECEIVER_RUT_MISSING');
  });

  it('guia_despacho with valid receiver → ok', () => {
    const result = runSiiPreflight(
      makeInput({ documentKind: 'guia_despacho', receiverTaxId: RUT_RECEIVER_OK_2 }),
    );
    expect(result.ok).toBe(true);
  });
});
