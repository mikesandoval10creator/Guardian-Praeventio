// Sprint 20 tenth wave (Bucket Perf C — Fase 5): defer the heavy
// `AsesorChat` widget out of the main bundle. The widget pulls
// `react-markdown` + `framer-motion` motion + the SLM/Gemini orchestrator
// graph; mounting it eagerly inside `RootLayout` shipped all of that to
// the first paint. This wrapper:
//
//   1. Registers a global `open-ai-chat` event listener so the toolbar
//      search button still triggers the chat the very first time.
//   2. Schedules `requestIdleCallback` (with a 3 s setTimeout fallback)
//      to mount the lazy chunk in the background, so by the time the
//      user actually reaches for the chat the chunk is already cached.
//   3. Hands off to the real `AsesorChat` component once mounted; it
//      installs its own listener and replays the queued event.
//
// Behavioural parity with the eager component: when `open-ai-chat` fires
// before the chunk is ready, we mount immediately and re-dispatch the
// event so the chat opens with the same `detail.query` payload.
//
// B14 (2026-06-11): the lazy chunk is now `AsesorChatRouter` — the
// feature-flag router that mounts the RESILIENT assistant by default
// (5-tier orchestrator: Gemini online-primary → on-device SLM → RAG →
// honest fallback) and keeps the legacy `AsesorChat` as explicit
// opt-out (`praeventio:asesor:legacy-optout:v2`). Before this change
// the router existed but was never mounted — RootLayout loaded the
// legacy chat directly, so the resilient pipeline never reached users.
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const AsesorChat = lazy(() =>
  import('./AsesorChatRouter').then((m) => ({ default: m.AsesorChatRouter })),
);

// `requestIdleCallback` / `cancelIdleCallback` come from the DOM lib — the
// types are declared as required globals in TS 5.x, even though Safari
// historically lacks support. Guard with a runtime `typeof` check below.
type IdleCallbackHandle = number;

export function AsesorChatLazy(): React.ReactElement | null {
  const [shouldMount, setShouldMount] = useState(false);
  // Buffer for the first event that arrives before the chunk loads — we
  // re-dispatch it once `AsesorChat` is mounted so its own listener picks
  // it up exactly as before.
  const pendingEventRef = useRef<CustomEvent | null>(null);

  useEffect(() => {
    if (shouldMount) return undefined;

    const handleOpen = (e: Event) => {
      pendingEventRef.current = e as CustomEvent;
      setShouldMount(true);
    };

    window.addEventListener('open-ai-chat', handleOpen);

    // Schedule background load so the chunk is warm before the user
    // clicks. `requestIdleCallback` is supported in Chrome/Edge; Safari
    // falls through to the timeout path.
    let idleHandle: IdleCallbackHandle | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const trigger = () => setShouldMount(true);

    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => IdleCallbackHandle;
    }).requestIdleCallback;
    const cic = (window as Window & {
      cancelIdleCallback?: (h: IdleCallbackHandle) => void;
    }).cancelIdleCallback;
    if (typeof ric === 'function') {
      idleHandle = ric(trigger, { timeout: 3000 });
    } else {
      timeoutHandle = setTimeout(trigger, 3000);
    }

    return () => {
      window.removeEventListener('open-ai-chat', handleOpen);
      if (idleHandle !== undefined && typeof cic === 'function') {
        cic(idleHandle);
      }
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [shouldMount]);

  // Once `AsesorChat` is mounted, replay any event captured during the
  // load gap so the chat opens with the original query.
  useEffect(() => {
    if (!shouldMount) return;
    const evt = pendingEventRef.current;
    if (!evt) return;
    pendingEventRef.current = null;
    // Defer to next tick so AsesorChat has time to register its listener.
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent('open-ai-chat', { detail: evt.detail }),
      );
    });
  }, [shouldMount]);

  if (!shouldMount) return null;

  return (
    <Suspense fallback={null}>
      <AsesorChat />
    </Suspense>
  );
}
