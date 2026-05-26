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
 * 2026-05-16 — La empresa está en Chile; Stripe no la considera para
 *   checkout productivo.
 * 2026-05-21 — §2.12 (Fase C.2) — Stripe descartado oficialmente. Los
 *   archivos `stripeAdapter.ts` + `stripePreflightCheck.ts` se eliminaron.
 *   El literal 'stripe' permanece en `ServerPaymentMethod` SOLO como
 *   tombstone para mantener tipados de tests/fixtures legacy compilando;
 *   `VALID_PAYMENT_METHODS` runtime ya NO lo acepta.
 *
 * Rails ACTIVOS:
 * - `webpay` → Transbank Webpay Plus (CLP, Chilean issuers)
 * - `mercadopago` → MercadoPago Checkout Pro (LATAM regional, endpoint
 *   `/checkout/mp` separado, HMAC SHA-256 IPN verify)
 * - `manual-transfer` → Transferencia bancaria; admin marks invoice paid
 *   manually via `POST /api/billing/invoice/:id/mark-paid`. Es el rail
 *   usado para USD enterprise + LATAM no soportado por MP.
 *
 * Rail DESCARTADO (tombstone solo para compatibilidad de tipos):
 * - `stripe` → eliminado oficialmente Fase C.2 (cierre 2026-05-21, ver
 *   TODO.md §2.12). El literal se mantiene en `ServerPaymentMethod` solo
 *   para que fixtures legacy compilen; `VALID_PAYMENT_METHODS` (runtime)
 *   ya lo rechaza. NO usar en código nuevo.
 */
export type ClientPaymentMethod = 'webpay' | 'mercadopago' | 'manual-transfer';

/**
 * Server-side method type. El literal 'stripe' es un tombstone tipo-only
 * — el runtime lo rechaza (no está en VALID_PAYMENT_METHODS). NO usar
 * en código nuevo.
 */
export type ServerPaymentMethod = ClientPaymentMethod | 'stripe';

/**
 * @deprecated Usar `ClientPaymentMethod` (UI) o `ServerPaymentMethod`
 * (backend) explícitamente. Mantenido como alias del tipo SERVER para
 * no romper código existente.
 */
export type PaymentMethod = ServerPaymentMethod;

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
  /**
   * Lifecycle states. Keep these mutually exclusive — never co-derive from
   * other fields (e.g., don't infer 'paid' from a non-null `paidAt`).
   *
   * - `draft`           → built but not persisted as awaiting payment yet.
   * - `pending-payment` → persisted; awaiting Webpay/Stripe/manual capture.
   *                       The `/billing/webpay/return` endpoint also keeps
   *                       this status on a transient FAILED so the user can
   *                       retry the same card.
   * - `paid`            → captured. Terminal until refund.
   * - `cancelled`       → reserved for explicit user/admin cancellation
   *                       (admin-only mark via the mark-paid path, future
   *                       PR). Do NOT use for card declines.
   * - `rejected`        → a payment attempt failed (card declined, etc.)
   *                       but the invoice is still actionable — user may
   *                       retry with a different card. Distinct from
   *                       `cancelled`: rejection ≠ cancellation.
   * - `refunded`        → previously paid, then refunded via the adapter.
   */
  status:
    | 'draft'
    | 'pending-payment'
    | 'paid'
    | 'cancelled'
    | 'rejected'
    | 'refunded';
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
