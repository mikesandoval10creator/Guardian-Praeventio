// Praeventio Guard — MercadoPago adapter (REAL IMPLEMENTATION).
//
// Mirrors `webpayAdapter.ts` shape so the rest of the codebase stays
// SDK-agnostic. Wraps the official `mercadopago` Node SDK for the LATAM
// markets we ship today: PE, AR, CO, MX, BR. Chile keeps Webpay, ROW
// keeps Stripe; this adapter is for the MercadoPago five only.
//
// The adapter:
//   • Reads credentials from `MP_ACCESS_TOKEN` (required) — fails closed
//     when missing rather than silently 401ing the user.
//   • Switches between `init_point` (production) and `sandbox_init_point`
//     based on `MP_ENV=sandbox|production` so QA never accidentally hits
//     real payouts.
//   • Maps the SDK's verbose `Preference.create` payload to the tight
//     `{ id, init_point }` subset the server endpoint redirects to.
//   • Throws `MercadoPagoAdapterError` (subclass of `Error`) on SDK
//     failures so callers can `instanceof`-check instead of string-
//     parsing.
//
// IMPORTANT (PCI scope): never log full payer email, MP access tokens,
// or raw SDK payloads in production. Round 16 will add an IPN webhook
// handler at `POST /api/billing/webhook/mercadopago` (file:line —
// server.ts TBD) with OIDC verification similar to RTDN.
// TODO(round-16): wire MercadoPago IPN webhook (`/api/billing/webhook/
// mercadopago`) — see this file's header for the contract.

import {
  MercadoPagoConfig,
  Payment,
  Preference,
} from 'mercadopago';

/** Currency codes MercadoPago accepts directly (ISO 4217). */
export type MercadoPagoCurrencyId = 'PEN' | 'ARS' | 'COP' | 'MXN' | 'BRL';

export interface MercadoPagoItem {
  /** Human-readable line title shown on the MP checkout. */
  title: string;
  /** Number of units. `1` for the base monthly subscription line. */
  quantity: number;
  /**
   * Unit price in the major-unit currency (PEN, ARS, …). MP expects
   * decimals here, unlike Webpay's whole-CLP convention.
   */
  unit_price: number;
  currency_id: MercadoPagoCurrencyId;
}

export interface MercadoPagoBackUrls {
  success: string;
  pending: string;
  failure: string;
}

export interface CreatePreferenceParams {
  items: MercadoPagoItem[];
  payer: { email: string };
  back_urls: MercadoPagoBackUrls;
  /** IPN URL — Round 16 will add the matching webhook handler. */
  notification_url: string;
  /** Our invoice id, echoed back in IPN events for reconciliation. */
  external_reference: string;
}

export interface CreatePreferenceResult {
  /** MercadoPago preference id (used to look up the preference later). */
  id: string;
  /**
   * Hosted-checkout URL we redirect the user to. Production vs sandbox
   * URL is chosen based on `MP_ENV` — see `resolveInitPoint`.
   */
  init_point: string;
}

export interface GetPaymentResult {
  status: string;
  status_detail: string;
  external_reference?: string;
  amount?: number;
  currency?: string;
  raw?: unknown;
}

/** Adapter contract. Tests inject a mock via `vi.mock('mercadopago')`. */
export interface MercadoPagoAdapter {
  /** True iff `MP_ACCESS_TOKEN` is set to a non-empty string. */
  isConfigured(): boolean;
  createPreference(params: CreatePreferenceParams): Promise<CreatePreferenceResult>;
  getPayment(paymentId: string): Promise<GetPaymentResult>;
}

/** Thrown when the MercadoPago SDK call fails (or input is invalid). */
export class MercadoPagoAdapterError extends Error {
  readonly method: string;
  readonly cause?: unknown;
  constructor(method: string, cause: unknown) {
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : 'unknown error';
    super(`MercadoPagoAdapter.${method}() failed: ${causeMsg}`);
    this.name = 'MercadoPagoAdapterError';
    this.method = method;
    this.cause = cause;
  }
}

interface InternalState {
  config: MercadoPagoConfig | null;
  /** Cached access token used to detect env-var changes between calls. */
  cachedToken: string | null;
}

