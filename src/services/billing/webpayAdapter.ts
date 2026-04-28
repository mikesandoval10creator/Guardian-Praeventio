// Praeventio Guard — Webpay/Transbank adapter (TYPED STUB).
//
// IMPORTANT: This file deliberately does NOT depend on the real Transbank
// SDK (`transbank-sdk`). Installing the SDK + provisioning a commerce code +
// uploading certificates is a separate operational task — see BILLING.md.
//
// Until then, every method on `webpayAdapter` throws `WebpayNotImplementedError`
// so a developer who wires this in by accident gets a loud, descriptive
// failure rather than silent success. The HTTP endpoint in `server.ts`
// catches this and responds with `status: 'pending-config'`.

export interface WebpayConfig {
  /** Transbank-issued commerce code. Read from `WEBPAY_COMMERCE_CODE`. */
  commerceCode: string;
  /** Transbank API key. Read from `WEBPAY_API_KEY`. */
  apiKey: string;
  environment: 'integration' | 'production';
}

export interface WebpayTransaction {
  /** Invoice id (used as Transbank `buy_order`, max 26 chars). */
  buyOrder: string;
  /** Per-user session id from our auth layer. */
  sessionId: string;
  /** CLP amount, no decimals. Validated against Transbank min/max. */
  amount: number;
  /** Where Transbank sends the user after the payment flow. */
  returnUrl: string;
}

export interface WebpayCreateResult {
  token: string;
  /** URL to which we redirect the user (token is appended as form field). */
  url: string;
}

export type WebpayCommitStatus = 'AUTHORIZED' | 'REJECTED' | 'FAILED';

export interface WebpayCommitResult {
  status: WebpayCommitStatus;
  /** Transbank authorization code when AUTHORIZED. */
  authorizationCode?: string;
  /** Original buy_order echoed back. */
  buyOrder: string;
  amount: number;
  /** Last 4 digits of card. Never log full PAN. */
  cardLast4?: string;
  /** Raw transbank response for audit; never expose to the client. */
  raw?: unknown;
}

export interface WebpayRefundResult {
  type: 'REVERSED' | 'NULLIFIED';
  authorizationCode?: string;
  authorizedAmount: number;
  raw?: unknown;
}

/**
 * Adapter contract. Real implementation will live in
 * `webpayAdapter.transbank.ts` once the SDK is added.
 */
export interface WebpayAdapter {
  init(config: WebpayConfig): void;
  isConfigured(): boolean;
  createTransaction(tx: WebpayTransaction): Promise<WebpayCreateResult>;
  commitTransaction(token: string): Promise<WebpayCommitResult>;
  refundTransaction(token: string, amount: number): Promise<WebpayRefundResult>;
}

export class WebpayNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `WebpayAdapter.${method}() not implemented yet. ` +
        `Wire transbank-sdk per BILLING.md before calling.`,
    );
    this.name = 'WebpayNotImplementedError';
  }
}

/**
 * Stub implementation. Throws on every method except `isConfigured()`
 * (which returns false so callers can branch gracefully).
 */
export const webpayAdapter: WebpayAdapter = {
  init(_config: WebpayConfig): void {
    throw new WebpayNotImplementedError('init');
  },
  isConfigured(): boolean {
    return false;
  },
  async createTransaction(_tx: WebpayTransaction): Promise<WebpayCreateResult> {
    throw new WebpayNotImplementedError('createTransaction');
  },
  async commitTransaction(_token: string): Promise<WebpayCommitResult> {
    throw new WebpayNotImplementedError('commitTransaction');
  },
  async refundTransaction(
    _token: string,
    _amount: number,
  ): Promise<WebpayRefundResult> {
    throw new WebpayNotImplementedError('refundTransaction');
  },
};
