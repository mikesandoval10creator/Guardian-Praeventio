// Praeventio Guard — useInvoicePolling.
//
// Polls `GET /api/billing/invoice/:id` (server.ts, owned by Agent D1) until the
// invoice reaches a terminal status (paid / rejected / refunded / cancelled),
// or until a timeout is hit. Designed to back the Webpay return banner: the
// `/billing/webpay/return` redirect can race ahead of the actual commit, so
// the SPA needs to reconcile against the authoritative invoice document.
//
// Architecture:
//   • A pure async polling engine (`runInvoicePoll`) drives the state machine
//     and is fully injectable (fetch, getToken, scheduler, clock). This is
//     what the unit tests exercise — no React, no jsdom required.
//   • The React hook (`useInvoicePolling`) is a thin wrapper that wires the
//     engine into `useEffect` lifecycle and surfaces state via `useState`.
//
// Endpoint contract (D1):
//   200 → { id, status, totals, emisorRut, issuedAt, paidAt?, rejectionReason? }
//   404 → not yet written (or not owned). Treat as "still pending"; keep polling.
//   401 → unauthenticated. Stop with error.
//   5xx → transient. Keep polling, increment attempt.
//
// Backoff: exponential 1s → 2s → 4s → 8s (cap), starting from `intervalMs`.

import { useEffect, useState } from 'react';
import { auth } from '../services/firebase';

export interface InvoiceStatus {
  id: string;
  status: 'draft' | 'pending-payment' | 'paid' | 'cancelled' | 'rejected' | 'refunded';
  totals: { subtotal: number; iva: number; total: number; currency: 'CLP' | 'USD' };
  emisorRut: '78231119-0';
  issuedAt: string;
  paidAt?: string;
  rejectionReason?: string;
}

export type InvoicePollState =
  | { kind: 'idle' }
  | { kind: 'loading'; attempt: number }
  | { kind: 'settled'; invoice: InvoiceStatus }
  | { kind: 'timeout'; lastInvoice?: InvoiceStatus }
  | { kind: 'error'; message: string };

export interface InvoicePollOptions {
  /** Initial poll interval. Defaults to 1000 ms (then doubles up to backoffCapMs). */
  intervalMs?: number;
  /** Total deadline before declaring `timeout`. Default: 60_000 ms. */
  timeoutMs?: number;
  /** Statuses considered final. Default: ['paid','rejected','refunded','cancelled']. */
  settleStatuses?: string[];
  /** Cap for exponential backoff. Default: 8000 ms. */
  backoffCapMs?: number;
}

/** Statuses that stop polling. */
const DEFAULT_SETTLE_STATUSES = ['paid', 'rejected', 'refunded', 'cancelled'];

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BACKOFF_CAP_MS = 8000;

/**
 * Dependency surface for the pure polling engine. All side-effecting bits
 * are injected so tests can replace them.
 */
