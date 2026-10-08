// Praeventio Guard — durable native receipt recovery (billing task 3).
//
// A purchase that survives the store but dies during server validation
// (app killed, offline, 5xx) must NEVER be retried as a repurchase:
// Play treats a second `purchaseProduct` as a new charge. Instead we
// persist only METADATA (what to recover, never the receipt itself) and
// re-derive the purchaseToken through `restorePurchases` on the next
// attempt — Play owns the token, we never store it.
//
// Rules (nativeReceiptRecovery.test.ts):
//   1. The purchaseToken is NEVER persisted (it is a bearer credential;
//      local storage is extractable on rooted/jailed devices).
//   2. If the product already exists in Play, `buy` re-validates the
//      existing receipt instead of purchasing again.
//   3. A failed HTTP validation is NOT a subscription success — the
//      pending metadata stays for a later recovery sweep.
//   4. Pending metadata survives account changes untouched — another
//      user's recovery run never consumes or destroys it.

export interface RecoveryReceipt {
  success: boolean;
  provider: string;
  receiptId?: string;
  productId?: string;
  errorMessage?: string;
}

export interface RecoverySelection {
  basePlanId?: string;
  offerToken?: string;
}

export interface RecoveryAdapter {
  restorePurchases(accountId?: string): Promise<RecoveryReceipt[]>;
  purchase(
    productId: string,
    provider: string,
    selection?: RecoverySelection,
  ): Promise<RecoveryReceipt>;
}

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RecoveryValidate = (receipt: RecoveryReceipt) => Promise<boolean>;

interface PendingMetadata {
  productId: string;
  provider: string;
  accountId: string;
  basePlanId?: string;
  offerToken?: string;
}

const pendingKey = (user: string): string => `iap.pending.${user}`;

export class NativeReceiptRecovery {
  constructor(
    private readonly adapter: RecoveryAdapter,
    private readonly store: RecoveryStorage,
    private readonly validate: RecoveryValidate,
  ) {}

  /**
   * Buy without double-charging: if Play already holds an entitlement
   * for this product, recover it; otherwise purchase once, persist
   * pending metadata (no token) and validate. Returns true only on an
   * authoritative validation success.
   */
  async buy(
    user: string,
    account: string,
    productId: string,
    provider: string,
    selection?: RecoverySelection,
  ): Promise<boolean> {
    const existing = await this.findExisting(account, productId);
    const receipt =
      existing ??
      (await this.adapter.purchase(productId, provider, selection));
    if (!receipt?.success || !receipt.receiptId) return false;

    this.savePending(user, {
      productId,
      provider,
      accountId: account,
      basePlanId: selection?.basePlanId,
      offerToken: selection?.offerToken,
    });

    const ok = await this.validate(receipt).catch(() => false);
    if (ok) {
      this.store.removeItem(pendingKey(user));
      return true;
    }
    return false;
  }

  /**
   * Recovery sweep: re-validate everything Play still holds for this
   * account, plus any pending metadata from earlier interrupted runs.
   * Returns the number of authoritative validation successes.
   */
  async recover(user: string, account: string): Promise<number> {
    let recovered = 0;
    let receipts: RecoveryReceipt[] = [];
    try {
      receipts = await this.adapter.restorePurchases(account);
    } catch {
      receipts = [];
    }

    for (const receipt of receipts) {
      if (!receipt?.success || !receipt.receiptId || !receipt.productId) {
        continue;
      }
      // Persist metadata first (crash between here and validate leaves
      // the pending record, which the next sweep retries — never lost,
      // never duplicated as a purchase).
      const pending = this.readPending(user) ?? {
        productId: receipt.productId,
        provider: receipt.provider,
        accountId: account,
      };
      this.savePending(user, { ...pending, productId: receipt.productId });
      const ok = await this.validate(receipt).catch(() => false);
      if (ok) {
        recovered += 1;
        this.store.removeItem(pendingKey(user));
      }
    }
    return recovered;
  }

  private async findExisting(
    account: string,
    productId: string,
  ): Promise<RecoveryReceipt | null> {
    const receipts = await this.adapter
      .restorePurchases(account)
      .catch(() => [] as RecoveryReceipt[]);
    return (
      receipts.find(
        (r) => r?.success && r.productId === productId && Boolean(r.receiptId),
      ) ?? null
    );
  }

  private readPending(user: string): PendingMetadata | null {
    const raw = this.store.getItem(pendingKey(user));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingMetadata;
    } catch {
      return null;
    }
  }

  private savePending(user: string, meta: PendingMetadata): void {
    this.store.setItem(pendingKey(user), JSON.stringify(meta));
  }
}
