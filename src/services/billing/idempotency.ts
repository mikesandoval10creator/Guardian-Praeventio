// Praeventio Guard — withIdempotency() lock-then-complete helper.
//
// Background: two billing endpoints (Google Play RTDN webhook,
// Webpay return URL) both implemented the same Firestore-backed
// idempotency dance inline. Each one followed exactly the same shape:
//
//   1. read `${collection}/${key}` once.
//   2. if doc exists with status='done' → skip work, replay outcome.
//   3. if doc exists with status='in_progress' AND lockedAt < N min ago →
//      another worker is in-flight; caller short-circuits with a 200/redirect.
//   4. if doc exists with status='in_progress' AND lockedAt is stale → steal.
//   5. otherwise (absent, or stale steal) write `{status:'in_progress', lockedAtMs}`,
//      run work(), then update to `{status:'done', result, completedAtMs}`.
//   6. on exception INSIDE work(): leave doc as 'in_progress' so the
//      staleness window allows a future redelivery to retry.
//
// This file factors that into a single helper. The Webpay branch keeps
// its own typed wrappers (`acquireWebpayIdempotencyLock` /
// `finalizeWebpayIdempotencyLock` in webpayAdapter.ts) because those need
// to expose the captured outcome+invoiceId for replay-redirect — that
// state-replay shape is too domain-specific to fold in here without
// muddying the generic contract. RTDN, the new Webhook handler, and any
// future at-least-once consumer go through this helper directly.
//
// Edge cases pinned by the unit tests:
//   • doc absent                                 → fresh-success
//   • doc 'done'                                 → duplicate (replay)
//   • doc 'in_progress' fresh                    → in-flight (no-op)
//   • doc 'in_progress' stale                    → stale-retry (steal lock)
//   • doc 'in_progress' with no lockedAtMs at all → treated as stale
//   • work() throws                              → leave 'in_progress', rethrow
//   • concurrent first/second caller            → second sees fresh in-flight
//
// IMPORTANT: this is `set({merge:true})`, NOT a transactional acquire. A
// truly racy multi-process steal of a stale lock could double-process
// once per staleness window. In practice the cost of that is bounded
// (one duplicate run per ~5 min) and the work itself is idempotent at
// the destination (e.g., the Play store update is upsert-by-token).
// If this ever becomes a problem we can switch to a Firestore transaction
// here without changing the public API.

/**
 * The kind of outcome callers branch on.
 *
 *   - `fresh-success` — first time we've seen this key; work ran and
 *     succeeded. Caller should respond 2xx.
 *   - `duplicate`     — a prior run already completed this key. Caller
 *     should respond 2xx (and may use `previousResult` to replay any
 *     captured response shape, e.g. a stored redirect URL).
 *   - `in-flight`     — another worker holds a fresh lock. Caller should
 *     respond 2xx to suppress redelivery; the staleness window will
 *     allow a retry if that worker dies.
 *   - `stale-retry`   — we stole an expired lock and successfully
 *     completed the work. Caller should respond 2xx.
 *
 * `T` is whatever the work function returns. We keep `previousResult`
 * as `unknown` because Firestore round-trips lose some type info
 * (Timestamp → object) and forcing callers to re-validate is safer than
 * pretending the cast is sound.
 */
export type IdempotencyOutcome<T> =
  | { kind: 'fresh-success'; result: T }
  | { kind: 'duplicate'; previousResult: unknown }
  | { kind: 'in-flight' }
  | { kind: 'stale-retry'; result: T };