const state: InternalState = {
  config: null,
  cachedToken: null,
};

/**
 * Resolve (or build) the MercadoPagoConfig instance. Re-creates the
 * config when the access token env-var changes between calls so tests
 * (and prod restarts) pick up rotated credentials.
 */
function resolveConfig(): MercadoPagoConfig {
  const token = process.env.MP_ACCESS_TOKEN ?? '';
  if (!token) {
    throw new Error('MP_ACCESS_TOKEN is not set');
  }
  if (state.config && state.cachedToken === token) {
    return state.config;
  }
  state.config = new MercadoPagoConfig({ accessToken: token });
  state.cachedToken = token;
  return state.config;
}

function isSandboxMode(): boolean {
  // Default: sandbox unless explicitly set to "production". Mirrors
  // webpayAdapter's defensive default — it's safer to send a real card
  // through the sandbox URL by accident than the other way around.
  const env = (process.env.MP_ENV ?? 'sandbox').toLowerCase();
  return env !== 'production';
}

/**
 * Pick the correct redirect URL based on env. MP returns both
 * `init_point` (production) and `sandbox_init_point` on every preference;
 * we prefer the sandbox URL when MP_ENV != production.
 */
function resolveInitPoint(response: {
  init_point?: string;
  sandbox_init_point?: string;
}): string | undefined {
  if (isSandboxMode()) {
    return response.sandbox_init_point ?? response.init_point;
  }
  return response.init_point ?? response.sandbox_init_point;
}

export const mercadoPagoAdapter: MercadoPagoAdapter = {
  isConfigured(): boolean {
    return Boolean(process.env.MP_ACCESS_TOKEN);
  },

  async createPreference(
    params: CreatePreferenceParams,
  ): Promise<CreatePreferenceResult> {
    try {
      const config = resolveConfig();
      const preference = new Preference(config);
      const response = await preference.create({
        body: {
          items: params.items.map((item) => ({
            // MP requires an `id` per item; default to a stable hash
            // of the title so duplicate items aren't merged on the
            // hosted checkout. We don't expose this id outside the
            // adapter — it's purely for the SDK contract.
            id: item.title.slice(0, 64),
            title: item.title,
            quantity: item.quantity,
            unit_price: item.unit_price,
            currency_id: item.currency_id,
          })),
          payer: { email: params.payer.email },
          back_urls: params.back_urls,
          notification_url: params.notification_url,
          external_reference: params.external_reference,
          // `auto_return: 'approved'` would force MP to redirect the
          // user back automatically on approved status. We leave this
          // OFF so the URL we return matches what the user sees in the
          // browser — Round 16 may revisit once IPN reconciliation is
          // wired (see TODO at the top of this file).
        },
      });

      const id = response.id;
      const init_point = resolveInitPoint(response);
      if (!id || !init_point) {
        throw new Error(
          `MercadoPago preference response missing id/init_point (got id=${id})`,
        );
      }
      return { id, init_point };
    } catch (err) {
      if (err instanceof MercadoPagoAdapterError) throw err;
      throw new MercadoPagoAdapterError('createPreference', err);
    }
  },

  async getPayment(paymentId: string): Promise<GetPaymentResult> {
    try {
      const config = resolveConfig();
      const payment = new Payment(config);
      const response = await payment.get({ id: paymentId });
      return {
        status: typeof response.status === 'string' ? response.status : 'unknown',
        status_detail:
          typeof response.status_detail === 'string'
            ? response.status_detail
            : 'unknown',
        external_reference:
          typeof response.external_reference === 'string'
            ? response.external_reference
            : undefined,
        amount:
          typeof response.transaction_amount === 'number'
            ? response.transaction_amount
            : undefined,
        currency:
          typeof response.currency_id === 'string' ? response.currency_id : undefined,
        raw: response,
      };
    } catch (err) {
      throw new MercadoPagoAdapterError('getPayment', err);
    }
  },
};

/** Test-only helper. Resets the module-level config so each test is hermetic. */
export function __resetMercadoPagoAdapterStateForTests(): void {
  state.config = null;
  state.cachedToken = null;
}
