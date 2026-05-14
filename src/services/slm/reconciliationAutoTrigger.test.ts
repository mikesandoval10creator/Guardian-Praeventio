/**
 * Service-level tests for `reconciliationAutoTrigger.ts`.
 *
 * Runs in the node environment (no `// @vitest-environment jsdom` pragma).
 * We use a plain `EventTarget` as the trigger target so the suite stays
 * independent of jsdom / global window, matching how the rest of the SLM
 * service suite tests are written.
 *
 * Scenarios:
 *   1. `online` event triggers a run (after the debounce elapses).
 *   2. Three rapid `online` events collapse into a single run (debounce).
 *   3. FCM event triggers a run synchronously (no debounce).
 *   4. localStorage timestamp prevents a second run within `minIntervalMs`.
 *   5. The trigger emits `gp-slm-reconciliation-stats` with the run payload.
 *   6. Audit log writer is called with the canonical record shape.
 *   7. Runner failure surfaces a failed-stats event without re-throwing.
 *   8. `dispose()` detaches both window listeners.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installReconciliationAutoTrigger,
  LAST_RUN_STORAGE_KEY,
  MIN_INTERVAL_MS,
  ONLINE_DEBOUNCE_MS,
  RECONCILIATION_FCM_EVENT,
  RECONCILIATION_STATS_EVENT,
  type ReconciliationAuditRecord,
  type ReconciliationStats,
} from './reconciliationAutoTrigger';
import type { ReconciliationResult } from './reconciliation';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { clear: () => void } {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    clear: () => map.clear(),
  };
}

function makeResult(overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reconciliationAutoTrigger — installReconciliationAutoTrigger', () => {
  it('fires the runner after the online debounce elapses', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => makeResult({ attempted: 2, succeeded: 2 }));

    const handle = installReconciliationAutoTrigger(
      {
        projectId: 'proj-1',
        runner,
        storage,
        now: () => Date.now(),
        generateRunId: () => 'run-online-1',
      },
      target,
    );

    target.dispatchEvent(new Event('online'));
    expect(runner).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ONLINE_DEBOUNCE_MS + 10);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith({ projectId: 'proj-1' });

    handle.dispose();
  });

  it('coalesces three rapid online events into a single run', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => makeResult({ attempted: 1, succeeded: 1 }));

    const handle = installReconciliationAutoTrigger(
      { projectId: 'p', runner, storage, generateRunId: () => 'rid' },
      target,
    );

    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(ONLINE_DEBOUNCE_MS - 1000);
    target.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(ONLINE_DEBOUNCE_MS - 1000);
    target.dispatchEvent(new Event('online'));

    await vi.advanceTimersByTimeAsync(ONLINE_DEBOUNCE_MS + 10);

    expect(runner).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it('triggers immediately on the FCM custom event (no debounce)', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => makeResult({ attempted: 3, succeeded: 3 }));

    const handle = installReconciliationAutoTrigger(
      { projectId: 'p', runner, storage, generateRunId: () => 'rid' },
      target,
    );

    target.dispatchEvent(new CustomEvent(RECONCILIATION_FCM_EVENT));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(runner).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it('skips a second run within the rate-limit interval and emits skipped stats', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => makeResult({ attempted: 1, succeeded: 1 }));

    let clock = 1_000_000;
    const handle = installReconciliationAutoTrigger(
      {
        projectId: 'p',
        runner,
        storage,
        now: () => clock,
        generateRunId: () => `rid-${clock}`,
      },
      target,
    );

    const stats: ReconciliationStats[] = [];
    target.addEventListener(RECONCILIATION_STATS_EVENT, (evt) => {
      stats.push((evt as CustomEvent<ReconciliationStats>).detail);
    });

    await handle.triggerNow();
    expect(runner).toHaveBeenCalledTimes(1);
    // First call wrote the lastRunAt stamp.
    expect(storage.getItem(LAST_RUN_STORAGE_KEY)).toBe(String(clock));

    clock += MIN_INTERVAL_MS - 1000; // still within the rate-limit window
    const secondResult = await handle.triggerNow();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(secondResult.skipped).toBe(true);
    expect(secondResult.skippedReason).toBe('rate_limited');
    expect(stats.at(-1)?.skipped).toBe(true);

    clock += MIN_INTERVAL_MS + 1; // now past the window
    await handle.triggerNow();
    expect(runner).toHaveBeenCalledTimes(2);

    handle.dispose();
  });

  it('dispatches gp-slm-reconciliation-stats with the runner payload', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () =>
      makeResult({
        attempted: 5,
        succeeded: 4,
        failed: 1,
        failures: [{ sessionId: 's-1', error: 'boom' }],
      }),
    );

    const handle = installReconciliationAutoTrigger(
      {
        projectId: 'proj-X',
        runner,
        storage,
        now: () => 42,
        generateRunId: () => 'fixed-run-id',
      },
      target,
    );

    const captured: ReconciliationStats[] = [];
    target.addEventListener(RECONCILIATION_STATS_EVENT, (evt) => {
      captured.push((evt as CustomEvent<ReconciliationStats>).detail);
    });

    const result = await handle.triggerNow();

    expect(result.runId).toBe('fixed-run-id');
    expect(result.attempted).toBe(5);
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ sessionId: 's-1', error: 'boom' }]);
    expect(result.trigger).toBe('manual');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(result);

    handle.dispose();
  });

  it('invokes writeAuditFn with the canonical audit record shape', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () =>
      makeResult({
        attempted: 2,
        succeeded: 1,
        failed: 1,
        failures: [{ sessionId: 'x', error: 'why' }],
      }),
    );
    const audit = vi.fn(async (_record: ReconciliationAuditRecord) => {});

    const handle = installReconciliationAutoTrigger(
      {
        projectId: 'tenantless-project',
        runner,
        storage,
        writeAuditFn: audit,
        now: () => 999,
        generateRunId: () => 'run-Z',
      },
      target,
    );

    await handle.triggerNow();

    expect(audit).toHaveBeenCalledTimes(1);
    const record = audit.mock.calls[0][0];
    expect(record).toMatchObject({
      runId: 'run-Z',
      projectId: 'tenantless-project',
      startedAt: 999,
      finishedAt: 999,
      trigger: 'manual',
      attempted: 2,
      succeeded: 1,
      failed: 1,
      failures: [{ sessionId: 'x', error: 'why' }],
    });

    handle.dispose();
  });

  it('surfaces runner failures via a failed-stats event without throwing', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => {
      throw new Error('runner exploded');
    });
    const onError = vi.fn();

    const handle = installReconciliationAutoTrigger(
      {
        projectId: 'p',
        runner,
        storage,
        onError,
        generateRunId: () => 'rid',
      },
      target,
    );

    const captured: ReconciliationStats[] = [];
    target.addEventListener(RECONCILIATION_STATS_EVENT, (evt) => {
      captured.push((evt as CustomEvent<ReconciliationStats>).detail);
    });

    const result = await handle.triggerNow();
    expect(result.failures).toEqual([
      { sessionId: '<runner>', error: 'runner exploded' },
    ]);
    expect(onError).toHaveBeenCalledWith('runner', expect.any(Error));
    expect(captured).toHaveLength(1);

    handle.dispose();
  });

  it('dispose detaches both window listeners', async () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const runner = vi.fn(async () => makeResult({ attempted: 1, succeeded: 1 }));

    const handle = installReconciliationAutoTrigger(
      { projectId: 'p', runner, storage, generateRunId: () => 'rid' },
      target,
    );

    handle.dispose();

    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(new CustomEvent(RECONCILIATION_FCM_EVENT));
    await vi.advanceTimersByTimeAsync(ONLINE_DEBOUNCE_MS + 100);

    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects construction without projectId or runner', () => {
    expect(() =>
      installReconciliationAutoTrigger(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { projectId: '', runner: vi.fn() as any },
        new EventTarget(),
      ),
    ).toThrow(/projectId/);
    expect(() =>
      installReconciliationAutoTrigger(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { projectId: 'p', runner: undefined as any },
        new EventTarget(),
      ),
    ).toThrow(/runner/);
  });
});
