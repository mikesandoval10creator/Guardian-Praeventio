// Sprint 21 — Bucket G: Universal Links (iOS) + App Links (Android).
//
// This component bridges deep-link sources with the React Router navigation
// stack. Two sources feed it, both landing on the same `navigate(path)`:
//   1. Capacitor's `appUrlOpen` listener (native Universal/App Links, set up
//      in `src/main.tsx`) — and tapped NATIVE push notifications
//      (usePushNotifications) — dispatch a `praeventio:deep-link` CustomEvent.
//   2. Tapped WEB push notifications: the service worker
//      (public/firebase-messaging-sw.js) `notificationclick` handler focuses
//      the app tab and `postMessage`s the same `{type,url}` payload; we
//      navigate in-SPA instead of a full reload.
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
  /** Project the deep link pertains to, if any (push notifications carry it so
   *  the target screen can detect/realign a project mismatch). Optional. */
  projectId?: string | null;
}

export const DEEP_LINK_EVENT_NAME = 'praeventio:deep-link';

/** Reduce any incoming url to an in-app relative path. The native side (and a
 *  hostile push payload) may pass an absolute URL by mistake; we only navigate
 *  to in-app paths, so strip any scheme/host. */
function toInAppPath(url: string): string {
  try {
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // If URL parsing fails, fall back to the raw string — better to attempt
    // navigation than swallow the event silently.
  }
  return url;
}

export function DeepLinkHandler() {
  const navigate = useNavigate();

  // Source 1: CustomEvent (native App Links + tapped native push).
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DeepLinkEventDetail>).detail;
      if (!detail || typeof detail.url !== 'string' || detail.url.length === 0) {
        return;
      }
      navigate(toInAppPath(detail.url));
    };

    window.addEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(DEEP_LINK_EVENT_NAME, handler as EventListener);
    };
  }, [navigate]);

  // Source 2: service worker postMessage (tapped web push notification).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    // Capture the container so add/remove target the same object even if the
    // property is later reassigned (matters for teardown symmetry).
    const sw = navigator.serviceWorker;
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (
        !data ||
        data.type !== DEEP_LINK_EVENT_NAME ||
        typeof data.url !== 'string' ||
        data.url.length === 0
      ) {
        return;
      }
      navigate(toInAppPath(data.url));
    };
    sw.addEventListener('message', handler);
    return () => sw.removeEventListener('message', handler);
  }, [navigate]);

  return null;
}
