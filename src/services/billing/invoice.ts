// Praeventio Guard — Pure invoice math.
//
// This file MUST stay free of side effects (no Firestore, no fetch, no
// Date.now() in unit-testable paths) so it can be deterministically tested.
// `buildInvoice` accepts an optional clock for tests; production callers
// just pass nothing and get the current time.
//
// Rounding rule for IVA (Chilean B2B convention used by SII boletas):
//   total    = Math.ceil(subtotal * 1.19)
//   iva      = total - subtotal
// We invert the textbook `iva = round(subtotal * 0.19)` so the invariant
// `subtotal + iva === total` holds *exactly* and so display prices that end
// in $X.990 (the Chilean B2B convention) are reachable from clean integer
// subtotals. Cross-checked against `withIVA` in `src/services/pricing/tiers.ts`.

import {
  type CheckoutRequest,
  type CurrencyCode,
  type Invoice,
  type InvoiceLineItem,
  type InvoiceTotals,
  PRAEVENTIO_EMISOR_RAZON_SOCIAL_DEFAULT,
  PRAEVENTIO_EMISOR_RUT,
} from './types.js';
// Sprint 23 Bucket GG — wire the SII pipeline into invoice closure.
// Imported lazily inside `tryAutoIssueDte` so the pure helpers above stay
// dependency-free; the eager import would pull `bsaleAdapter` (which reads
// env vars) into every test that touches `buildInvoice`.
import type { DteResult } from '../sii/bsaleAdapter.js';

/**
 * Compute invoice totals.
 *
 * @param lineItems  Array of line items. Empty → all zeros.
 * @param applyIVA   `true` for CLP (Chile, 19% VAT). `false` for USD/international.
 *
 * Rounding rule:
 *   total = Math.ceil(subtotal * 1.19) when applyIVA is true.
 *   iva   = total - subtotal           (so the identity always holds).
 *
 * The currency on the resulting `InvoiceTotals` is taken from the first
 * line item; an empty array yields `CLP` because that is the home currency.
 * Mixed-currency line items are not allowed and will throw.
 */
export function calculateInvoiceTotals(
  lineItems: InvoiceLineItem[],
  applyIVA: boolean,
): InvoiceTotals {
  if (lineItems.length === 0) {
    return { subtotal: 0, iva: 0, total: 0, currency: 'CLP' };
  }

  const currency: CurrencyCode = lineItems[0].currency;
  for (const li of lineItems) {
    if (li.currency !== currency) {
      throw new Error(
        `Mixed currencies in invoice: expected ${currency}, found ${li.currency}`,
      );
    }
  }

  const subtotal = lineItems.reduce(
    (acc, li) => acc + li.quantity * li.unitAmount,
    0,
  );

  if (!applyIVA || currency !== 'CLP') {
    return { subtotal, iva: 0, total: subtotal, currency };
  }

  const total = Math.ceil(subtotal * 1.19);
  const iva = total - subtotal;
  return { subtotal, iva, total, currency };
}

export interface BuildInvoiceTierData {
  clpRegular: number;
  clpAnual: number;
  usdRegular: number;
  usdAnual: number;
}

export interface BuildInvoiceOverage {
  workers: number;
  projects: number;
  clpPerWorker: number;
  clpPerProject: number;
}

export interface BuildInvoiceOptions {
  /** Override id generation in tests. */
  idGenerator?: () => string;
  /** Override clock in tests. */
  now?: () => Date;
  /** Override emisor razón social (defaults to env or constant). */
  emisorRazonSocial?: string;
}

function defaultIdGenerator(): string {
  // Short alphanumeric id — replace with Firestore doc id at the endpoint
  // boundary. Keeping local generator for offline / unit-test use.
  return `inv_${globalThis.crypto.randomUUID()}`;
}

/**
 * Construct an `Invoice` document from a checkout request and tier pricing.
 *
 * The base subscription is always one line item; worker/project overages
 * (CLP only) become additional `isOverage: true` lines. USD invoices skip
 * overage lines entirely for now (the Chilean overage model doesn't apply
 * cleanly internationally — see BILLING.md).
 *
 * Status is `'draft'` so the endpoint can transition it to
 * `'pending-payment'` after persisting.
 */
