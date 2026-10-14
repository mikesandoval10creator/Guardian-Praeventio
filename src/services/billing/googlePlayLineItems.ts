import { parseGooglePlayExpiryTime } from './googlePlayExpiry.js';

export class GooglePlayProductMismatchError extends Error {
  constructor() { super('Google Play product mismatch'); }
}

interface SelectedItem {
  productId: string;
  expiryTime: string | null;
  latestSuccessfulOrderId: string | null;
  replacementProductId: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function items(data: unknown): SelectedItem[] {
  if (!record(data) || !Array.isArray(data.lineItems)) return [];
  const result: SelectedItem[] = [];
  const rawItems: readonly unknown[] = data.lineItems;
  for (const item of rawItems) {
    if (!record(item) || typeof item.productId !== 'string' || !item.productId) continue;
    const replacement = item.deferredItemReplacement;
    result.push({
      productId: item.productId,
      expiryTime: parseGooglePlayExpiryTime(item.expiryTime),
      latestSuccessfulOrderId: typeof item.latestSuccessfulOrderId === 'string' ? item.latestSuccessfulOrderId : null,
      replacementProductId: record(replacement) && typeof replacement.productId === 'string' ? replacement.productId : null,
    });
  }
  return result;
}

export function selectGooglePlayVerificationItem(data: unknown, sku: unknown, nowMs: number): SelectedItem {
  const lines = items(data);
  const requested = lines.find(item => item.productId === sku);
  if (!requested) throw new GooglePlayProductMismatchError();
  if (requested.expiryTime !== null) return requested;
  // Google's deferred replacement explicitly links the current paid item
  // to the requested future product. Never infer that link from array order.
  const current = lines.filter(item => item.replacementProductId === sku
    && item.expiryTime !== null && Date.parse(item.expiryTime) > nowMs);
  const [selected] = current;
  if (current.length !== 1 || !selected) throw new GooglePlayProductMismatchError();
  return selected;
}

export function selectGooglePlayRtdnItem(
  data: unknown, persistedSku: unknown, nowMs: number, isKnownSku: (sku: string) => boolean,
  matchesLegacyPlan: (sku: string) => boolean = () => false,
): SelectedItem {
  const verified = items(data);
  if (verified.some(item => item.expiryTime !== null && Date.parse(item.expiryTime) > nowMs
    && !isKnownSku(item.productId))) {
    throw new Error('Unknown active Google Play product');
  }
  const lines = verified.filter(item => isKnownSku(item.productId) && item.expiryTime !== null);
  const live = lines.filter(item => item.expiryTime !== null && Date.parse(item.expiryTime) > nowMs);
  const candidates = live.length > 0 ? live : lines;
  const [only] = candidates;
  if (candidates.length === 1 && only) return only;
  const matching = candidates.filter(item => item.productId === persistedSku);
  const [selected] = matching;
  if (matching.length === 1 && selected) return selected;
  if (typeof persistedSku !== 'string' || !persistedSku) {
    const legacy = candidates.filter(item => matchesLegacyPlan(item.productId));
    const [inferred] = legacy;
    if (legacy.length === 1 && inferred) return inferred;
  }
  // Ambiguous purchases must not overwrite the existing paid entitlement.
  throw new Error('Ambiguous Google Play subscription products');
}
