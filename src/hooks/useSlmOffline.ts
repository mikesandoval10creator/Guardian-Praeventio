/**
 * `useSlmOffline` — React hook that wraps the ONNX adapter (Brecha B,
 * Bucket O.3) into a Gemini-fallback policy.
 *
 * Decision rule:
 *   1. `forceSlm === true`               → SLM
 *   2. `navigator.onLine === false`      → SLM
 *   3. otherwise → caller's `online()` first; if it throws, fall back to SLM
 *
 * The hook intentionally does NOT call `/api/ask-guardian` itself — the
 * orchestrator (`services/slm/orchestrator.ts`) already owns that
 * concern. Instead, we accept an `online: (prompt) => Promise<string>`
 * function so AsesorChat can pass `ask` (or any other Gemini-bound
 * function) without us having to import / depend on the Firebase or
 * server-route layers.
 *
 * Status state machine:
 *   `gemini`        — last call was served by the online path
 *   `slm-loading`   — adapter is downloading / initializing the weights
 *   `slm-ready`     — last call was served by the on-device SLM
 *   `unavailable`   — both paths failed (no network AND model not cached)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { OnnxSlmAdapter } from '../services/slm/onnxAdapter';

/**
 * Streaming hook for incremental UI updates. Mirrors
 * `OnnxSlmAdapter.generate#onToken`.
 */
export type SlmOfflineTokenHandler = (token: string) => void;

/** Status transitions surfaced to the UI. */
export type SlmOfflineStatus =
  | 'idle'
  | 'gemini'
  | 'slm-loading'
  | 'slm-ready'
  | 'unavailable';

/** Optional per-call inputs. */
export interface SlmOfflineGenerateOptions {
  /** Forces the SLM path regardless of `navigator.onLine`. */
  forceSlm?: boolean;
  /** Streaming callback (only fires on the SLM path). */
  onToken?: SlmOfflineTokenHandler;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}

/** Public hook contract. */
export interface UseSlmOfflineResult {
  /**
   * Run a single generation. The hook manages backend selection +
   * status transitions. The returned string is the final answer (full
   * text, post-streaming).
   */
  generate: (
    prompt: string,
    opts?: SlmOfflineGenerateOptions,
  ) => Promise<string>;
  /** Current backend / loading state. */
  status: SlmOfflineStatus;
  /** Last error, if any. Cleared on the next successful generate(). */
  error: Error | null;
  /** Pre-load the SLM weights so the first call is instant. */
  warmup: () => Promise<void>;
  /** True when the adapter is constructible (feature flag is on). */
  slmAvailable: boolean;
}

/**
 * Hook inputs. `online` is the Gemini-bound function (typically the
 * orchestrator's `ask`); we leave it injected so the hook stays
 * decoupled from the server-routing layer and unit-testable.
 */
export interface UseSlmOfflineOptions {
  /**
   * Function that calls the online (Gemini) backend. Should resolve
   * with the raw response string, or throw on network / 4xx / 5xx.
   * Required — there's no sensible default we can wire here without
   * pulling Firebase + the orchestrator into the hook's import graph.
   */
  online: (prompt: string) => Promise<string>;
  /**
   * Test override — replaces `OnnxSlmAdapter.fromEnv()`. Production code
   * never sets this; the hook reads `SLM_OFFLINE_ENABLED` itself.
   */
  adapter?: OnnxSlmAdapter | null;
}

/**
 * `useSlmOffline` — see file header for the decision rule and status
 * state machine.
 */
export function useSlmOffline(
  opts: UseSlmOfflineOptions,
): UseSlmOfflineResult {
  // The adapter is held in a ref so we don't re-construct on every
  // render (the ONNX session is heavy — it owns ~600 MB of weights).
  // `null` means the feature flag is off; we treat that branch as
  // "online-only, no fallback" rather than as a hard error.
  const adapterRef = useRef<OnnxSlmAdapter | null>(
    opts.adapter !== undefined ? opts.adapter : OnnxSlmAdapter.fromEnv(),
  );
  const slmAvailable = adapterRef.current !== null;

  const [status, setStatus] = useState<SlmOfflineStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // Allow swapping in a fresh adapter when the test prop changes.
  useEffect(() => {
    if (opts.adapter !== undefined) {
      adapterRef.current = opts.adapter;
    }
  }, [opts.adapter]);

  /**
   * Pre-load the SLM weights. Used by the model-management UI so the
   * first interactive prompt isn't blocked on a 600 MB download.
   */
  const warmup = useCallback(async (): Promise<void> => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    setStatus('slm-loading');
    try {
      await adapter.warmup();
      setStatus('slm-ready');
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setStatus('unavailable');
    }
  }, []);

  const generate = useCallback(
    async (
      prompt: string,
      callOpts: SlmOfflineGenerateOptions = {},
    ): Promise<string> => {
      setError(null);
      const adapter = adapterRef.current;

      // Decide which path to try first.
      const offline =
        callOpts.forceSlm === true ||
        (typeof navigator !== 'undefined' && navigator.onLine === false);

      if (!offline) {
        // Online-first path. If Gemini answers, we're done.
        try {
          const answer = await opts.online(prompt);
          setStatus('gemini');
          return answer;
        } catch (onlineErr) {
          // Online failed — fall through to SLM if we have one.
          if (!adapter) {
            const e =
              onlineErr instanceof Error
                ? onlineErr
                : new Error(String(onlineErr));
            setError(e);
            setStatus('unavailable');
            throw e;
          }
          // Otherwise, drop into the offline branch below.
        }
      }

      // SLM path (chosen by policy or as a fallback after online failed).
      if (!adapter) {
        const e = new Error('SLM offline disabled and online path unavailable');
        setError(e);
        setStatus('unavailable');
        throw e;
      }

      try {
        if (!adapter.isLoaded()) {
          setStatus('slm-loading');
          await adapter.loadModel();
        }
        const text = await adapter.generate({
          prompt,
          onToken: callOpts.onToken,
          signal: callOpts.signal,
        });
        setStatus('slm-ready');
        return text;
      } catch (slmErr) {
        const e =
          slmErr instanceof Error ? slmErr : new Error(String(slmErr));
        setError(e);
        setStatus('unavailable');
        throw e;
      }
    },
    [opts],
  );

  return { generate, status, error, warmup, slmAvailable };
}
