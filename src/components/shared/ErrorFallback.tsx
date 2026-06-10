import i18n from '../../i18n';

/**
 * Props mirror the shape supplied by `Sentry.ErrorBoundary`'s render fn:
 *   { error, componentStack, resetError, eventId }
 *
 * Sentry's typings mark `error` as `unknown` (could be any thrown value,
 * not just `Error`), so we accept the same. We only render `eventId` —
 * the raw error message stays in the console because it can leak PII or
 * stack traces a worker shouldn't see.
 *
 * Why inline styles instead of Tailwind?
 *   This component renders when `<App>` (or any provider it owns) has
 *   thrown during render. Tailwind context is fine in practice, but the
 *   class registry might not be initialised on the very first paint — and
 *   a fallback that itself fails defeats the purpose. Inline styles have
 *   zero dependencies and survive any provider state.
 */
export interface ErrorFallbackProps {
  error?: unknown;
  componentStack?: string | null;
  resetError?: () => void;
  eventId?: string | null;
}

export function ErrorFallback({ error, resetError, eventId }: ErrorFallbackProps) {
  // Diagnostic aid for devs — never rendered to the page.
  if (typeof console !== 'undefined' && error !== undefined) {

    console.error('[Praeventio Guard] Unrecoverable render error:', error);
  }

  return (
    <main
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
      <div role="alert" style={{ maxWidth: '480px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '1rem', letterSpacing: '-0.02em' }}>
          {i18n.t('errors.unexpected', 'Algo salió mal. El equipo fue notificado.')}
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
        {resetError && (
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
        )}
      </div>
    </main>
  );
}

export default ErrorFallback;
