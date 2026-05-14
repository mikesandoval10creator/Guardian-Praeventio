/**
 * Auto-trigger layer for the offline → Zettelkasten reconciliation runner.
 *
 * Sprint 32 / Bucket Stream — this module is the missing wiring that turns
 * `reconciliationRunner.runReconciliation()` from a function the caller has
 * to invoke explicitly into a service that runs ITSELF when:
 *
 *   1. The browser fires `window.online` (the device just got connectivity
 *      back). A 5-second debounce smooths over network parpadeo — three
 *      rapid online events translate into one reconciliation pass, not
 *      three competing ones.
 *
 *   2. An admin FCM message of type `reconciliate-now` arrives. We do not
 *      own the FCM listener directly (that's `usePushNotifications` /
 *      `NotificationContext`); instead, those modules dispatch a
 *      `gp-fcm-reconciliate-now` window event which we listen for. This
 *      keeps the trigger module free of any Firebase / FCM SDK import and
 *      makes it trivially testable in a node environment.
 *
 *   3. The caller explicitly invokes `triggerNow()` (Settings page button,
 *      hook `triggerNow`, etc.). Same code path as the automatic triggers.
 *
 * Duplicate-run guard: every successful trigger stamps the current epoch
 * millisecond into `localStorage` under `slm.reconciliation.lastRunAt`.
 * A subsequent trigger fired within `MIN_INTERVAL_MS` (60s) is dropped on
 * the floor with a `skipped: true` result. This means re-opening the app
 * shortly after a previous pass does not re-drain the (now empty) queue.
 *
 * Audit log: the caller supplies a `writeAuditFn` that receives a fully
 * formed audit record. We do not import Firestore here — keeping the
 * service runnable in node tests without touching firebase-admin. The
 * record shape is documented on the `ReconciliationAuditRecord` interface
 * below.
 *
 * Stats event: every completed run dispatches a `gp-slm-reconciliation-stats`
 * window event whose `detail` is the full `ReconciliationStats` payload.
 * The hook `useReconciliationStatus` listens for it; the toast component
 * mounted via that hook renders the user-facing announcement.
 *
 * What this module deliberately does NOT do:
 *   - It does not import the reconciliation runner statically. We pass it
 *     as a dependency so the test suite can substitute a stub and a future
 *     caller can shim a no-op (e.g. demo mode).
 *   - It does not own `setInterval` background polling. The caller may add
 *     that later; the contract here is event-driven.
 *   - It does not show toasts. The hook + component above this layer do.
 */

import type { ReconciliationResult } from './reconciliation';

/**
 * Window-level event the trigger dispatches after every run. The `detail`
 * payload matches `ReconciliationStats`. Consumers (hook, toast) listen
 * with `addEventListener('gp-slm-reconciliation-stats', cb)`.
 */
export const RECONCILIATION_STATS_EVENT = 'gp-slm-reconciliation-stats';

/**
 * Window-level event other modules dispatch when an FCM `reconciliate-now`
 * push arrives. Keeping it as a string here avoids a circular import with
 * the FCM adapter / NotificationContext.
 */
export const RECONCILIATION_FCM_EVENT = 'gp-fcm-reconciliate-now';

/** localStorage key that holds the last successful run timestamp (epoch ms). */
export const LAST_RUN_STORAGE_KEY = 'slm.reconciliation.lastRunAt';

/** Default minimum interval between consecutive auto-triggers (60 seconds). */
export const MIN_INTERVAL_MS = 60_000;

/** Default debounce window for the `window.online` event (5 seconds). */
export const ONLINE_DEBOUNCE_MS = 5_000;

/**
 * Stats payload emitted on the custom event and returned from `triggerNow`.
 * Mirrors `ReconciliationResult` plus the run id, the trigger source, and
 * the wall-clock start/finish timestamps so listeners can persist or
 * display the run without a second query.
 */
export interface ReconciliationStats {
  /** Stable id for this run — used by the audit log + UI keys. */
  runId: string;
  /** Wall-clock epoch ms when the run started. */
  startedAt: number;
  /** Wall-clock epoch ms when the run finished. */
  finishedAt: number;
  /** What caused the run to fire — useful for analytics. */
  trigger: 'online' | 'fcm' | 'manual';
  /** Mirror of `ReconciliationResult.attempted`. */
  attempted: number;
  /** Mirror of `ReconciliationResult.succeeded`. */
  succeeded: number;
  /** Mirror of `ReconciliationResult.failed`. */
  failed: number;
  /** Mirror of `ReconciliationResult.failures`. */
  failures: ReconciliationResult['failures'];
  /** True when the trigger was skipped (debounced or rate-limited). */
  skipped?: boolean;
  /** Why it was skipped, if `skipped` is true. */
  skippedReason?: 'rate_limited' | 'already_running';
}