export function buildInvoice(
  request: CheckoutRequest,
  tierData: BuildInvoiceTierData,
  overage: BuildInvoiceOverage,
  options: BuildInvoiceOptions = {},
): Invoice {
  const idGenerator = options.idGenerator ?? defaultIdGenerator;
  const now = options.now ?? (() => new Date());
  const emisorRazonSocial =
    options.emisorRazonSocial ?? PRAEVENTIO_EMISOR_RAZON_SOCIAL_DEFAULT;

  const isCLP = request.currency === 'CLP';
  const isAnnual = request.cycle === 'annual';

  const baseUnit = isCLP
    ? isAnnual
      ? tierData.clpAnual
      : tierData.clpRegular
    : isAnnual
      ? tierData.usdAnual
      : tierData.usdRegular;

  const lineItems: InvoiceLineItem[] = [
    {
      tierId: request.tierId,
      description: `Suscripción ${request.tierId} (${request.cycle})`,
      quantity: 1,
      unitAmount: baseUnit,
      currency: request.currency,
    },
  ];

  // Overage only makes sense in CLP por ahora. Internacional (USD via
  // manual-transfer + MercadoPago regional) asume hard caps — Stripe
  // está descartado oficialmente (§2.12 cierre Fase C.2, 2026-05-21).
  if (isCLP && overage.workers > 0) {
    lineItems.push({
      tierId: request.tierId,
      description: `Trabajadores adicionales (${overage.workers})`,
      quantity: overage.workers,
      unitAmount: overage.clpPerWorker,
      currency: 'CLP',
      isOverage: true,
    });
  }
  if (isCLP && overage.projects > 0) {
    lineItems.push({
      tierId: request.tierId,
      description: `Proyectos adicionales (${overage.projects})`,
      quantity: overage.projects,
      unitAmount: overage.clpPerProject,
      currency: 'CLP',
      isOverage: true,
    });
  }

  const totals = calculateInvoiceTotals(lineItems, isCLP);

  return {
    id: idGenerator(),
    emisorRut: PRAEVENTIO_EMISOR_RUT,
    emisorRazonSocial,
    cliente: request.cliente,
    lineItems,
    totals,
    paymentMethod: request.paymentMethod,
    issuedAt: now().toISOString(),
    status: 'draft',
  };
}

// ---------------------------------------------------------------------------
// Sprint 23 Bucket GG — auto-emit DTE on invoice closure
//
// Pure orchestration helper. Callers (Webpay return handler, MercadoPago
// IPN, manual mark-paid endpoint) invoke this AFTER persisting the invoice
// in `paid` status to fire the SII emission pipeline.
//
// Behavior:
//   • Returns ok=false when DTE_AUTO_ISSUE !== 'true' so callers can opt out
//     per environment without code changes.
//   • Picks `boleta_electronica` for B2C (no client RUT) and
//     `factura_electronica` for B2B (RUT present).
//   • Maps invoice line items to the Bsale DTE shape. USD invoices are
//     skipped — SII DTE is CLP-only by definition.
//   • Catches all exceptions; the route handler should NEVER 500 just because
//     the DTE backend is down. The caller logs failures to a retry queue.
// ---------------------------------------------------------------------------

export interface AutoIssueDteOptions {
  /** Override env flag in tests. */
  autoIssueEnabled?: boolean;
  /** Inject a custom adapter in tests. */
  adapter?: {
    createDte: (input: any) => Promise<DteResult>;
  } | null;
}

export interface AutoIssueDteResult {
  ok: boolean;
  skipped?: 'disabled' | 'usd' | 'no-adapter' | 'invalid-status' | 'not-configured';
  result?: DteResult;
  errorMessage?: string;
}

export async function tryAutoIssueDte(
  invoice: Invoice,
  options: AutoIssueDteOptions = {},
): Promise<AutoIssueDteResult> {
  const enabled =
    options.autoIssueEnabled ??
    (process.env.DTE_AUTO_ISSUE ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    return { ok: false, skipped: 'disabled' };
  }
  if (invoice.status !== 'paid') {
    return { ok: false, skipped: 'invalid-status' };
  }
  if (invoice.totals.currency !== 'CLP') {
    // SII DTEs are CLP-only. International invoices stay outside the SII flow.
    return { ok: false, skipped: 'usd' };
  }

  let adapter = options.adapter;
  if (adapter === undefined) {
    // PRODUCTION FAIL-CLOSED: never emit through the noop / unconfigured PSE.
    // In prod, `SII_PSE` MUST name a real PSE — otherwise the only adapter
    // available is the `noop` fake that reports `accepted` for an UN-emitted
    // DTE (a tax/compliance hazard). Skip honestly instead of pretending the
    // factura was issued; the queue drain records `skipped:not-configured` and
    // the payment flow is untouched. Dev/test keep going to the env-backed
    // Bsale adapter (or `no-adapter` when its creds are unset).
    if (process.env.NODE_ENV === 'production') {
      const pse = (process.env.SII_PSE ?? '').toLowerCase().trim();
      const REAL_PSE_KEYS = new Set(['openfactura', 'simpleapi', 'bsale', 'libredte']);
      if (!REAL_PSE_KEYS.has(pse)) {
        return { ok: false, skipped: 'not-configured' };
      }
    }
    // Lazy-import so the pure invoice math stays dependency-free.
    const { BsaleAdapter } = await import('../sii/bsaleAdapter.js');
    adapter = BsaleAdapter.fromEnv();
  }
  if (!adapter) {
    return { ok: false, skipped: 'no-adapter' };
  }

  const hasRut = Boolean(invoice.cliente.rut && invoice.cliente.rut.trim().length > 0);
  const dteType = hasRut ? 'factura_electronica' : 'boleta_electronica';

  const items = invoice.lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPriceClp: li.unitAmount,
    taxable: true,
  }));

  try {
    const result = await adapter.createDte({
      type: dteType,
      customer: {
        rut: invoice.cliente.rut ?? '66666666-6',
        razonSocial: invoice.cliente.nombre,
        direccion: 'No especificado',
        comuna: 'No especificado',
        ciudad: 'No especificado',
        email: invoice.cliente.email,
      },
      items,
      paymentMethod:
        invoice.paymentMethod === 'webpay'
          ? 'webpay'
          : invoice.paymentMethod === 'manual-transfer'
            ? 'transferencia'
            : 'transferencia',
    });
    return { ok: result.ok, result };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