export interface InvoicePollDeps {
  fetchImpl: typeof fetch;
  /** Resolves the Firebase ID token, or null if there's no signed-in user. */
  getToken: () => Promise<string | null>;
  /** setTimeout wrapper — returns a cancel handle. */
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface RunInvoicePollArgs extends InvoicePollOptions {
  invoiceId: string;
  deps: InvoicePollDeps;
  onState: (state: InvoicePollState) => void;
  /** Abort signal — when fired, polling stops without emitting further state. */
  signal: AbortSignal;
}

/**
 * Pure polling engine. Returns nothing; emits state through `onState`.
 *
 * Behavior:
 *   - Emits `{kind:'loading', attempt:1}` immediately.
 *   - Each tick fetches `/api/billing/invoice/${invoiceId}` with Bearer token.
 *   - 200 + status in settleStatuses  → emit `settled`, stop.
 *   - 200 + status not in settleStatuses → schedule next tick (backoff).
 *   - 404 → keep polling (D1 endpoint may not have written yet).
 *   - 401 → emit `error: 'no autenticado'`, stop.
 *   - 5xx / network → keep polling, attempt counter increments.
 *   - Total elapsed > timeoutMs → emit `timeout`, stop.
 *   - signal.aborted → stop silently.
 */
export async function runInvoicePoll(args: RunInvoicePollArgs): Promise<void> {
  const {
    invoiceId,
    deps,
    onState,
    signal,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    settleStatuses = DEFAULT_SETTLE_STATUSES,
    backoffCapMs = DEFAULT_BACKOFF_CAP_MS,
  } = args;

  if (signal.aborted) return;

  const settleSet = new Set(settleStatuses);
  const startedAt = Date.now();
  let attempt = 0;
  let lastInvoice: InvoiceStatus | undefined;
  // Firebase Auth hydration grace: the FIRST null/throwing getToken
  // observed during this poll is treated as "auth still hydrating" and
  // we schedule one retry. Any subsequent null surfaces "sin sesión".
  // The grace is keyed to null-token COUNT, not to attempt number, so a
  // session that expires mid-poll also gets one quiet retry.
  let tokenGraceUsed = false;

  const emit = (state: InvoicePollState) => {
    if (signal.aborted) return;
    onState(state);
  };

  // Resolve the Bearer token once per attempt (Firebase rotates it lazily, but
  // a long polling window can outlive the cached token). If the user has
  // signed out, bail immediately.
  type TickResult = { done: true } | { done: false; nextDelay: number };
  const tick = async (): Promise<TickResult> => {
    attempt += 1;
    emit({ kind: 'loading', attempt });

    let token: string | null;
    try {
      token = await deps.getToken();
    } catch {
      token = null;
    }
    if (signal.aborted) return { done: true };
    if (!token) {
      if (!tokenGraceUsed) {
        // First null token: assume Firebase Auth is still hydrating. Burn the
        // grace and reschedule. Subsequent nulls fall through to "sin sesión".
        tokenGraceUsed = true;
        return { done: false, nextDelay: nextBackoff(attempt) };
      }
      emit({ kind: 'error', message: 'sin sesión' });
      return { done: true };
    }

    let response: Response;
    try {
      response = await deps.fetchImpl(
        `/api/billing/invoice/${encodeURIComponent(invoiceId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal,
        },
      );
    } catch (err: any) {
      // Aborted or network error. If aborted, stop. Otherwise treat as 5xx.
      if (signal.aborted || err?.name === 'AbortError') return { done: true };
      return { done: false, nextDelay: nextBackoff(attempt) };
    }

    if (signal.aborted) return { done: true };

    if (response.status === 401) {
      emit({ kind: 'error', message: 'no autenticado' });
      return { done: true };
    }

    if (response.status === 404) {
      // D1 hasn't written the doc yet — keep polling.
      return { done: false, nextDelay: nextBackoff(attempt) };
    }

    if (response.status >= 500) {
      // Transient — retry.
      return { done: false, nextDelay: nextBackoff(attempt) };
    }

    if (!response.ok) {
      // 4xx other than 401/404 (e.g. 400 malformed id). Treat as fatal.
      emit({ kind: 'error', message: `respuesta inválida (${response.status})` });
      return { done: true };
    }

    let invoice: InvoiceStatus;
    try {
      invoice = (await response.json()) as InvoiceStatus;
    } catch {
      // Malformed JSON — retry briefly.
      return { done: false, nextDelay: nextBackoff(attempt) };
    }

    lastInvoice = invoice;
    if (settleSet.has(invoice.status)) {
      emit({ kind: 'settled', invoice });
      return { done: true };
    }

    return { done: false, nextDelay: nextBackoff(attempt) };
  };

  function nextBackoff(currentAttempt: number): number {
    // attempt is 1-based. delay = intervalMs * 2^(attempt-1), capped.
    const exp = intervalMs * Math.pow(2, Math.max(0, currentAttempt - 1));
    return Math.min(exp, backoffCapMs);
  }

  // Drive the loop. We use setTimer for delays so the test harness can
  // advance `vi.advanceTimersByTimeAsync`.
  while (!signal.aborted) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      emit({ kind: 'timeout', lastInvoice });
      return;
    }

    const result = await tick();
    if (result.done === true) return;

    // Schedule the next attempt. Don't exceed remaining deadline.
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      emit({ kind: 'timeout', lastInvoice });
      return;
    }
    const delay = Math.min(result.nextDelay, remaining);

    await new Promise<void>((resolve) => {
      const handle = deps.setTimer(() => resolve(), delay);
      // If aborted while waiting, cancel the timer and resolve so the loop
      // exits at the top via `signal.aborted` check.
      const onAbort = () => {
        deps.clearTimer(handle);
        resolve();
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

/**
 * React hook: polls `/api/billing/invoice/:id` until it settles.
 *
 * Returns `{kind: 'idle'}` when `invoiceId` is null/empty (no fetch). On mount
 * and on every `invoiceId` change, polling restarts. On unmount, the in-flight
 * fetch is cancelled via AbortController.
 */
export function useInvoicePolling(
  invoiceId: string | null,
  options?: InvoicePollOptions,
): InvoicePollState {
  const [state, setState] = useState<InvoicePollState>({ kind: 'idle' });

  // We intentionally serialize options into a primitive key so callers passing
  // an inline object literal don't trigger an infinite restart.
  const intervalMs = options?.intervalMs;
  const timeoutMs = options?.timeoutMs;
  const backoffCapMs = options?.backoffCapMs;
  const settleStatusesKey = options?.settleStatuses
    ? options.settleStatuses.join(',')
    : '';

  useEffect(() => {
    if (!invoiceId) {
      setState({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();

    const settleStatuses = settleStatusesKey
      ? settleStatusesKey.split(',')
      : undefined;

    runInvoicePoll({
      invoiceId,
      deps: {
        fetchImpl: (input, init) => fetch(input, init),
        getToken: async () => {
          const u = auth.currentUser;
          if (!u) return null;
          try {
            return await u.getIdToken();
          } catch {
            return null;
          }
        },
        setTimer: (cb, ms) => setTimeout(cb, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      onState: setState,
      signal: controller.signal,
      intervalMs,
      timeoutMs,
      backoffCapMs,
      settleStatuses,
    }).catch(() => {
      // The engine should never throw, but guard against unexpected runtime
      // errors (e.g. the fetch polyfill rejecting with a non-Error). We
      // surface a generic error instead of crashing the component tree.
      if (!controller.signal.aborted) {
        setState({ kind: 'error', message: 'error inesperado' });
      }
    });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, intervalMs, timeoutMs, backoffCapMs, settleStatusesKey]);

  return state;
}
