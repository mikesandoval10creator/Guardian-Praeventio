// Praeventio Guard — Webpay/Transbank adapter (REAL IMPLEMENTATION).
//
// This module wraps the official `transbank-sdk` (`WebpayPlus.Transaction`)
// behind our internal `WebpayAdapter` contract so the rest of the codebase
// stays SDK-agnostic. The adapter:
//
//   • Defaults to Transbank's "Tienda de Integración" sandbox credentials
//     (so dev/CI never hits production by accident).
//   • Switches to env-supplied production credentials when
//     `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` are set, with optional
//     `WEBPAY_ENV='production'` to flip the environment URL.
//   • Maps Transbank's verbose `commit()` payload to a tight subset
//     (`status`, `buyOrder`, `amount`, `authorizationCode`, `cardLast4`)
//     and stashes the raw response on `raw` for the audit log.
//   • Throws `WebpayAdapterError` (subclass of `Error`) on SDK failures so
//     callers can `instanceof`-check rather than relying on string parsing.
//
// See BILLING.md → "Webpay setup" for env wiring + test card numbers.
//
// IMPORTANT (PCI scope): never log card PAN, CVV, or full Transbank
// payloads in production. The `raw` field on `WebpayCommitResult` is for
// server-side audit trails only — never serialize it back to the browser.

import {
  Environment,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Options,
  WebpayPlus,
} from 'transbank-sdk';

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
  /** Remaining balance after the refund (Transbank `balance` field). */
  balance?: number;
  raw?: unknown;
}

/**
 * Adapter contract. The runtime export below is the real implementation
 * backed by `transbank-sdk`. Tests inject a mock via `vi.mock(...)`.
 */
export interface WebpayAdapter {
  init(config: WebpayConfig): void;
  isConfigured(): boolean;
  createTransaction(tx: WebpayTransaction): Promise<WebpayCreateResult>;
  commitTransaction(token: string): Promise<WebpayCommitResult>;
  refundTransaction(token: string, amount: number): Promise<WebpayRefundResult>;
}

/**
 * Kept for backward compatibility with any callers that still
 * `instanceof`-check the old stub error. New code should use
 * `WebpayAdapterError` for real SDK failures.
 */
export class WebpayNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `WebpayAdapter.${method}() not implemented yet. ` +
        `Wire transbank-sdk per BILLING.md before calling.`,
    );
    this.name = 'WebpayNotImplementedError';
  }
}

/** Thrown when the underlying Transbank SDK call fails. Wraps the cause. */
export class WebpayAdapterError extends Error {
  readonly method: string;
  readonly cause?: unknown;
  constructor(method: string, cause: unknown) {
    const causeMsg =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
    super(`WebpayAdapter.${method}() failed: ${causeMsg}`);
    this.name = 'WebpayAdapterError';
    this.method = method;
    this.cause = cause;
  }
}

/** Holds adapter-level configuration once `init()` has been called. */
interface InternalState {
  options: Options | null;
  configured: boolean;
}

function buildIntegrationOptions(): Options {
  return new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration,
  );
}

function buildOptionsFromConfig(config: WebpayConfig): Options {
  const env =
    config.environment === 'production'
      ? Environment.Production
      : Environment.Integration;
  return new Options(config.commerceCode, config.apiKey, env);
}

function readEnvOptions(): Options | null {
  const code = process.env.WEBPAY_COMMERCE_CODE;
  const key = process.env.WEBPAY_API_KEY;
  if (!code || !key) return null;
  const env =
    process.env.WEBPAY_ENV === 'production' ||
    process.env.WEBPAY_ENVIRONMENT === 'production'
      ? Environment.Production
      : Environment.Integration;
  return new Options(code, key, env);
}

/**
 * Map Transbank's verbose commit response to our compact `WebpayCommitResult`.
 * Authorization rule: `response_code === 0 && status === 'AUTHORIZED'`.
 * Anything else (including transient SDK shapes) maps to `'REJECTED'` so
 * callers fail closed.
 */
function mapCommitResponse(response: any): WebpayCommitResult {
  const isAuthorized =
    response?.response_code === 0 && response?.status === 'AUTHORIZED';
  const status: WebpayCommitStatus = isAuthorized ? 'AUTHORIZED' : 'REJECTED';
  return {
    status,
    authorizationCode: response?.authorization_code ?? undefined,
    buyOrder: response?.buy_order ?? '',
    amount: typeof response?.amount === 'number' ? response.amount : 0,
    cardLast4:
      typeof response?.card_detail?.card_number === 'string'
        ? response.card_detail.card_number.slice(-4)
        : undefined,
    raw: response,
  };
}

function mapRefundResponse(response: any, requestedAmount: number): WebpayRefundResult {
  const rawType = (response?.type ?? '').toString().toUpperCase();
  const type: WebpayRefundResult['type'] =
    rawType === 'REVERSED' ? 'REVERSED' : 'NULLIFIED';
  return {
    type,
    authorizationCode: response?.authorization_code ?? undefined,
    authorizedAmount:
      typeof response?.nullified_amount === 'number'
        ? response.nullified_amount
        : requestedAmount,
    balance: typeof response?.balance === 'number' ? response.balance : undefined,
    raw: response,
  };
}

const state: InternalState = {
  options: null,
  configured: false,
};

function resolveOptions(): Options {
  // Priority: explicit init() > env vars > sandbox defaults.
  if (state.options) return state.options;
  const fromEnv = readEnvOptions();
  if (fromEnv) return fromEnv;
  return buildIntegrationOptions();
}

/**
 * Real Transbank-backed adapter. Same shape as the previous stub so
 * existing imports in `server.ts` continue to compile.
 */
export const webpayAdapter: WebpayAdapter = {
  init(config: WebpayConfig): void {
    state.options = buildOptionsFromConfig(config);
    state.configured = Boolean(config.commerceCode && config.apiKey);
  },
  isConfigured(): boolean {
    if (state.configured) return true;
    return Boolean(
      process.env.WEBPAY_COMMERCE_CODE && process.env.WEBPAY_API_KEY,
    );
  },
  async createTransaction(tx: WebpayTransaction): Promise<WebpayCreateResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.create(
        tx.buyOrder,
        tx.sessionId,
        tx.amount,
        tx.returnUrl,
      );
      return { token: response.token, url: response.url };
    } catch (err) {
      throw new WebpayAdapterError('createTransaction', err);
    }
  },
  async commitTransaction(token: string): Promise<WebpayCommitResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.commit(token);
      return mapCommitResponse(response);
    } catch (err) {
      throw new WebpayAdapterError('commitTransaction', err);
    }
  },
  async refundTransaction(token: string, amount: number): Promise<WebpayRefundResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.refund(token, amount);
      return mapRefundResponse(response, amount);
    } catch (err) {
      throw new WebpayAdapterError('refundTransaction', err);
    }
  },
};

/** Test-only helper. Resets the module-level config so each test is hermetic. */
export function __resetWebpayAdapterStateForTests(): void {
  state.options = null;
  state.configured = false;
}