export interface IdempotencyOptions {
  /** Firestore collection — e.g. 'processed_pubsub' or 'processed_webpay'. */
  collection: string;
  /** Per-message key — e.g. RTDN messageId or Webpay token_ws. */
  key: string;
  /**
   * After this many ms have elapsed since lockedAtMs, an existing
   * 'in_progress' lock is considered stale and may be stolen.
   * Defaults to 5 minutes (matches Pub/Sub ack-deadline guidance).
   */
  staleAfterMs?: number;
  /** Injected clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Default stale-lock window. Exposed so tests and callers can refer to
 * the same constant rather than hardcoding "5 minutes" in three places.
 */
export const IDEMPOTENCY_DEFAULT_STALE_MS = 5 * 60 * 1000;

/**
 * Minimal Firestore shape used by `withIdempotency`. We accept any object
 * with `.collection(name).doc(key).get()/.set()/.update()` so callers can
 * pass either:
 *
 *   • the real `admin.firestore()` instance, or
 *   • a vitest mock (see idempotency.test.ts).
 *
 * We intentionally do NOT import `firebase-admin` at module load — that
 * keeps this file unit-testable without spinning up the SDK.
 */
export interface MinimalFirestore {
  collection(name: string): {
    doc(key: string): {
      get(): Promise<{
        exists: boolean;
        data(): Record<string, any> | undefined;
      }>;
      set(
        data: Record<string, any>,
        options?: { merge?: boolean },
      ): Promise<unknown>;
      update(data: Record<string, any>): Promise<unknown>;
    };
  };
}

/**
 * Lock-then-complete idempotency wrapper. See file-level comment block
 * for the full state machine. Behavior contract:
 *
 *   • work() runs at most ONCE per (collection, key) per
 *     staleAfterMs window across concurrent invocations.
 *   • If work() throws, the exception propagates and the lock doc
 *     stays in 'in_progress' — staleness window grants the next
 *     redelivery a fresh attempt.
 *   • If work() succeeds, we best-effort update the doc to 'done' with
 *     `result` captured for future duplicate detection.
 *   • A best-effort failure to mark 'done' (transient Firestore blip)
 *     is intentionally swallowed — the work succeeded, and the worst
 *     case is one duplicate run after the staleness window. The caller
 *     should still see `fresh-success`/`stale-retry` for that run.
 *
 * Concurrent acquire race note: two workers reading the doc as 'absent'
 * simultaneously could both write `set({merge:true})` 'in_progress'.
 * The merge semantics mean the lock writes are commutative (last write
 * wins on `lockedAtMs` only), and both callers will then run work().
 * For our use cases the destination state (Play subscription upsert,
 * Webpay invoice upsert) is itself idempotent under retry, so this is
 * acceptable. Switch to a Firestore transaction here if your work() is
 * NOT idempotent.
 */
export async function withIdempotency<T>(
  db: MinimalFirestore,
  options: IdempotencyOptions,
  work: () => Promise<T>,
): Promise<IdempotencyOutcome<T>> {
  const staleAfterMs = options.staleAfterMs ?? IDEMPOTENCY_DEFAULT_STALE_MS;
  const now = options.now ?? (() => new Date());
  const ref = db.collection(options.collection).doc(options.key);

  // Step 1: probe the doc and decide which branch we're in.
  const snap = await ref.get();
  let mode: 'fresh' | 'stale-steal' = 'fresh';
  if (snap.exists) {
    const data = snap.data() ?? {};
    if (data.status === 'done') {
      return { kind: 'duplicate', previousResult: data.result };
    }
    if (data.status === 'in_progress') {
      const lockedAtMs = typeof data.lockedAtMs === 'number' ? data.lockedAtMs : 0;
      const ageMs = now().getTime() - lockedAtMs;
      if (lockedAtMs > 0 && ageMs < staleAfterMs) {
        // Another worker is in-flight; caller will respond 200/redirect
        // and let the staleness window grant a retry if that worker dies.
        return { kind: 'in-flight' };
      }
      // lockedAtMs missing OR ageMs >= staleAfterMs → steal.
      mode = 'stale-steal';
    }
    // Any other status value (defensive: unknown shape) → fall through
    // to a fresh-style overwrite. Better to retry once than to wedge.
  }

  // Step 2: write the in_progress lock. We use `set({merge:true})` so
  // the existing receivedAtMs / expiresAt fields (if a prior crashed
  // run wrote them) are preserved for audit; only status + lockedAtMs
  // are guaranteed to update.
  const lockedAtMs = now().getTime();
  const expiresAt = new Date(lockedAtMs + 7 * 24 * 60 * 60 * 1000);
  await ref.set(
    {
      status: 'in_progress',
      lockedAtMs,
      receivedAtMs: lockedAtMs,
      expiresAt, // hint for Firestore TTL policy (configure in console)
    },
    { merge: true },
  );

  // Step 3: run the work. If it throws, do NOT update the doc — leaving
  // it as 'in_progress' lets the staleness window grant a future
  // redelivery a fresh attempt.
  const result = await work();

  // Step 4: best-effort finalize. We never throw from here even if the
  // update fails — the work is done, and a duplicate run after the
  // staleness window is acceptable per the contract above.
  try {
    await ref.update({
      status: 'done',
      result,
      completedAtMs: now().getTime(),
    });
  } catch {
    // Swallow. See contract note above.
  }

  return mode === 'stale-steal'
    ? { kind: 'stale-retry', result }
    : { kind: 'fresh-success', result };
}
