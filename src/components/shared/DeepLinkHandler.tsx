// Sprint 21 — Bucket G: Universal Links (iOS) + App Links (Android).
//
// This component bridges Capacitor's `appUrlOpen` listener (set up in
// `src/main.tsx`, native-platform-only) with the React Router navigation
// stack. The native side dispatches a `praeventio:deep-link` CustomEvent
// carrying the in-app slug; we react to it here by calling `navigate(slug)`.
//
// Why a CustomEvent bridge instead of calling `navigate` directly from
// `main.tsx`? React Router's `useNavigate` is only available *inside* a
// `<BrowserRouter>` — so the listener must live in a component that
// renders inside the router tree. The CustomEvent indirection lets the
// native plugin attach its listener once at boot (before the React tree
// exists) and have its dispatches survive even if this component
// remounts.
//
// Mounted once inside `<BrowserRouter>` in `src/App.tsx`. Renders nothing.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export interface DeepLinkEventDetail {
  /** In-app path + query, e.g. `/sos?lat=-33.4&lng=-70.6`. */
  url: string;
}

export const DEEP_LINK_EVENT_NAME = 'praeventio:deep-link';

export function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DeepLinkEventDetail>).detail;
      if (!detail || typeof detail.url !== 'string' || detail.url.length === 0) {
        return;
      }
      // The native side may pass an absolute URL by mistake; we only
      // navigate to in-app paths. Strip any accidental scheme/host.
      let path = detail.url;
      try {
        if (/^https?:\/\//i.test(path)) {
          const parsed = new URL(path);
          path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // If URL parsing fails, fall back to the raw string — better to
        // attempt navigation than swallow the event silently.
      }
      navigate(path);
    };

    window.addEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
    };
  }, [navigate]);

  return null;
}
