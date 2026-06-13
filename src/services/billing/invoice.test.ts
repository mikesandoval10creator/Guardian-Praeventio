import { afterEach, describe, it, expect } from 'vitest';
import { buildInvoice, calculateInvoiceTotals, tryAutoIssueDte } from './invoice.js';
import type { CheckoutRequest, Invoice, InvoiceLineItem } from './types.js';

const cliente = {
  nombre: 'Constructora Demo Ltda.',
  rut: '76.123.456-7',
  email: 'finanzas@constructora.cl',
};

describe('calculateInvoiceTotals', () => {
  it('reverse-engineers IVA so total === subtotal + iva exactly (Comité Paritario base)', () => {
    // 10075 * 1.19 = 11989.25 → ceil = 11990 → iva = 1915 ✅ identity holds
    const lineItems: InvoiceLineItem[] = [
      {
        tierId: 'comite-paritario',
        description: 'Suscripción Comité Paritario',
        quantity: 1,
        unitAmount: 10075,
        currency: 'CLP',
      },
    ];
    expect(calculateInvoiceTotals(lineItems, true)).toEqual({
      subtotal: 10075,
      iva: 1915,
      total: 11990,
      currency: 'CLP',
    });
  });

  it('does not apply IVA for USD even when applyIVA is false', () => {
    const lineItems: InvoiceLineItem[] = [
      {
        tierId: 'comite-paritario',
        description: 'Subscription Comité Paritario',
        quantity: 1,
        unitAmount: 13,
        currency: 'USD',
      },
    ];
    expect(calculateInvoiceTotals(lineItems, false)).toEqual({
      subtotal: 13,
      iva: 0,
      total: 13,
      currency: 'USD',
    });
  });

  it('returns all zeros for empty line items', () => {
    expect(calculateInvoiceTotals([], true)).toEqual({
      subtotal: 0,
      iva: 0,
      total: 0,
      currency: 'CLP',
    });
  });

  it('applies IVA once on the aggregate subtotal for multi-line invoices (base + worker overage)', () => {
    // Comité Paritario base $10,075 net + 5 workers extra at $832 net (≈$990 final / 1.19)
    const lineItems: InvoiceLineItem[] = [
      {
        tierId: 'comite-paritario',
        description: 'Suscripción Comité Paritario',
        quantity: 1,
        unitAmount: 10075,
        currency: 'CLP',
      },
      {
        tierId: 'comite-paritario',
        description: 'Trabajadores adicionales (5)',
        quantity: 5,
        unitAmount: 832,
        currency: 'CLP',
        isOverage: true,
      },
    ];
    const totals = calculateInvoiceTotals(lineItems, true);
    // subtotal = 10075 + 5*832 = 14235; ceil(14235 * 1.19) = ceil(16939.65) = 16940
    expect(totals.subtotal).toBe(14235);
    expect(totals.total).toBe(16940);
    expect(totals.iva).toBe(16940 - 14235); // 2705
    expect(totals.subtotal + totals.iva).toBe(totals.total);
    expect(totals.currency).toBe('CLP');
  });

  it('refuses to mix currencies in a single invoice', () => {
    const lineItems: InvoiceLineItem[] = [
      {
        tierId: 'a',
        description: 'CLP line',
        quantity: 1,
        unitAmount: 10000,
        currency: 'CLP',
      },
      {
        tierId: 'b',
        description: 'USD line',
        quantity: 1,
        unitAmount: 13,
        currency: 'USD',
      },
    ];
    expect(() => calculateInvoiceTotals(lineItems, true)).toThrow(
      /mixed currencies/i,
    );
  });

  it('handles a clean integer where IVA is exact (no ceil needed)', () => {
    const lineItems: InvoiceLineItem[] = [
      {
        tierId: 'x',
        description: 'Round',
        quantity: 1,
        unitAmount: 100,
        currency: 'CLP',
      },
    ];
    // 100 * 1.19 = 119 exactly
    expect(calculateInvoiceTotals(lineItems, true)).toEqual({
      subtotal: 100,
      iva: 19,
      total: 119,
      currency: 'CLP',
    });
  });
});

