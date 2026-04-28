// Praeventio Guard — SII adapter tests.
//
// Coverage:
//   • `calculateDteTotals` — pure helper, IVA rounding, exempt mixing,
//     edge cases (empty, negative, fractional, large amounts).
//   • `getSiiAdapter()` facade — env-based selection + fallback.
//   • `noopSiiAdapter` — success-shaped responses for dev/CI.
//   • Each PSE stub — throws `SiiNotImplementedError` with PSE-specific
//     docs URL so the message is actionable.
//
// IVA-rounding parity with `src/services/pricing/tiers.ts:withIVA` is
// asserted explicitly so a future change to one rule trips the other.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withIVA } from '../pricing/tiers';
import {
  __resetNoopSiiAdapterStateForTests,
  calculateDteTotals,
  noopSiiAdapter,
  SiiAdapterError,
  SiiNotImplementedError,
} from './siiAdapter';
import { bsaleAdapter } from './bsaleAdapter';
import { libredteAdapter } from './libredteAdapter';
import { openfacturaAdapter } from './openfacturaAdapter';
import { simpleApiAdapter } from './simpleApiAdapter';
import { getSiiAdapter } from './index';

describe('calculateDteTotals (pure helper)', () => {
  it('single line, IVA 19% — matches the 11990 retail figure', () => {
    const totals = calculateDteTotals([
      { description: 'Tier Comité Paritario', quantity: 1, unitPrice: 10075 },
    ]);
    expect(totals).toEqual({
      netAmount: 10075,
      exemptAmount: 0,
      ivaRate: 0.19,
      iva: 1915,
      total: 11990,
    });
  });

  it('multi-line, all non-exempt, sums quantities and prices', () => {
    const totals = calculateDteTotals([
      { description: 'Base', quantity: 1, unitPrice: 10075 },
      { description: 'Extra worker', quantity: 3, unitPrice: 990 },
    ]);
    // net = 10075 + 2970 = 13045 ; iva = ceil(13045*0.19) = ceil(2478.55) = 2479
    expect(totals.netAmount).toBe(13045);
    expect(totals.exemptAmount).toBe(0);
    expect(totals.iva).toBe(2479);
    expect(totals.total).toBe(15524);
  });

  it('multi-line with mixed exempt/non-exempt', () => {
    const totals = calculateDteTotals([
      { description: 'Servicio afecto', quantity: 1, unitPrice: 10075 },
      { description: 'Servicio exento', quantity: 1, unitPrice: 5000, exemptFromIva: true },
    ]);
    expect(totals).toEqual({
      netAmount: 10075,
      exemptAmount: 5000,
      ivaRate: 0.19,
      iva: 1915,
      total: 16990,
    });
  });

  it('all-exempt DTE (boleta exenta, type 41) — IVA is zero', () => {
    const totals = calculateDteTotals([
      { description: 'Capacitación SUSESO', quantity: 2, unitPrice: 25000, exemptFromIva: true },
    ]);
    expect(totals).toEqual({
      netAmount: 0,
      exemptAmount: 50000,
      ivaRate: 0.19,
      iva: 0,
      total: 50000,
    });
  });

  it('empty line list → zero totals (no division by zero)', () => {
    expect(calculateDteTotals([])).toEqual({
      netAmount: 0,
      exemptAmount: 0,
      ivaRate: 0.19,
      iva: 0,
      total: 0,
    });
  });

  it('rejects negative quantity', () => {
    expect(() =>
      calculateDteTotals([{ description: 'X', quantity: -1, unitPrice: 100 }]),
    ).toThrow(SiiAdapterError);
  });

  it('rejects zero quantity (DTE schema requires positive units)', () => {
    expect(() =>
      calculateDteTotals([{ description: 'X', quantity: 0, unitPrice: 100 }]),
    ).toThrow(/positive integer/);
  });

  it('rejects fractional quantity', () => {
    expect(() =>
      calculateDteTotals([{ description: 'X', quantity: 1.5, unitPrice: 100 }]),
    ).toThrow(SiiAdapterError);
  });

  it('rejects fractional unitPrice (no decimals on CLP)', () => {
    expect(() =>
      calculateDteTotals([{ description: 'X', quantity: 1, unitPrice: 99.5 }]),
    ).toThrow(/whole non-negative CLP/);
  });

  it('rejects negative unitPrice', () => {
    expect(() =>
      calculateDteTotals([{ description: 'X', quantity: 1, unitPrice: -100 }]),
    ).toThrow(SiiAdapterError);
  });

  it('IVA rounding is consistent with pricing/tiers.ts:withIVA', () => {
    // Cross-link the two helpers so a future drift trips both tests.
    const samples = [10075, 25210, 42850, 76470, 100000];
    for (const subtotal of samples) {
      const tiersResult = withIVA(subtotal);
      const dteResult = calculateDteTotals([
        { description: 'X', quantity: 1, unitPrice: subtotal },
      ]);
      expect(dteResult.iva).toBe(tiersResult.iva);
      expect(dteResult.total).toBe(tiersResult.total);
    }
  });

  it('handles large amounts (Ilimitado tier ~5.999.990 CLP) without precision loss', () => {
    const totals = calculateDteTotals([
      { description: 'Ilimitado', quantity: 1, unitPrice: 5042008 },
    ]);
    // 5042008 * 0.19 = 957981.52 → ceil = 957982 → total 5999990
    expect(totals.iva).toBe(957982);
    expect(totals.total).toBe(5999990);
  });
});