/**
 * Shape the caller's audit-log persister must satisfy. We never block on
 * audit writes — failures are swallowed (logged via `onError`, if supplied)
 * — because dropping audit lines is preferable to dropping reconciliation
 * progress on a Firestore hiccup.
 */
export type WriteAuditFn = (record: ReconciliationAuditRecord) => Promise<void>;

/**
 * Audit record contract for Firestore (`tenants/{tid}/reconciliation_runs/{runId}`).
 *
 * The trigger module does not know about Firestore. The caller (app shell)
 * supplies a writer that maps this record to the actual document. Tenant
 * id is intentionally not on the record — the caller already knows it from
 * the auth context and includes it in the path.
 */
export interface ReconciliationAuditRecord {
  /** Same id as `ReconciliationStats.runId`. */
  runId: string;
  /** Project the reconciliation ran against. */
  projectId: string;
  /** Epoch ms the run started. */
  startedAt: number;
  /** Epoch ms the run finished. */
  finishedAt: number;
  /** What caused the run. */
  trigger: 'online' | 'fcm' | 'manual';
  /** Total sessions the queue had pending at the start of the pass. */
  attempted: number;
  /** Sessions that wrote successfully. */
  succeeded: number;
  /** Sessions that failed (HMAC mismatch counted here too). */
  failed: number;
  /** Per-failure detail (capped server-side, but we surface the full set). */
  failures: Array<{ sessionId: string; error: string }>;
}

/** Caller-provided runner — matches `runReconciliation` from the runner module. */
export type ReconciliationRunner = (opts: {
  projectId: string;
}) => Promise<ReconciliationResult>;

/**
 * Per-instance configuration. Everything except the runner + projectId is
 * optional so production callers can stay terse and tests can override
 * every seam.
 */
export interface AutoTriggerConfig {
  /** Active project. Used by the runner + audit record. */
  projectId: string;
  /** The reconciliation runner. Injected so tests can stub it. */
  runner: ReconciliationRunner;
  /** Persists the audit record. Async; failures are swallowed. */
  writeAuditFn?: WriteAuditFn;
  /** Minimum gap between consecutive runs (defaults to `MIN_INTERVAL_MS`). */
  minIntervalMs?: number;
  /** Debounce window for the `window.online` event (defaults to 5s). */
  onlineDebounceMs?: number;
  /**
   * Override for `Date.now()` — used by tests so they don't have to mock
   * the global. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Storage override — used by tests in a node environment without
   * `localStorage`. Defaults to `globalThis.localStorage` when available.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /**
   * Optional error sink — surfaces audit + runner failures without
   * stopping execution. Defaults to a no-op so the trigger never spams
   * the console in production.
   */
  onError?: (where: 'runner' | 'audit', err: unknown) => void;
  /**
   * RNG override for the run id. Tests pass a deterministic factory so
   * the audit record can be asserted on. Defaults to `crypto.randomUUID`
   * when available, falling back to a timestamp-based id.
   */
  generateRunId?: () => string;
}

/** Handle returned by `installReconciliationAutoTrigger`. */
export interface AutoTriggerHandle {
  /** Force a run immediately (manual trigger). Honors the rate-limit guard. */
  triggerNow: () => Promise<ReconciliationStats>;
  /** Tear down both window listeners. Safe to call multiple times. */
  dispose: () => void;
}

function defaultRunId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveStorage(
  override: AutoTriggerConfig['storage'],
): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (override !== undefined) return override;
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: Storage }).localStorage) {
      return (globalThis as { localStorage: Storage }).localStorage;
    }
  } catch {
    // Some environments throw on `localStorage` access (Safari private mode).
  }
  return null;
}

/**
 * Read the last-run timestamp from storage. Returns `null` when storage is
 * missing or the value is malformed (treat both as "no prior run").
 */
function readLastRunAt(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_RUN_STORAGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastRunAt(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  value: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_RUN_STORAGE_KEY, String(value));
  } catch {
    // Quota exceeded / disabled — non-fatal.
  }
}

/**
 * Install the auto-trigger on the provided window-like target. In production
 * this is the real `window`; tests pass a jsdom-less `EventTarget` so the
 * service-level suite can run in the node environment.
 *
 * Returns a handle the caller stores so it can `dispose()` on unmount and
 * `triggerNow()` on user action.
 */
