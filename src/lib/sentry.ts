import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry() {
  if (!dsn) return; // no-op in local dev without DSN

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION ?? 'dev',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Only capture replays when an error occurs — respects worker privacy
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,    // never record normal sessions
    replaysOnErrorSampleRate: 1.0,  // always capture replay on error

    // Strip PII before sending to Sentry
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      // Remove GPS breadcrumbs
      const crumbs = event.breadcrumbs;
      if (crumbs && Array.isArray(crumbs)) {
        event.breadcrumbs = crumbs.map(b => {
          if (b.data && ('lat' in b.data || 'lng' in b.data || 'latitude' in b.data)) {
            return { ...b, data: { ...b.data, lat: '[scrubbed]', lng: '[scrubbed]', latitude: '[scrubbed]', longitude: '[scrubbed]' } };
          }
          return b;
        });
      }
      return event;
    },
  });
}

/** Call in safety-critical catch blocks to guarantee the error is captured. */
export function captureEmergencyError(error: unknown, context: Record<string, string>) {
  Sentry.withScope(scope => {
    scope.setTag('domain', 'safety_critical');
    Object.entries(context).forEach(([k, v]) => scope.setTag(k, v));
    Sentry.captureException(error);
  });
}