describe('buildInvoice', () => {
  const tierData = {
    clpRegular: 10075, // net base for Comité Paritario (display $11,990 incl IVA)
    clpAnual: 81504, // net annual (display $96,990)
    usdRegular: 13,
    usdAnual: 130,
  };

  const fixedNow = () => new Date('2026-04-28T12:00:00.000Z');
  const fixedId = () => 'inv_test_001';

  it('builds a Comité Paritario monthly invoice with worker overage (30 workers, 3 projects)', () => {
    const request: CheckoutRequest = {
      tierId: 'comite-paritario',
      cycle: 'monthly',
      currency: 'CLP',
      totalWorkers: 30,
      totalProjects: 3,
      cliente,
      paymentMethod: 'webpay',
    };
    const invoice = buildInvoice(
      request,
      tierData,
      { workers: 5, projects: 0, clpPerWorker: 832, clpPerProject: 5034 },
      { idGenerator: fixedId, now: fixedNow },
    );

    expect(invoice.emisorRut).toBe('78231119-0');
    expect(invoice.emisorRazonSocial).toBe('Praeventio Guard SpA');
    expect(invoice.id).toBe('inv_test_001');
    expect(invoice.status).toBe('draft');
    expect(invoice.issuedAt).toBe('2026-04-28T12:00:00.000Z');
    expect(invoice.cliente).toEqual(cliente);
    expect(invoice.paymentMethod).toBe('webpay');

    // Two lines: base + worker overage
    expect(invoice.lineItems).toHaveLength(2);
    expect(invoice.lineItems[0]).toMatchObject({
      tierId: 'comite-paritario',
      quantity: 1,
      unitAmount: 10075,
      currency: 'CLP',
    });
    expect(invoice.lineItems[1]).toMatchObject({
      quantity: 5,
      unitAmount: 832,
      currency: 'CLP',
      isOverage: true,
    });

    // subtotal = 10075 + 5*832 = 14235
    expect(invoice.totals.subtotal).toBe(14235);
    expect(invoice.totals.total).toBe(16940);
    expect(invoice.totals.iva).toBe(2705);
    expect(invoice.totals.currency).toBe('CLP');
  });

  it('skips overage lines for USD invoices (international hard caps)', () => {
    const request: CheckoutRequest = {
      tierId: 'comite-paritario',
      cycle: 'monthly',
      currency: 'USD',
      totalWorkers: 30,
      totalProjects: 3,
      cliente: { nombre: 'Acme Inc', email: 'ap@acme.com' },
      // §2.12 (Fase C.2, 2026-05-21): Stripe descartado → USD usa manual-transfer.
      paymentMethod: 'manual-transfer',
    };
    const invoice = buildInvoice(
      request,
      tierData,
      { workers: 5, projects: 1, clpPerWorker: 832, clpPerProject: 5034 },
      { idGenerator: fixedId, now: fixedNow },
    );

    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.totals.iva).toBe(0);
    expect(invoice.totals.subtotal).toBe(13);
    expect(invoice.totals.total).toBe(13);
    expect(invoice.totals.currency).toBe('USD');
  });

  it('uses clpAnual when cycle is annual', () => {
    const request: CheckoutRequest = {
      tierId: 'comite-paritario',
      cycle: 'annual',
      currency: 'CLP',
      totalWorkers: 10,
      totalProjects: 1,
      cliente,
      paymentMethod: 'webpay',
    };
    const invoice = buildInvoice(
      request,
      tierData,
      { workers: 0, projects: 0, clpPerWorker: 832, clpPerProject: 5034 },
      { idGenerator: fixedId, now: fixedNow },
    );
    expect(invoice.lineItems[0].unitAmount).toBe(81504);
  });

  it('issuedAt is a recent ISO timestamp when no clock override', () => {
    const request: CheckoutRequest = {
      tierId: 'comite-paritario',
      cycle: 'monthly',
      currency: 'CLP',
      totalWorkers: 10,
      totalProjects: 1,
      cliente,
      paymentMethod: 'manual-transfer',
    };
    const before = Date.now();
    const invoice = buildInvoice(request, tierData, {
      workers: 0,
      projects: 0,
      clpPerWorker: 832,
      clpPerProject: 5034,
    });
    const after = Date.now();
    const issued = Date.parse(invoice.issuedAt);
    expect(Number.isFinite(issued)).toBe(true);
    expect(issued).toBeGreaterThanOrEqual(before);
    expect(issued).toBeLessThanOrEqual(after);
  });
});

