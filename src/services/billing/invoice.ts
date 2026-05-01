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
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  // Overage only makes sense in CLP for now. International Stripe path
  // assumes hard caps until we model metered billing in Stripe.
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
