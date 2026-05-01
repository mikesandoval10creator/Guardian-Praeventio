/**
 * Smoke: billing tier → invoice → audit.
 *
 * Crosses pricing/tiers, billing/invoice, and billing/types. The point is
 * to catch a regression where any of these modules' shapes drift
 * (e.g. a price changes, the IVA rounding rule diverges, the emisor RUT
 * literal type loosens) BEFORE merge — even when each module's own unit
 * tests still pass in isolation.
 */
import { describe, expect, it } from 'vitest';

import { buildInvoice, calculateInvoiceTotals } from '../services/billing/invoice';
import { PRAEVENTIO_EMISOR_RUT } from '../services/billing/types';
import { calculateMonthlyCost, getTierById, withIVA } from '../services/pricing/tiers';

import { ONE_LINE_ITEM_CLP, SAMPLE_CHECKOUT } from './setup';

describe('smoke: billing tier → invoice → audit', () => {
  it('comite-paritario base CLP price is 11990', () => {
    const tier = getTierById('comite-paritario');
    expect(tier.clpRegular).toBe(11990);
  });

  it('calculateMonthlyCost(comite-paritario, 30, 3) = 11990 + 5*990 = 16940', () => {
    const cost = calculateMonthlyCost('comite-paritario', 30, 3);
    expect(cost.base).toBe(11990);
    expect(cost.workerOverage).toBe(5 * 990);
    expect(cost.projectOverage).toBe(0);
    expect(cost.total).toBe(16940);
  });

  it('withIVA(10075) → { subtotal: 10075, iva: 1915, total: 11990 }', () => {
    expect(withIVA(10075)).toEqual({ subtotal: 10075, iva: 1915, total: 11990 });
  });

  it('calculateInvoiceTotals matches withIVA for the same subtotal', () => {
    const totals = calculateInvoiceTotals(ONE_LINE_ITEM_CLP, true);
    const expected = withIVA(10075);
    expect(totals.subtotal).toBe(expected.subtotal);
    expect(totals.iva).toBe(expected.iva);
    expect(totals.total).toBe(expected.total);
    expect(totals.currency).toBe('CLP');
  });

  it('end-to-end: buildInvoice → emisorRut === "78231119-0" and totals reconcile', () => {
    // tierData uses NET (pre-IVA) prices: 10075 net + 19 % IVA → 11990 retail.
    // See `invoice.test.ts` for the same convention.
    const invoice = buildInvoice(
      SAMPLE_CHECKOUT,
      { clpRegular: 10075, clpAnual: 81504, usdRegular: 13, usdAnual: 130 },
      { workers: 0, projects: 0, clpPerWorker: 832, clpPerProject: 5034 },
      {
        idGenerator: () => 'inv_smoke_test',
        now: () => new Date('2026-04-28T00:00:00.000Z'),
      },
    );

    expect(invoice.emisorRut).toBe(PRAEVENTIO_EMISOR_RUT);
    expect(invoice.emisorRut).toBe('78231119-0');
    expect(invoice.id).toBe('inv_smoke_test');
    expect(invoice.cliente.email).toBe('smoke@praeventio.test');
    expect(invoice.lineItems.length).toBeGreaterThanOrEqual(1);

    const sumOfLines = invoice.lineItems.reduce(
      (acc, li) => acc + li.quantity * li.unitAmount,
      0,
    );
    expect(invoice.totals.subtotal).toBe(sumOfLines);
    expect(invoice.totals.subtotal + invoice.totals.iva).toBe(invoice.totals.total);
    // Retail display price for Comité Paritario monthly is $11,990 incl IVA.
    expect(invoice.totals.total).toBe(11990);
    expect(invoice.status).toBe('draft');
  });
});
