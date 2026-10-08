// Praeventio Guard — canonical Google Play subscription state (RTDN).
//
// The Real-Time Developer Notification payload and the
// `purchases.subscriptionsv2.get` response both carry
// `subscriptionState` + `lineItems[]`, but they must NEVER be trusted
// as "the first line item is the one being claimed": a purchase can
// carry unrelated SKUs, and an invalid expiry must not silently become
// "now" or "never". This module reconciles a raw Play state document
// into the single canonical entry for one SKU, or nothing at all.
//
// Rules (billing task 3, tests in googlePlayState.test.ts):
//   1. The line item must match the claimed SKU exactly — a mismatch
//      returns null instead of granting whatever is present.
//   2. The RFC3339 expiry string is preserved VERBATIM (including
//      fractional seconds) — we never re-format a store timestamp.
//   3. CANCELED subscriptions remain active until the paid period ends
//      (the user paid through the date; cutting access early is theft,
//      and Play would refund us the difference).
//   4. An unparseable expiry returns null — we do not manufacture a
//      date or an access window from garbage.

export interface PlayLineItem {
  productId?: string;
  expiryTime?: string;
}

export interface PlayStateDocument {
  subscriptionState?: string;
  lineItems?: PlayLineItem[];
}

export interface CanonicalPlayState {
  active: boolean;
  /** The store's own RFC3339 string, preserved verbatim. */
  expiryDate: string;
}

/** States that represent access already ended on Play's side, even if
 * the expiry line item has not rolled over yet. */
const TERMINATED_STATES: ReadonlySet<string> = new Set([
  'SUBSCRIPTION_STATE_EXPIRED',
  'SUBSCRIPTION_STATE_REVOKED',
]);

export function reconcileGooglePlayState(
  data: PlayStateDocument | null | undefined,
  sku: string,
  nowMs: number,
): CanonicalPlayState | null {
  const lineItems = data?.lineItems;
  if (!Array.isArray(lineItems)) return null;

  // Exact SKU match only — never "grant the first line item".
  const line = lineItems.find((item) => item?.productId === sku);
  if (!line?.expiryTime) return null;

  const expiryMs = Date.parse(line.expiryTime);
  if (!Number.isFinite(expiryMs)) return null;

  const state = data?.subscriptionState ?? '';
  const active = expiryMs > nowMs && !TERMINATED_STATES.has(state);

  return { active, expiryDate: line.expiryTime };
}