// sii-noop-guard (2026-06-12): `tryAutoIssueDte` must NEVER emit through an
// unconfigured PSE in production. Without a real `SII_PSE` the only adapter
// available is the `noop` fake (accepted for an UN-emitted DTE) — so in prod
// it must skip honestly (`not-configured`) instead of pretending the factura
// was issued. The payment flow is unaffected (the caller already swallows
// skips); the queue drain records the honest skip and the worker can retry
// once a PSE is wired.
describe('tryAutoIssueDte production fail-closed (sii-noop-guard)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPse = process.env.SII_PSE;
  const originalBsaleToken = process.env.BSALE_ACCESS_TOKEN;
  const originalBsaleOffice = process.env.BSALE_OFFICE_ID;

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('SII_PSE', originalPse);
    restore('BSALE_ACCESS_TOKEN', originalBsaleToken);
    restore('BSALE_OFFICE_ID', originalBsaleOffice);
  });

  const paidClpInvoice: Invoice = {
    id: 'inv_dte_001',
    emisorRut: '78231119-0',
    emisorRazonSocial: 'Praeventio Guard SpA',
    cliente: { nombre: 'Constructora Demo Ltda.', rut: '76.123.456-7', email: 'finanzas@constructora.cl' },
    lineItems: [
      { tierId: 'comite-paritario', description: 'Plan Comité Paritario', quantity: 1, unitAmount: 10075, currency: 'CLP' },
    ],
    totals: { subtotal: 10075, iva: 1915, total: 11990, currency: 'CLP' },
    paymentMethod: 'webpay',
    issuedAt: '2026-06-12T12:00:00.000Z',
    status: 'paid',
  };

  it('skips with not-configured in prod when SII_PSE is unset (never noop-accepted)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SII_PSE;
    const result = await tryAutoIssueDte(paidClpInvoice, { autoIssueEnabled: true });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe('not-configured');
    // Crucially never reports a fake success.
    expect(result.result).toBeUndefined();
  });

  it('skips with not-configured in prod when SII_PSE=noop (explicit)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SII_PSE = 'noop';
    const result = await tryAutoIssueDte(paidClpInvoice, { autoIssueEnabled: true });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe('not-configured');
  });

  it('does NOT short-circuit when SII_PSE=bsale but creds absent → no-adapter (real adapter resolution)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SII_PSE = 'bsale';
    delete process.env.BSALE_ACCESS_TOKEN;
    delete process.env.BSALE_OFFICE_ID;
    const result = await tryAutoIssueDte(paidClpInvoice, { autoIssueEnabled: true });
    expect(result.ok).toBe(false);
    // Past the prod gate: the Bsale adapter is resolved but unavailable.
    expect(result.skipped).toBe('no-adapter');
  });

  it('outside production an unset SII_PSE falls through to adapter resolution (dev keeps working)', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SII_PSE;
    delete process.env.BSALE_ACCESS_TOKEN;
    delete process.env.BSALE_OFFICE_ID;
    const result = await tryAutoIssueDte(paidClpInvoice, { autoIssueEnabled: true });
    // In dev/test with no Bsale creds it stops at no-adapter, NOT not-configured.
    expect(result.skipped).toBe('no-adapter');
  });
});
