// Sprint 20 — Bucket Nu — Wire-up
//
// `<SLMProvider>` exposes the on-device Small Language Model status to
// the rest of the React tree without coupling individual screens to the
// underlying services (`slmAdapter`, `offlineQueue`, the Comlink worker).
//
// Three pieces of state surface through the context:
//
//   1. `isOnline`          — reactive mirror of `navigator.onLine`.
//      The orchestrator already reads this signal directly, but UI
//      components need it as React state so they can re-render banners,
//      disable AI buttons, etc. without polling.
//
//   2. `pendingCount`      — number of `{query, response}` records the
//      offline queue is holding for later reconciliation. Polled every
//      30 seconds while the provider is mounted, and updated immediately
//      in response to a `gp-slm-enqueued` window event so consumers see
//      the badge tick up the moment a new offline session is captured
//      (without waiting for the next poll tick).
//
//   3. `activeModelId`     — id of the model the worker is currently
//      bound to (`null` when no model is loaded). Read from
//      `slmAdapter.getActiveModelId()` after every `ensureReady()` call
//      so consumers can render a "running on Phi-3 Mini" badge.
//
// Why a custom event for enqueue? `offlineQueue.enqueueSession()` does
// not (yet) emit anything itself — see `src/services/slm/offlineQueue.ts`.
// The contract here is forward-looking: any caller that enqueues an
// offline session should fire `window.dispatchEvent(new CustomEvent(
// 'gp-slm-enqueued'))` so this provider refreshes the count immediately.
// The 30s poll is the fallback for callers that haven't been migrated.
//
// What this provider deliberately does NOT do:
//   - It does not run inference. Components import `ask()` / `complete()`
//     from `services/slm` directly and use the context only for UI state.
//   - It does not auto-trigger reconciliation when the network returns.
//     That is `reconciliation.ts`' contract; the provider only reflects
//     pending count, leaving the orchestration choice to call sites.
//   - It does not own the model picker UI. That's `<SLMModelPicker>`.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Sprint 54 perf — dynamic imports for the SLM adapter + offlineQueue.
// These modules pull in `loader.ts` + `workerProxy.ts` (Comlink boot,
// ONNX Runtime Web glue) and previously dragged ~200 KB of dependency
// graph into the cold-start chunk even on /login and /landing where
// the user hasn't even consented to AI features. Loading them on
// demand defers the cost until the first AI feature is actually used.
type SlmAdapterModule = typeof import('../../services/slm/slmAdapter');
type OfflineQueueModule = typeof import('../../services/slm/offlineQueue');

let slmAdapterPromise: Promise<SlmAdapterModule> | null = null;
let offlineQueuePromise: Promise<OfflineQueueModule> | null = null;

async function getSlmAdapter(): Promise<SlmAdapterModule> {
  if (!slmAdapterPromise) {
    slmAdapterPromise = import('../../services/slm/slmAdapter');
  }
  return slmAdapterPromise;
}

async function getOfflineQueue(): Promise<OfflineQueueModule> {
  if (!offlineQueuePromise) {
    offlineQueuePromise = import('../../services/slm/offlineQueue');
  }
  return offlineQueuePromise;
}

/**
 * Window-level event that signals a new offline session has just been
 * persisted by `offlineQueue.enqueueSession`. Consumers that enqueue
 * sessions should fire this event so the provider refreshes the count
 * without waiting for the next poll tick.
 */
export const SLM_ENQUEUED_EVENT = 'gp-slm-enqueued';

/**
 * How frequently we re-read the offline queue when no `gp-slm-enqueued`
 * event has fired. Conservative — the queue is a small IndexedDB read,
 * but doing it on every render or every second is wasted work for a UI
 * that mostly just shows "0 consultas en cola".
 */
const POLL_INTERVAL_MS = 30_000;

export interface SLMContextValue {
  /** Mirror of `navigator.onLine`, reactive across online/offline events. */
  isOnline: boolean;
  /** Count of offline sessions waiting for reconciliation. */
  pendingCount: number;
  /** Currently-loaded model id, or `null` if none. */
  activeModelId: string | null;
  /**
   * Idempotent worker boot. Wraps `slmAdapter.ensureSlmReady()` and
   * refreshes `activeModelId` afterwards so consumers see the new id.
   */
  ensureReady: () => Promise<void>;
  /** Force a re-read of the pending queue. Idempotent. */
  refreshPending: () => Promise<void>;
}

const SLMContext = createContext<SLMContextValue | null>(null);

/**
 * Hook accessor. Throws if used outside `<SLMProvider>` — same contract
 * as `useAppMode`, `useTheme` etc. across this codebase.
 */
export function useSLM(): SLMContextValue {
  const ctx = useContext(SLMContext);
  if (!ctx) {
    throw new Error('useSLM must be used inside <SLMProvider>');
  }
  return ctx;
}

/**
 * Read `navigator.onLine` defensively. Treated as "online" when
 * `navigator` is unavailable (SSR / node tests without jsdom).
 */
function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export interface SLMProviderProps {
  children: ReactNode;
}

export function SLMProvider({ children }: SLMProviderProps): React.ReactElement {
  const [isOnline, setIsOnline] = useState<boolean>(() => readOnline());
  const [pendingCount, setPendingCount] = useState<number>(0);
  // Sprint 54 perf: defer reading the active model id until the adapter
  // module is dynamically imported. Initial render gets `null` so the
  // critical path never touches the worker proxy.
  const [activeModelId, setActiveModelId] = useState<string | null>(null);

  // Track mounted state so we don't `setState` after an unmount when the
  // 30s poll resolves. Critical because `listPending()` opens an
  // IndexedDB transaction that can outlive a fast unmount in tests.
  const mountedRef = useRef(true);

  /** Read the queue and push the count into state. Errors are swallowed
   *  — if IDB is unavailable (private mode, quota), the count just stays
   *  at its previous value rather than crashing the shell. */
  const refreshPending = useCallback(async (): Promise<void> => {
    try {
      const { listPending } = await getOfflineQueue();
      const pending = await listPending();
      if (!mountedRef.current) return;
      setPendingCount(pending.length);
    } catch {
      // Non-fatal — leave the existing count.
    }
  }, []);

  /** Wraps `ensureSlmReady` and syncs the cached active model id. */
  const ensureReady = useCallback(async (): Promise<void> => {
    const adapter = await getSlmAdapter();
    await adapter.ensureSlmReady();
    if (!mountedRef.current) return;
    setActiveModelId(adapter.getActiveModelId());
  }, []);

  // online/offline tracking. Fires synchronously on browser events.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = (): void => setIsOnline(readOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Initial read + 30s poll + enqueue-event-driven refresh.
  useEffect(() => {
    mountedRef.current = true;
    void refreshPending();

    const interval = setInterval(() => {
      void refreshPending();
    }, POLL_INTERVAL_MS);

    const onEnqueued = (): void => {
      void refreshPending();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(SLM_ENQUEUED_EVENT, onEnqueued);
    }

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener(SLM_ENQUEUED_EVENT, onEnqueued);
      }
    };
  }, [refreshPending]);

  const value: SLMContextValue = {
    isOnline,
    pendingCount,
    activeModelId,
    ensureReady,
    refreshPending,
  };

  return <SLMContext.Provider value={value}>{children}</SLMContext.Provider>;
}

export default SLMProvider;
