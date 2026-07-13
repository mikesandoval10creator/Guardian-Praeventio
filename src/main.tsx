// Initialise i18next BEFORE any component imports below — the
// `useTranslation` hook in `App.tsx` and downstream components needs the
// resource bundles registered, and Sentry's ErrorBoundary fallback
// (rendered if `<App>` throws) also reads `i18n.t(...)`.
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import './index.css';
import './lib/i18n';
import { initSentry } from './lib/sentry';
import { installOfflineRejectionGuard } from './lib/offlineErrorGuard';
import { registerSW } from 'virtual:pwa-register';
import { logger } from './utils/logger';
import { ErrorFallback } from './components/shared/ErrorFallback';
import { DEEP_LINK_EVENT_NAME } from './components/shared/DeepLinkHandler';

// Neutralise the benign "Firestore read while offline" unhandled rejection
// BEFORE Sentry attaches its own global handler (see offlineErrorGuard.ts).
// Offline is an expected operating state for a field-safety PWA, so this must
// not surface as an error in the console or Sentry.
installOfflineRejectionGuard((code) =>
  logger.debug('Suppressed benign offline Firestore read rejection', { code }),
);

// Init error monitoring before anything else so startup errors are captured
initSentry();

// Sprint 21 — Bucket G: Universal Links (iOS) / App Links (Android).
//
// On native platforms, register a Capacitor `appUrlOpen` listener that
// fires when the OS hands an `https://praeventio.app/...` URL to the app
// (because the AASA / assetlinks.json association is verified). We
// translate the absolute URL into an in-app slug and dispatch a
// `praeventio:deep-link` CustomEvent — the `<DeepLinkHandler>` component
// (mounted inside `<BrowserRouter>` in `App.tsx`) listens for it and
// calls React Router's `navigate(slug)`. We can't call `useNavigate`
// here because we're outside the React tree; the CustomEvent bridge is
// the cleanest way across that boundary.
// Sprint 30 Bucket LL — first-launch redirect to /demo on native platforms
// when the user has no Firebase Auth token cached. This means a fresh
// install Day-1 lands on the public demo instead of a blank login screen.
// We use localStorage 'praeventio:has-launched' as the trip flag so subsequent
// launches resume normally even before sign-in.
if (Capacitor.isNativePlatform()) {
  try {
    const launched = localStorage.getItem('praeventio:has-launched');
    if (!launched && typeof window !== 'undefined' &&
        window.location.pathname === '/' && !window.location.search.includes('demo=true')) {
      localStorage.setItem('praeventio:has-launched', String(Date.now()));
      // History replace so back-button doesn't return to '/'.
      window.history.replaceState({}, '', '/demo');
    }
  } catch {
    /* swallow — first-launch redirect must never block bootstrap */
  }
}

if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener('appUrlOpen', (event) => {
    try {
      // event.url example: 'https://praeventio.app/sos?lat=-33.4&lng=-70.6'.
      // Use URL parsing so we get pathname+search+hash even if the host
      // changes (staging domain, custom dev tunnel, etc.).
      const parsed = new URL(event.url);
      const slug = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
      window.dispatchEvent(
        new CustomEvent(DEEP_LINK_EVENT_NAME, { detail: { url: slug } }),
      );
    } catch (err) {
      logger.warn('appUrlOpen: failed to parse incoming URL', {
        url: event.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }).catch((err) => {
    logger.warn('appUrlOpen: failed to register listener', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

const updateSW = registerSW({
  onNeedRefresh() {
    // Dispatch a custom event instead of blocking the main thread with confirm()
    window.dispatchEvent(new CustomEvent('pwa-update-available', {
      detail: {
        update: () => updateSW(true),
      },
    }));
  },
  onOfflineReady() {
    logger.debug('Praeventio Guard está listo para operar sin conexión.');
  },
});

// 12th wave — lifecycle analytics. Module-level state so the diff between
// `app.opened` and `app.backgrounded` is reliable across StrictMode's
// double-invocation and any future re-mounts. Dynamic import keeps the
// analytics module off the critical path: if it fails to load, bootstrap
// continues unaffected.
let appOpenedAt: number | null = null;
let appOpenedFired = false;

/**
 * Detect launch kind (cold / warm / pwa_resume) at first mount.
 *
 *  - `pwa_resume`  → installed PWA (display-mode: standalone or minimal-ui).
 *  - `warm`        → page restored from bfcache or `performance.navigation.type === 2`
 *                    (back/forward navigation).
 *  - `cold`        → everything else (fresh navigation, reload, fallback).
 */
function detectBootKind(): 'cold' | 'warm' | 'pwa_resume' {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        // iOS Safari uses a non-standard navigator.standalone flag.
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isStandalone) return 'pwa_resume';
    }
  } catch {
    /* matchMedia may be unavailable in test environments */
  }
  // Modern Navigation Timing Level 2: PerformanceNavigationTiming.type
  // ('navigate' | 'reload' | 'back_forward' | 'prerender'). Fall back to
  // the legacy `performance.navigation` shape for older browsers.
  try {
    const entries =
      typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('navigation')
        : [];
    const nav = entries[0] as (PerformanceNavigationTiming & { type?: string }) | undefined;
    if (nav?.type === 'back_forward') return 'warm';
    const legacy = (performance as unknown as { navigation?: { type?: number } }).navigation;
    if (legacy?.type === 2) return 'warm';
  } catch {
    /* swallow — analytics MUST NOT break bootstrap */
  }
  return 'cold';
}

async function fireAppOpened(): Promise<void> {
  if (appOpenedFired) return;
  appOpenedFired = true;
  appOpenedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const { analytics } = await import('./services/analytics');
    analytics.track('app.opened', { boot_kind: detectBootKind() });
  } catch {
    /* swallow — lifecycle telemetry must never block first paint */
  }
}

async function fireAppBackgrounded(): Promise<void> {
  if (appOpenedAt === null) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const foreground_duration_seconds = Math.max(0, Math.round((now - appOpenedAt) / 1000));
  // Reset the start so subsequent visibility cycles measure fresh foreground time.
  appOpenedAt = null;
  try {
    const { analytics } = await import('./services/analytics');
    analytics.track('app.backgrounded', { foreground_duration_seconds });
  } catch {
    /* swallow */
  }
}

if (typeof document !== 'undefined') {
  // Visibility transitions are the closest cross-browser signal for
  // "user moved away from the tab/app" — `pagehide` is mobile-Safari-only,
  // and `beforeunload` doesn't fire on mobile. visibilitychange covers both.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void fireAppBackgrounded();
    } else if (!appOpenedFired) {
      // Edge case: SW pre-rendered the document while hidden, then it
      // becomes visible. Treat that first visible moment as the open.
      void fireAppOpened();
    } else {
      // Foreground re-entry — restart the foreground timer so the next
      // backgrounded event reports time-since-resume rather than the
      // stale pre-hide timestamp.
      appOpenedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  });
}

// Fire `app.opened` once on first bootstrap. Don't await — analytics is
// fire-and-forget and React rendering must not block on it.
void fireAppOpened();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={(props) => (
        <ErrorFallback
          error={props.error}
          componentStack={props.componentStack ?? null}
          resetError={props.resetError}
          eventId={props.eventId ?? null}
        />
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
