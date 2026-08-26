import * as Sentry from '@sentry/react';
import { useEffect, useState, type ReactElement } from 'react';
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
  // [Hy3-audit 3c4aa66d-73fe-818b-813c-d99c7f46845f 2026-08-25]: the
  // previous code never cleared on retry, so an eventId from 10
  // minutes ago looked like a recent one. Track the time of the
  // last probe so the operator can tell whether the displayed
  // eventId is fresh or stale.
  const [lastProbeAt, setLastProbeAt] = useState<Date | null>(null);

  // Reset the displayed probe state when the variant changes —
  // the operator shouldn't see a "message" eventId next to the
  // "throw" button.
  useEffect(() => {
    setLastEventId(null);
    setLastProbeAt(null);
  }, [variant]);

  const handleClick = () => {
    // [Hy3-audit ... 2026-08-25]: clear the prior id so a new click
    // doesn't stack on a stale one.
    setLastEventId(null);
    setLastProbeAt(new Date());
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
          {/* [Hy3-audit 3c4aa66d-73fe-818b-813c-d99c7f46845f 2026-08-25]:
              surface the probe time so the operator can tell
              whether the displayed eventId is fresh. */}
          {lastProbeAt && (
            <>
              {' · '}
              <time dateTime={lastProbeAt.toISOString()}>
                {lastProbeAt.toLocaleTimeString()}
              </time>
            </>
          )}
        </p>
      )}
    </div>
  );
}
