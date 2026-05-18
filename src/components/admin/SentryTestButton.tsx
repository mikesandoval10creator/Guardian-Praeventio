import * as Sentry from '@sentry/react';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../shared/Card';

/**
 * Sentry verification button (2026-05-17).
 *
 * Renders only inside admin-gated UI (e.g. Settings → Observability) so a
 * platform operator can confirm the DSN is wired through to Sentry in
 * staging or production. NOT visible in worker/supervisor views.
 *
 * Two variants:
 *   - `throw`   — throws a real `Error` from the click handler. The Sentry
 *                 React `ErrorBoundary` in main.tsx + the global window
 *                 error handler installed by `initSentry()` should capture
 *                 it. Visible immediately as an issue in Sentry.
 *   - `message` — calls `Sentry.captureMessage(..., 'info')`. Useful for
 *                 verifying transport without triggering the ErrorBoundary
 *                 fallback UI.
 *
 * After clicking, check https://praeventio.sentry.io/issues/ within 30s.
 * The event MUST NOT contain email, username, ip_address, or geolocation
 * (the `redactPii` backstop in `src/lib/sentry.ts` strips them before
 * transport — verify in Sentry UI → Event details → User/Request).
 */
export interface SentryTestButtonProps {
  variant?: 'throw' | 'message';
}

export function SentryTestButton({
  variant = 'throw',
}: SentryTestButtonProps): ReactElement {
  const { t } = useTranslation();
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const handleClick = () => {
    const tag = new Date().toISOString();
    if (variant === 'throw') {
      // Intentionally synchronous so React/Sentry ErrorBoundary catches it.
      throw new Error(
        `Sentry verification: error de prueba ${tag} (admin-triggered)`,
      );
    }
    const eventId = Sentry.captureMessage(
      `Sentry verification: mensaje de prueba ${tag} (admin-triggered)`,
      'info',
    );
    setLastEventId(eventId ?? null);
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" onClick={handleClick} data-testid={`sentry-test-${variant}`}>
        {variant === 'throw'
          ? t('settings.observability.test_throw', 'Probar captura de error (lanza excepción)')
          : t('settings.observability.test_message', 'Enviar mensaje de prueba (info-level)')}
      </Button>
      {lastEventId && variant === 'message' && (
        <p className="text-xs text-zinc-500" data-testid="sentry-test-event-id">
          {t('settings.observability.event_sent', 'Evento enviado')}: <code>{lastEventId}</code>
        </p>
      )}
    </div>
  );
}
