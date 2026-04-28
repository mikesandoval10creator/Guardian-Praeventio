// Praeventio Guard — Billing types (Chilean B2B + International)
//
// Scaffolding only. No real Transbank/Stripe SDK is wired up yet — see
// BILLING.md for the integration runbook. These types are the contract
// every adapter / endpoint / Firestore document must conform to.

/**
 * Currency the invoice is denominated in.
 *
 * - `CLP` (Chilean peso) — no minor units, no decimals. Ever. Whole pesos only.
 * - `USD` — represented in major units (whole dollars) for now to mirror our
 *   pricing tiers (`usdRegular`). When we wire real Stripe, convert to cents
 *   at the adapter boundary, NOT in `Invoice` — keep this layer human-readable.
 */
export type CurrencyCode = 'CLP' | 'USD';

/**
 * Supported payment rails.
 *
 * - `webpay` → Transbank Webpay Plus (CLP, Chilean issuers)
 * - `stripe` → International cards (USD)
 * - `manual-transfer` → Transferencia bancaria; admin marks invoice paid
 *   manually via `POST /api/billing/invoice/:id/mark-paid`.
 */
export type PaymentMethod = 'webpay' | 'stripe' | 'manual-transfer';

export interface InvoiceLineItem {
  /** Tier id from `src/services/pricing/tiers.ts`. */
  tierId: string;
  /** Human-readable description rendered on the boleta/factura. */
  description: string;
  /** Number of units. `1` for the base monthly subscription line. */
  quantity: number;
  /**
   * Per-unit amount in the invoice currency.
   * - For CLP: whole pesos (no decimals, no minor units).
   * - For USD: whole dollars in this scaffolding layer; convert to cents in
   *   the Stripe adapter boundary only.
   */
  unitAmount: number;
  currency: CurrencyCode;
  /** True for worker/project overage lines (priced separately from base). */
  isOverage?: boolean;
}

export interface InvoiceTotals {
  subtotal: number;
  /** 19% Chilean VAT. Always 0 for non-CLP invoices. */
  iva: number;
  total: number;
  currency: CurrencyCode;
}

export interface InvoiceCliente {
  nombre: string;
  /** Chilean B2B RUT, e.g. "76.123.456-7". Optional for international. */
  rut?: string;
  email: string;
}

export interface Invoice {
  id: string;
  /**
   * Issuer RUT — Praeventio Guard SpA.
   * Hardcoded as a literal type so a wrong value fails to compile.
   */
  emisorRut: '78231119-0';
  emisorRazonSocial: string;
  cliente: InvoiceCliente;
  lineItems: InvoiceLineItem[];
  totals: InvoiceTotals;
  paymentMethod: PaymentMethod;
  /** ISO 8601 issuance timestamp. */
  issuedAt: string;
  status: 'draft' | 'pending-payment' | 'paid' | 'cancelled' | 'refunded';
}

export interface CheckoutRequest {
  tierId: string;
  cycle: 'monthly' | 'annual';
  currency: CurrencyCode;
  totalWorkers: number;
  totalProjects: number;
  cliente: InvoiceCliente;
  paymentMethod: PaymentMethod;
}

export interface CheckoutResponse {
  invoiceId: string;
  invoice: Invoice;
  /** Redirect URL for hosted checkout (Webpay token URL or Stripe Session URL). */
  paymentUrl?: string;
  status: 'awaiting-payment' | 'pending-config';
}

/**
 * Hardcoded constant for the Praeventio Guard issuer RUT.
 * Use this in `buildInvoice` so the literal type is preserved end-to-end.
 */
export const PRAEVENTIO_EMISOR_RUT = '78231119-0' as const;

/**
 * Default razón social — override via `BILLING_EMISOR_RAZON_SOCIAL` env var
 * once the legal entity name is finalized.
 */
export const PRAEVENTIO_EMISOR_RAZON_SOCIAL_DEFAULT =
  'Praeventio Guard SpA';
