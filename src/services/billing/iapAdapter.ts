// Praeventio Guard — Unified In-App-Purchase adapter.
//
// Sprint 21 Ola 6 Bucket T. Web shipped first (Webpay/MercadoPago/Khipu
// adapters live in this folder), but Apple App Store and Google Play
// Store policies REQUIRE digital subscriptions in mobile apps to flow
// through their own IAP rails — passing card data to Webpay/MP/Khipu
// from a native binary is a takedown-grade compliance violation.
//
// This adapter unifies the platform-detection + provider-selection
// surface so the rest of the codebase (Pricing.tsx, server billing
// routes, analytics) does not have to fan out to three different
// adapter shapes per call site. The web flows are unchanged — this
// module just routes to the right existing adapter when running in a
// browser, and to the Capacitor IAP plugin when running on Android/iOS.
//
// SECURITY (boundaries — see header note in webpayAdapter.ts):
//   - The receipt returned by the Capacitor plugin is CLIENT-SIDE.
//     Never grant subscription benefit on the strength of the receipt
//     alone. Server-to-server validation against Google Play Developer
//     API / App Store Server API + the RTDN/SSN webhook is the only
//     authoritative grant. See `docs/billing-iap.md`.
//   - Web browsers cannot purchase via the store rails. We refuse those
//     calls early rather than fall through to Webpay silently.
//
// ARCHITECTURE — provider selection by platform:
//
//     Platform  | Available providers                 | Default order
//     ----------+-------------------------------------+--------------
//     web       | webpay, mercadopago, khipu          | (caller picks)
//     android   | google-play                         | google-play
//     ios       | app-store                           | app-store
//
// We deliberately do NOT expose Webpay/MP/Khipu on android/ios — store
// policy explicitly forbids alternate digital-subscription rails inside
// the app binary. (Physical-good or service-booking flows can use cards;
// Praeventio's tier subscription is digital, so the policy applies.)

import { Capacitor } from '@capacitor/core';
import { ALL_IAP_SKUS } from '../pricing/iapSkus';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type BillingPlatform = 'web' | 'android' | 'ios';
export type BillingProvider =
  | 'webpay'
  | 'mercadopago'
  | 'khipu'
  | 'google-play'
  | 'app-store';

export interface IapProduct {
  /** SKU id, must match the product configured in Play Console / App Store
   * Connect. e.g. `praeventio_premium_monthly`. */
  id: string;
  title: string;
  /** CLP base price in whole-CLP units (Webpay convention). Web catalogue
   * only — native products carry the store's own currency/price and must
   * NEVER be re-labeled as CLP (a guessed price is a lie to the user). */
  priceClp?: number;
  /** Localized formatted display, e.g. "$ 9.990 CLP". On native, the
   * store returns its own localized string (e.g. "USD $9.99") — we
   * pass that through verbatim. */
  priceFormatted: string;
  type: 'subscription' | 'one-time';
  /** Subscription period length in days. Omitted for one-time. */
  durationDays?: number;
  /** Play base plan id, e.g. 'monthly'. Native (Play) only. */
  basePlanId?: string;
  /** Play offer token for the selected base plan/offer. Native (Play)
   * only — purchasing requires an exact (basePlanId, offerToken) pair. */
  offerToken?: string;
  /** ISO 4217 store currency, e.g. 'USD', 'CLP'. Native only. */
  currency?: string;
  /** Store price in `currency` units. Native only. */
  price?: number;
}

/** Explicit storefront selection for a purchase. Play requires the exact
 * base plan + offer token; we refuse to "pick the first offer" for the
 * user (that can silently charge a different price/commitment). */
export interface IapSelection {
  basePlanId?: string;
  offerToken?: string;
  /** App-account token (authenticated uid) — scopes the receipt to the
   * signed-in account so restores never leak another account's receipt. */
  accountId?: string;
}

