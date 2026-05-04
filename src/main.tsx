// Initialise i18next BEFORE any component imports below — the
// `useTranslation` hook in `App.tsx` and downstream components needs the
// resource bundles registered, and Sentry's ErrorBoundary fallback
// (rendered if `<App>` throws) also reads `i18n.t(...)`.
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';
import './lib/i18n';
import { initSentry } from './lib/sentry';
import { registerSW } from 'virtual:pwa-register';
import { logger } from './utils/logger';
import { ErrorFallback } from './components/shared/ErrorFallback';

// Init error monitoring before anything else so startup errors are captured
initSentry();

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
