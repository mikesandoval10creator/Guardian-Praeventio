// Praeventio Guard — Stripe adapter (TYPED STUB).
//
// Mirrors `webpayAdapter.ts` for the international USD path. No real
// `stripe` npm package is wired up yet — see BILLING.md for the integration
// runbook. The repo today only verifies Google Play purchases via the
// existing `/api/billing/verify` endpoint; Stripe is the international
// card path we have not built yet.

export interface StripeConfig {
  /** Read from `STRIPE_SECRET_KEY`. Server-side only — never ship to client. */
  secretKey: string;
  /** Read from `STRIPE_WEBHOOK_SECRET`. Used to verify webhook signatures. */
  webhookSecret: string;
  /** API version pin — bump deliberately, never auto. */
  apiVersion: string;
}

export interface StripeCheckoutSessionInput {
  /** Invoice id, propagated end-to-end as `client_reference_id`. */
  invoiceId: string;
  /**
   * Pre-created Stripe Price IDs, keyed by tier id.
   * Construct in Stripe Dashboard or via API; do NOT hardcode amounts here —
   * Stripe is the source of truth for the actual charge.
   */
  priceId: string;
  quantity: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Pass-through metadata persisted on the Stripe Session. */
  metadata?: Record<string, string>;
}

export interface StripeCheckoutSessionResult {
  sessionId: string;
  /** Hosted checkout URL — redirect the user here. */
  url: string;
}

export type StripePaymentStatus = 'paid' | 'unpaid' | 'no_payment_required';

export interface StripeWebhookEvent {
  type: string;
  /** Verified payload from `stripe.webhooks.constructEvent`. */
  data: { object: unknown };
}

export interface StripeAdapter {
  init(config: StripeConfig): void;
  isConfigured(): boolean;
  createCheckoutSession(
    input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionResult>;
  retrieveSessionStatus(sessionId: string): Promise<StripePaymentStatus>;
  /** Verify a webhook signature header. Throws on mismatch. */
  verifyWebhookSignature(rawBody: string, signature: string): StripeWebhookEvent;
}

export class StripeNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `StripeAdapter.${method}() not implemented yet. ` +
        `Install stripe sdk + configure STRIPE_SECRET_KEY per BILLING.md.`,
    );
    this.name = 'StripeNotImplementedError';
  }
}

export const stripeAdapter: StripeAdapter = {
  init(_config: StripeConfig): void {
    throw new StripeNotImplementedError('init');
  },
  isConfigured(): boolean {
    return false;
  },
  async createCheckoutSession(
    _input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionResult> {
    throw new StripeNotImplementedError('createCheckoutSession');
  },
  async retrieveSessionStatus(_sessionId: string): Promise<StripePaymentStatus> {
    throw new StripeNotImplementedError('retrieveSessionStatus');
  },
  verifyWebhookSignature(
    _rawBody: string,
    _signature: string,
  ): StripeWebhookEvent {
    throw new StripeNotImplementedError('verifyWebhookSignature');
  },
};
