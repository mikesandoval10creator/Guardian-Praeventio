// Praeventio Guard — Sprint 22 prod hardening (Bucket X).
//
// In-process circuit breaker for the Gemini upstream. Tracks failures
// per-key (typically the model id, or `tenant-<id>` for tenant-scoped
// breakers) and trips into `open` after THRESHOLD failures inside
// WINDOW_MS. While open, `isOpen()` returns true so callers can fast-fail
// without burning more Gemini budget.
//
// State machine:
//   closed  ──5 failures in 60s──▶  open
//   open    ──5 minutes elapsed──▶  half-open
//   half-open + recordSuccess()  ──▶  closed (counter reset)
//   half-open + recordFailure()  ──▶  open (timer restarted)
//
// Layered with:
//   • `quotaTracker.checkQuotaLimit` — per-tenant DAILY ceiling.
//   • `geminiLimiter` (limiters.ts) — per-uid 30 req / 15 min.
//   • This file — fast-fails when Gemini itself looks unhealthy
//     (timeouts, 503s, 429-looping). Reset by the next observed
//     success in the half-open window.
//
// In-process only on purpose — Praeventio runs single-region single-tier
// in prod (Cloud Run min-instances=1, max-instances small). If we ever
// scale horizontally and need cross-instance state, swap the `failures`
// Map for a Redis-backed adapter without touching the API surface.

export type CircuitState = 'closed' | 'open' | 'half-open';

interface FailureEntry {
  count: number;
  lastFailureAt: number;
  /** When opened, set to the wall-clock millis when the breaker opened. */
  openedAt?: number;
}

export class GeminiCircuitBreaker {
  /**
   * Failure rolling window (ms). Failures older than WINDOW_MS from
   * `now()` are forgotten on the next read/write.
   */
  readonly WINDOW_MS = 60_000;
  /** Number of failures inside WINDOW_MS that trips the breaker. */
  readonly THRESHOLD = 5;
  /** How long the breaker stays open before transitioning to half-open. */
  readonly OPEN_DURATION_MS = 300_000; // 5 min

  private readonly failures = new Map<string, FailureEntry>();

  /**
   * Optional clock injection for tests. `now()` defaults to
   * `Date.now()` and can be replaced via the constructor for
   * deterministic testing of the half-open transition.
   */
  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** True when callers should fast-fail without invoking Gemini. */
  isOpen(key: string): boolean {
    return this.getState(key) === 'open';
  }

  /** Reset the failure counter for `key`. Always safe to call. */
  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  /**
   * Record a failure for `key`. Increments the rolling counter and
   * trips the breaker once THRESHOLD is reached. If the breaker is
   * already half-open, a single failure re-opens it.
   */
  recordFailure(key: string): void {
    const now = this.clock();
    const state = this.getState(key);

    if (state === 'half-open') {
      // A single failure in half-open re-opens the breaker and restarts
      // the cooldown. Counter starts at THRESHOLD so we stay open
      // until OPEN_DURATION_MS has elapsed again.
      this.failures.set(key, {
        count: this.THRESHOLD,
        lastFailureAt: now,
        openedAt: now,
      });
      return;
    }

    const existing = this.failures.get(key);
    if (!existing) {
      this.failures.set(key, { count: 1, lastFailureAt: now });
      return;
    }

    // Drop counter if last failure was outside the rolling window.
    const withinWindow = now - existing.lastFailureAt <= this.WINDOW_MS;
    const nextCount = withinWindow ? existing.count + 1 : 1;
    const next: FailureEntry = {
      count: nextCount,
      lastFailureAt: now,
      openedAt: existing.openedAt,
    };
    if (nextCount >= this.THRESHOLD) {
      next.openedAt = now;
    }
    this.failures.set(key, next);
  }

  /** Inspect breaker state. Useful for /api/admin/circuit-state. */
  getState(key: string): CircuitState {
    const entry = this.failures.get(key);
    if (!entry) return 'closed';
    const now = this.clock();

    if (entry.openedAt !== undefined) {
      const elapsed = now - entry.openedAt;
      if (elapsed < this.OPEN_DURATION_MS) return 'open';
      // Past the open duration — transition to half-open. We do not
      // mutate the map here; the next recordSuccess/recordFailure
      // settles state. Reading getState() must remain idempotent.
      return 'half-open';
    }

    // Counter present but below threshold — still closed. Drop stale
    // entries so the map doesn't grow unbounded.
    if (now - entry.lastFailureAt > this.WINDOW_MS) {
      this.failures.delete(key);
      return 'closed';
    }
    return 'closed';
  }

  /** Snapshot of all known keys → state. For ops endpoints. */
  snapshot(): Record<string, CircuitState> {
    const out: Record<string, CircuitState> = {};
    for (const key of this.failures.keys()) {
      out[key] = this.getState(key);
    }
    return out;
  }

  /** Test-only — fully clear internal state. */
  __resetForTests(): void {
    this.failures.clear();
  }
}

/**
 * Module-level singleton. Most callers should use this. For tests that
 * need a clean breaker, instantiate `new GeminiCircuitBreaker()` directly.
 */
export const geminiCircuit = new GeminiCircuitBreaker();