export function installReconciliationAutoTrigger(
  config: AutoTriggerConfig,
  target: EventTarget = (globalThis as { window?: EventTarget }).window ?? globalThis,
): AutoTriggerHandle {
  if (typeof config?.projectId !== 'string' || config.projectId.length === 0) {
    throw new Error('installReconciliationAutoTrigger: projectId is required');
  }
  if (typeof config.runner !== 'function') {
    throw new Error('installReconciliationAutoTrigger: runner is required');
  }

  const now = config.now ?? (() => Date.now());
  const minIntervalMs = config.minIntervalMs ?? MIN_INTERVAL_MS;
  const onlineDebounceMs = config.onlineDebounceMs ?? ONLINE_DEBOUNCE_MS;
  const storage = resolveStorage(config.storage);
  const onError = config.onError ?? (() => {});
  const generateRunId = config.generateRunId ?? defaultRunId;

  let onlineDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<ReconciliationStats> | null = null;
  let disposed = false;

  function emitStats(stats: ReconciliationStats): void {
    try {
      const evt =
        typeof CustomEvent === 'function'
          ? new CustomEvent<ReconciliationStats>(RECONCILIATION_STATS_EVENT, { detail: stats })
          : ({ type: RECONCILIATION_STATS_EVENT, detail: stats } as unknown as Event);
      target.dispatchEvent(evt);
    } catch {
      // Dispatch should never throw in production environments, but a
      // synthetic test target without CustomEvent support should not blow
      // up the run.
    }
  }

  async function executeRun(
    trigger: ReconciliationStats['trigger'],
  ): Promise<ReconciliationStats> {
    if (inflight) {
      const startedAt = now();
      const skipped: ReconciliationStats = {
        runId: generateRunId(),
        startedAt,
        finishedAt: startedAt,
        trigger,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        failures: [],
        skipped: true,
        skippedReason: 'already_running',
      };
      emitStats(skipped);
      return skipped;
    }

    const startedAt = now();
    const lastRunAt = readLastRunAt(storage);
    if (lastRunAt != null && startedAt - lastRunAt < minIntervalMs) {
      const skipped: ReconciliationStats = {
        runId: generateRunId(),
        startedAt,
        finishedAt: startedAt,
        trigger,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        failures: [],
        skipped: true,
        skippedReason: 'rate_limited',
      };
      emitStats(skipped);
      return skipped;
    }

    const runId = generateRunId();

    inflight = (async () => {
      let result: ReconciliationResult;
      try {
        result = await config.runner({ projectId: config.projectId });
      } catch (err) {
        onError('runner', err);
        const finishedAt = now();
        const failedStats: ReconciliationStats = {
          runId,
          startedAt,
          finishedAt,
          trigger,
          attempted: 0,
          succeeded: 0,
          failed: 0,
          failures: [
            {
              sessionId: '<runner>',
              error: err instanceof Error ? err.message : String(err),
            },
          ],
        };
        emitStats(failedStats);
        // Stamp last-run even on runner failure so we don't hammer the
        // runner in a retry storm.
        writeLastRunAt(storage, finishedAt);
        return failedStats;
      }

      const finishedAt = now();
      const stats: ReconciliationStats = {
        runId,
        startedAt,
        finishedAt,
        trigger,
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        failures: result.failures,
      };
      writeLastRunAt(storage, finishedAt);
      emitStats(stats);

      if (config.writeAuditFn) {
        const record: ReconciliationAuditRecord = {
          runId,
          projectId: config.projectId,
          startedAt,
          finishedAt,
          trigger,
          attempted: result.attempted,
          succeeded: result.succeeded,
          failed: result.failed,
          failures: result.failures,
        };
        try {
          await config.writeAuditFn(record);
        } catch (err) {
          onError('audit', err);
        }
      }

      return stats;
    })();

    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  function onOnline(): void {
    if (disposed) return;
    if (onlineDebounceTimer !== null) {
      clearTimeout(onlineDebounceTimer);
    }
    onlineDebounceTimer = setTimeout(() => {
      onlineDebounceTimer = null;
      void executeRun('online').catch((err) => onError('runner', err));
    }, onlineDebounceMs);
  }

  function onFcm(): void {
    if (disposed) return;
    void executeRun('fcm').catch((err) => onError('runner', err));
  }

  target.addEventListener('online', onOnline as EventListener);
  target.addEventListener(RECONCILIATION_FCM_EVENT, onFcm as EventListener);

  return {
    triggerNow: () => executeRun('manual'),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (onlineDebounceTimer !== null) {
        clearTimeout(onlineDebounceTimer);
        onlineDebounceTimer = null;
      }
      target.removeEventListener('online', onOnline as EventListener);
      target.removeEventListener(RECONCILIATION_FCM_EVENT, onFcm as EventListener);
    },
  };
}
