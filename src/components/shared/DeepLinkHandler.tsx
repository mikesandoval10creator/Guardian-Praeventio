// Sprint 21 — Bucket G: Universal Links (iOS) + App Links (Android).
//
// This component bridges deep-link sources with the React Router navigation
// stack. Two sources feed it, both landing on the same `navigate(path)`:
//   1. Capacitor's `appUrlOpen` listener and the native push-action bridge (both
//      installed in `src/main.tsx`) dispatch a `praeventio:deep-link` event.
//   2. Tapped WEB push notifications: the service worker
//      (public/firebase-messaging-sw.js) `notificationclick` handler focuses
//      the app tab and `postMessage`s the same `{type,url}` payload; we
//      forward it through the same bridge instead of a full reload.
//
// Why a CustomEvent bridge instead of calling `navigate` directly from
// `main.tsx`? React Router's `useNavigate` is only available *inside* a
// `<BrowserRouter>` — so the listener must live in a component that
// renders inside the router tree. The bridge also buffers early events until
// the lazy component mounts, preventing cold-start pushes from disappearing.
//
// Mounted once inside `<BrowserRouter>` in `src/App.tsx`. Renders nothing.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  dispatchDeepLink,
  DEEP_LINK_EVENT_NAME,
  registerDeepLinkListener,
  type DeepLinkEventDetail,
} from '../../services/notifications/deepLinkBridge';

export { DEEP_LINK_EVENT_NAME };
export type { DeepLinkEventDetail };

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
    const handler = (detail: DeepLinkEventDetail) => {
      navigate(toInAppPath(detail.url));
    };

    return registerDeepLinkListener(handler);
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
      dispatchDeepLink({ url: data.url });
    };
    sw.addEventListener('message', handler);
    return () => sw.removeEventListener('message', handler);
  }, [navigate]);

  return null;
}