export interface IapPurchaseResult {
  success: boolean;
  provider: BillingProvider;
  productId?: string;
  /** Receipt id / orderId / purchaseToken — opaque to the caller. The
   * server validates this against the store API. On Play this is always
   * the purchaseToken (transactionId/order ids are NOT receipt identity). */
  receiptId?: string;
  errorMessage?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Web catalogue — single source of truth for prices when the device has
// no store available. Native devices override priceFormatted with the
// store's own localized string (App Store and Play return the
// territory-correct CLP/USD/MXN/etc string).
// ───────────────────────────────────────────────────────────────────────────
const WEB_CATALOG: ReadonlyArray<IapProduct> = [
  {
    id: 'praeventio_premium_monthly',
    title: 'Praeventio Premium · Mensual',
    priceClp: 9990,
    priceFormatted: '$ 9.990 CLP',
    type: 'subscription',
    durationDays: 30,
  },
  {
    id: 'praeventio_premium_annual',
    title: 'Praeventio Premium · Anual',
    priceClp: 95904, // ~20% off vs 12×9990
    priceFormatted: '$ 95.904 CLP',
    type: 'subscription',
    durationDays: 365,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Capacitor plugin contract — kept narrow on purpose. We do NOT depend
// on the npm package being present at runtime; we dynamic-import it
// behind `Capacitor.isPluginAvailable('CapacitorInAppPurchases')` so:
//   • web bundles don't pull native-only TypeScript types,
//   • tests can mock the import without the plugin in node_modules,
//   • a missing-plugin install fails gracefully with a clear error
//     instead of a webpack/vite resolution explosion.
// ───────────────────────────────────────────────────────────────────────────
interface PlayStoreProduct {
  /** Base plan id, e.g. 'monthly'. */
  identifier: string;
  /** Full SKU, e.g. 'praeventio_cobre_monthly'. */
  planIdentifier: string;
  offerToken: string;
  offerId?: string | null;
  title?: string;
  price?: number;
  priceString?: string;
  currencyCode?: string;
}

interface PlayStorePurchase {
  productIdentifier: string;
  /** THE receipt identity on Play. transactionId/orderId are NOT. */
  purchaseToken?: string;
  transactionId?: string;
  appAccountToken?: string;
}

interface CapacitorIapPlugin {
  getProducts(opts: {
    productIdentifiers: string[];
    productType: 'subs' | 'inapp';
  }): Promise<{ products: PlayStoreProduct[] }>;
  purchaseProduct(opts: {
    productIdentifier: string;
    planIdentifier: string;
    offerToken: string;
    appAccountToken?: string;
    /** Must be false: Play acknowledgement is the server's durable
     * post-grant worker's job (billing task 3), never the client's. */
    autoAcknowledgePurchases: boolean;
    productType: 'subs' | 'inapp';
  }): Promise<PlayStorePurchase>;
  getPurchases(opts: {
    productType: 'subs' | 'inapp';
    appAccountToken?: string;
    onlyCurrentEntitlements?: boolean;
  }): Promise<{ purchases: PlayStorePurchase[] }>;
}

/** Optional injection point for tests. When set, used in lieu of the real
 * dynamic import. */
let injectedPlugin: CapacitorIapPlugin | null = null;

/** Test-only: inject a mock plugin without touching the real one. */
export function __setCapacitorIapPluginForTests(
  plugin: CapacitorIapPlugin | null,
): void {
  injectedPlugin = plugin;
}

async function loadCapacitorIapPlugin(): Promise<CapacitorIapPlugin> {
  if (injectedPlugin) return injectedPlugin;
  // Dynamic import keeps web bundles slim and avoids hard-failing when
  // `@capacitor-community/in-app-purchases` is absent during web dev.
  // Vite/Rollup tree-shake this branch in browser builds because
  // `Capacitor.getPlatform()` returns 'web' there.
  // Dynamically resolved on native platforms only. The package is listed
  // in package.json but type declarations may be absent in web-only
  // checkouts; tests inject a mock via __setCapacitorIapPluginForTests so
  // this branch never runs in CI. We assemble the specifier from a
  // variable to keep the TS module resolver from hard-failing the build
  // when the package is not installed.
  const pkgName = '@capacitor-community/in-app-purchases';
  const mod: any = await import(
    /* @vite-ignore */
    /* webpackIgnore: true */
    pkgName
  ).catch((err: unknown) => {
    throw new IapAdapterError(
      'loadCapacitorIapPlugin',
      `@capacitor-community/in-app-purchases is not installed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
  const plugin =
    mod?.CapacitorInAppPurchases ??
    mod?.InAppPurchases ??
    mod?.default ??
    mod;
  if (!plugin || typeof plugin.purchaseProduct !== 'function') {
    throw new IapAdapterError(
      'loadCapacitorIapPlugin',
      'Capacitor IAP plugin loaded but missing expected Play Billing v8 surface (purchaseProduct/getProducts/getPurchases)',
    );
  }
  return plugin as CapacitorIapPlugin;
}

// ───────────────────────────────────────────────────────────────────────────
// Errors
// ───────────────────────────────────────────────────────────────────────────

export class IapAdapterError extends Error {
  readonly method: string;
  override readonly cause?: unknown;
  constructor(method: string, cause: unknown) {
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
        ? cause
        : 'unknown error';
    super(`IapAdapter.${method}() failed: ${causeMsg}`);
    this.name = 'IapAdapterError';
    this.method = method;
    this.cause = cause;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────────

export class IapAdapter {
  /** Detect the runtime platform via Capacitor. Falls back to 'web' when
   * Capacitor is not initialised (e.g., SSR / unit-test default). */
  static getPlatform(): BillingPlatform {
    try {
      const platform = Capacitor.getPlatform();
      if (platform === 'android') return 'android';
      if (platform === 'ios') return 'ios';
      return 'web';
    } catch {
      return 'web';
    }
  }

  /** Providers available on the current platform. Order matters: index 0
   * is the default when `purchase()` is called without an explicit
   * provider. */
  static getAvailableProviders(): BillingProvider[] {
    const platform = IapAdapter.getPlatform();
    if (platform === 'android') return ['google-play'];
    if (platform === 'ios') return ['app-store'];
    return ['webpay', 'mercadopago', 'khipu'];
  }

  /** True when the current platform's purchase rail can run a real
   * transaction. (Web is true even without server creds — we surface
   * the "pending-config" error from the server instead.) */
  static isAvailable(): boolean {
    return IapAdapter.getAvailableProviders().length > 0;
  }

  // ─────────────────────────────────────────────────────────────────────
  // listProducts — platform-aware catalogue.
  //
  // Web: returns WEB_CATALOG verbatim (CLP base prices). The Pricing page
  // already shows full tier breakdown via `services/pricing/tiers.ts`;
  // this catalogue is for callers that want the IAP-shaped product list.
  //
  // Android/iOS: queries the store via the Capacitor plugin (Play Billing
  // v8 ProductDetails) so prices are localized to the user's territory
  // and base plans + offer tokens are real. An unavailable product is
  // simply absent: we NEVER fall back to the web CLP catalogue on native
  // (a guessed CLP price on a store that bills in USD is a lie, and the
  // silent fallback used to be exactly that).
  // ─────────────────────────────────────────────────────────────────────
  async listProducts(): Promise<IapProduct[]> {
    const platform = IapAdapter.getPlatform();
    if (platform === 'web') {
      return WEB_CATALOG.slice();
    }

    try {
      const plugin = await loadCapacitorIapPlugin();
      const response = await plugin.getProducts({
        productIdentifiers: Object.keys(ALL_IAP_SKUS),
        productType: 'subs',
      });
      return (response.products ?? []).map((p) => {
        const sku = p.planIdentifier;
        const entry = ALL_IAP_SKUS[sku];
        return {
          id: sku,
          title: p.title ?? sku,
          priceFormatted: p.priceString ?? '',
          type: 'subscription' as const,
          ...(entry?.cycle === 'annual' ? { durationDays: 365 } : {}),
          ...(entry?.cycle === 'monthly' ? { durationDays: 30 } : {}),
          basePlanId: p.identifier,
          offerToken: p.offerToken,
          currency: p.currencyCode,
          price: p.price,
        };
      });
    } catch (err) {
      if (err instanceof IapAdapterError) throw err;
      throw new IapAdapterError('listProducts', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // purchase — single entry point.
  //
  // Web (no provider arg): refuses — the caller must pick (Webpay, MP,
  //   Khipu have very different UX on the Pricing page). On web we expect
  //   the existing Pricing.tsx flow to call its own checkout endpoints
  //   directly; this method is here mostly for contract completeness.
  // Web (provider arg): the caller is invoked at the same `/api/billing/*`
  //   endpoints they'd hit anyway — we just return success/false based on
  //   whether the redirect was prepared. Actual redirect is the caller's
  //   responsibility (we cannot redirect from a service module without
  //   coupling it to react-router / window).
  // Android: calls the Capacitor plugin → returns purchaseToken so the
  //   server can verify against Google Play Developer API.
  // iOS: same shape, returns the receipt blob.
  //
  // CRITICAL: never grant benefit here. Granting is the
  // RTDN/SSN/IPN webhook handler's job (server-side, with store-side
  // signature verification).
  // ─────────────────────────────────────────────────────────────────────
  async purchase(
    productId: string,
    provider?: BillingProvider,
    selection?: IapSelection,
  ): Promise<IapPurchaseResult> {
    const platform = IapAdapter.getPlatform();
    const available = IapAdapter.getAvailableProviders();
    const chosen = provider ?? available[0];

    if (!available.includes(chosen)) {
      return {
        success: false,
        provider: chosen,
        errorMessage: `Provider '${chosen}' is not available on platform '${platform}'`,
      };
    }

    if (platform === 'android') {
      return this.purchaseViaStore(productId, 'google-play', selection);
    }
    if (platform === 'ios') {
      return this.purchaseViaStore(productId, 'app-store', selection);
    }

    // Web: we don't do the redirect here. Pricing.tsx already orchestrates
    // Webpay/MP/Khipu via fetch + window.location.href. We return a
    // shape so callers can branch, and surface a clear errorMessage if
    // they accidentally try to use the unified API on the web.
    return {
      success: false,
      provider: chosen,
      errorMessage:
        'Web purchases are handled by the Pricing checkout flow ' +
        `(${chosen}) — call it directly via /api/billing/checkout.`,
    };
  }

  private async purchaseViaStore(
    productId: string,
    provider: 'google-play' | 'app-store',
    selection?: IapSelection,
  ): Promise<IapPurchaseResult> {
    // Fail closed: Play must receive the EXACT base plan + offer the user
    // selected. Picking "the first offer" can charge a different price or
    // commitment than the one shown on screen.
    if (!selection?.basePlanId || !selection?.offerToken) {
      return {
        success: false,
        provider,
        productId,
        errorMessage:
          'Store purchase requires an explicit basePlanId and offerToken ' +
          '(select the product from listProducts() first) — refusing to guess an offer',
      };
    }
    try {
      const plugin = await loadCapacitorIapPlugin();
      // Validate the selection against the live store catalogue: a stale
      // UI selection (revoked offer, renamed base plan) must not reach
      // the billing flow.
      const catalog = await this.listProducts();
      const selected = catalog.find(
        (p) =>
          p.id === productId &&
          p.basePlanId === selection.basePlanId &&
          p.offerToken === selection.offerToken,
      );
      if (!selected) {
        return {
          success: false,
          provider,
          productId,
          errorMessage:
            'Offer not available in the store catalogue — it may have ' +
            'been revoked or renamed; refresh the product list',
        };
      }
      const result = await plugin.purchaseProduct({
        productIdentifier: productId,
        planIdentifier: selection.basePlanId,
        offerToken: selection.offerToken,
        appAccountToken: selection.accountId,
        // NEVER auto-acknowledge client-side: the server's durable
        // post-grant worker acknowledges after the authoritative grant.
        autoAcknowledgePurchases: false,
        productType: 'subs',
      });
      // purchaseToken IS the receipt identity on Play — transactionId /
      // order ids must never be substituted for it.
      const receiptId = result.purchaseToken;
      if (!receiptId) {
        return {
          success: false,
          provider,
          productId,
          errorMessage: 'Store returned no purchaseToken — cannot validate',
        };
      }
      return { success: true, provider, productId, receiptId };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown store error';
      return { success: false, provider, productId, errorMessage };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // restorePurchases — App Store policy mandates every app exposes a
  // "Restore Purchases" affordance so users who reinstall / switch
  // device can re-acquire prior subscriptions without re-paying. Google
  // Play handles this via the BillingClient cache automatically, but
  // we expose a uniform method so the UI can show one button.
  //
  // On Play we query `getPurchases` (SUBS, current entitlements only)
  // scoped to the signed-in account's appAccountToken — never the
  // legacy restorePurchases flow, which can surface receipts belonging
  // to another Google account on a shared device.
  //
  // On web we return [] — there's nothing to restore, the subscription
  // lives in Firestore keyed by uid.
  // ─────────────────────────────────────────────────────────────────────
  async restorePurchases(accountId?: string): Promise<IapPurchaseResult[]> {
    const platform = IapAdapter.getPlatform();
    if (platform === 'web') return [];
    const provider: BillingProvider =
      platform === 'android' ? 'google-play' : 'app-store';
    try {
      const plugin = await loadCapacitorIapPlugin();
      const response = await plugin.getPurchases({
        productType: 'subs',
        ...(accountId ? { appAccountToken: accountId } : {}),
        onlyCurrentEntitlements: true,
      });
      return (response.purchases ?? [])
        .filter(
          // Defense in depth: even if the store query echoes another
          // account's purchase, receipt identity is the purchaseToken
          // scoped to the authenticated account.
          (p) => (accountId ? p.appAccountToken === accountId : true),
        )
        .flatMap((p) => {
          const receiptId = p.purchaseToken;
          return receiptId
            ? [
                {
                  success: true as const,
                  provider,
                  productId: p.productIdentifier,
                  receiptId,
                },
              ]
            : [];
        });
    } catch (err) {
      return [
        {
          success: false,
          provider,
          errorMessage:
            err instanceof Error ? err.message : 'Unknown restore error',
        },
      ];
    }
  }
}

/** Singleton convenience export — Pricing.tsx can `import { iapAdapter } from`
 * just like the other adapters in this folder. */
export const iapAdapter = new IapAdapter();