describe('getSiiAdapter() facade', () => {
  const originalEnv = process.env.SII_PSE;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SII_PSE;
    } else {
      process.env.SII_PSE = originalEnv;
    }
  });

  it('returns noopSiiAdapter when SII_PSE is unset', () => {
    delete process.env.SII_PSE;
    expect(getSiiAdapter().name).toBe('noop');
  });

  it('returns noopSiiAdapter for unrecognized values', () => {
    process.env.SII_PSE = 'definitely-not-a-real-pse';
    expect(getSiiAdapter().name).toBe('noop');
  });

  it('selects openfactura when SII_PSE=openfactura', () => {
    process.env.SII_PSE = 'openfactura';
    expect(getSiiAdapter().name).toBe('openfactura');
  });

  it('selects simpleapi when SII_PSE=simpleapi (case-insensitive)', () => {
    process.env.SII_PSE = 'SimpleAPI';
    expect(getSiiAdapter().name).toBe('simpleapi');
  });

  it('selects bsale when SII_PSE=bsale', () => {
    process.env.SII_PSE = 'bsale';
    expect(getSiiAdapter().name).toBe('bsale');
  });

  it('selects libredte when SII_PSE=libredte', () => {
    process.env.SII_PSE = 'libredte';
    expect(getSiiAdapter().name).toBe('libredte');
  });
});

describe('noopSiiAdapter', () => {
  beforeEach(() => {
    __resetNoopSiiAdapterStateForTests();
  });

  it('isAvailable is true (always works in dev/CI)', () => {
    expect(noopSiiAdapter.isAvailable).toBe(true);
  });

  it('emitDte returns a deterministic folio for the same buyOrder', async () => {
    const req = {
      header: {
        type: 39 as const,
        emisorRut: '78231119-0' as const,
        emisorRazonSocial: 'Praeventio Guard SpA',
        emisorGiro: 'Servicios de prevención de riesgos laborales',
        receptorRut: '76543210-K',
        receptorRazonSocial: 'Cliente SpA',
        fechaEmision: '2026-04-28',
      },
      lineItems: [{ description: 'Tier Plata', quantity: 1, unitPrice: 42850 }],
      paymentInfo: { method: 'webpay' as const, reference: 'INV-2026-04-28-001' },
    };
    const r1 = await noopSiiAdapter.emitDte(req);
    const r2 = await noopSiiAdapter.emitDte(req);
    expect(r1.folio).toBe(r2.folio);
    expect(r1.status).toBe('accepted');
    expect(r1.trackId).toBe(`noop-${r1.folio}`);
    expect(r1.emittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emitDte returns increasing folios when no payment reference', async () => {
    const req = {
      header: {
        type: 39 as const,
        emisorRut: '78231119-0' as const,
        emisorRazonSocial: 'Praeventio Guard SpA',
        emisorGiro: 'Servicios de prevención de riesgos laborales',
        receptorRut: '76543210-K',
        receptorRazonSocial: 'Cliente SpA',
        fechaEmision: '2026-04-28',
      },
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
    };
    const r1 = await noopSiiAdapter.emitDte(req);
    const r2 = await noopSiiAdapter.emitDte(req);
    expect(r2.folio).toBeGreaterThan(r1.folio);
  });

  it('getDteStatus echoes accepted status for noop trackIds', async () => {
    const status = await noopSiiAdapter.getDteStatus('noop-700000123');
    expect(status.status).toBe('accepted');
    expect(status.folio).toBe(700000123);
  });
});

describe('PSE stub adapters (deferred to Round 2)', () => {
  const stubs = [
    { adapter: openfacturaAdapter, name: 'openfactura', docs: 'openfactura.cl' },
    { adapter: simpleApiAdapter, name: 'simpleapi', docs: 'simpleapi.cl' },
    { adapter: bsaleAdapter, name: 'bsale', docs: 'bsale.dev' },
    { adapter: libredteAdapter, name: 'libredte', docs: 'libredte.cl' },
  ];

  it.each(stubs)('$name.emitDte throws SiiNotImplementedError with docs URL', async ({ adapter, docs }) => {
    const req = {
      header: {
        type: 33 as const,
        emisorRut: '78231119-0' as const,
        emisorRazonSocial: 'Praeventio Guard SpA',
        emisorGiro: 'Servicios de prevención de riesgos laborales',
        receptorRut: '76543210-K',
        receptorRazonSocial: 'Cliente SpA',
        fechaEmision: '2026-04-28',
      },
      lineItems: [{ description: 'X', quantity: 1, unitPrice: 10075 }],
    };
    await expect(adapter.emitDte(req)).rejects.toBeInstanceOf(SiiNotImplementedError);
    await expect(adapter.emitDte(req)).rejects.toThrow(new RegExp(docs));
  });

  it.each(stubs)('$name.getDteStatus throws SiiNotImplementedError', async ({ adapter }) => {
    await expect(adapter.getDteStatus('any')).rejects.toBeInstanceOf(SiiNotImplementedError);
  });

  it.each(stubs)('$name has the correct adapter.name string', ({ adapter, name }) => {
    expect(adapter.name).toBe(name);
  });
});
