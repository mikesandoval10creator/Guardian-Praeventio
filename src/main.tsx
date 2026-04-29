// Initialise i18next BEFORE any component imports below — the
// `useTranslation` hook in `App.tsx` and downstream components needs the
// resource bundles registered, and Sentry's ErrorBoundary fallback
// (rendered if `<App>` throws) also reads `i18n.t(...)`.
import './i18n';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import * as Sentry from '@sentry/react';
import i18n from './i18n';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    // Dispatch a custom event instead of blocking the main thread with confirm()
    window.dispatchEvent(new CustomEvent('pwa-update-available', {
      detail: {
        update: () => updateSW(true)
      }
    }));
  },
  onOfflineReady() {
    console.log('Praeventio Guard está listo para operar sin conexión.');
  },
});

/**
 * Sentry crash boundary fallback (Spanish-CL).
 *
 * Renders when any descendant of `<App>` throws during render and React
 * gives up unmounting the subtree. Shows the eventId so a support engineer
 * can correlate with Sentry issues, and exposes a "Reintentar" button that
 * calls `resetError` to remount the tree without a hard reload.
 *
 * The tree is intentionally framework-light (no Tailwind context, no router):
 * the failure may be in a provider that owns those, so we cannot rely on
 * any styling system being intact. Inline styles only.
 */
function CrashFallback({
  error,
  resetError,
  eventId,
}: {
  error: unknown;
  componentStack: string | null;
  resetError: () => void;
  eventId: string | null;
}) {
  // `error` is `unknown` from Sentry's typings — keep it for diagnostic
  // logging in case the user opens the devtools, but don't render its raw
  // message to the page (could leak PII / stack traces to the user).
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.error('[Praeventio Guard] Fallo no recuperable capturado por Sentry.ErrorBoundary:', error);
  }

  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        backgroundColor: '#09090b',
        color: '#e4e4e7',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '480px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '1rem', letterSpacing: '-0.02em' }}>
          {i18n.t('errors.something_went_wrong', 'Algo salió mal.')}
        </h1>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#a1a1aa', marginBottom: '1.5rem' }}>
          {i18n.t('errors.team_notified', 'Nuestro equipo fue notificado. Por favor recargá la página.')}
        </p>
        {eventId && (
          <p
            style={{
              fontSize: '0.7rem',
              color: '#71717a',
              marginBottom: '1.5rem',
              fontFamily: 'monospace',
            }}
          >
            {i18n.t('errors.event_id', 'ID del evento')}: <span style={{ color: '#a1a1aa' }}>{eventId}</span>
          </p>
        )}
        <button
          type="button"
          onClick={resetError}
          style={{
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.75rem',
            fontWeight: 700,
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {i18n.t('common.retry', 'Reintentar')}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={(props) => (
        <CrashFallback
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
