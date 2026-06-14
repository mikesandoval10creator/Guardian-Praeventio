// Praeventio Guard — OLA 1 (VIDA, 2026-06-14): SOS dead-letter surface.
//
// Completes the offline-SOS story (sosOutboxClient): when a queued SOS exhausts
// its retries it is dead-lettered (retained, never dropped). Without a surface
// the worker would still believe help is coming. This globally-mounted banner
// makes an UNDELIVERED SOS impossible to miss and tells the worker to escalate
// IN PERSON, with an acknowledge action that clears the dead-letter once they
// have done so. Hardcoded es-CL copy (matches GeofenceAlert, an emergency
// banner — no i18n indirection on a life-safety alert).

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  getSosDeadLetters,
  clearSosDeadLetter,
} from '../../services/emergency/sosOutboxClient';
import type { OutboxEntry } from '../../services/emergency/sosOutbox';
import { logger } from '../../utils/logger';

export function SosDeadLetterBanner() {
  const [dead, setDead] = useState<OutboxEntry[]>([]);

  const refresh = useCallback(() => {
    getSosDeadLetters()
      .then(setDead)
      .catch((err) => logger.warn('SosDeadLetterBanner: load failed', { err: String(err) }));
  }, []);

  useEffect(() => {
    refresh();
    // Re-check periodically and right after a reconnect drain (which is when a
    // SOS may transition to dead-lettered after its final failed retry).
    const id = setInterval(refresh, 60_000);
    if (typeof window !== 'undefined') window.addEventListener('online', refresh);
    return () => {
      clearInterval(id);
      if (typeof window !== 'undefined') window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  const acknowledge = useCallback(
    (clientEventId: string) => {
      clearSosDeadLetter(clientEventId)
        .then(refresh)
        .catch((err) => logger.warn('SosDeadLetterBanner: clear failed', { err: String(err) }));
    },
    [refresh],
  );

  if (dead.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[160] w-[92%] max-w-md space-y-2"
    >
      {dead.map((e) => (
        <div
          key={e.event.clientEventId}
          className="bg-rose-700 text-white p-4 rounded-2xl shadow-2xl shadow-rose-700/50 border-2 border-rose-400"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-7 h-7 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-black uppercase tracking-tight leading-tight">
                Tu alerta SOS NO salió
              </p>
              <p className="text-rose-100 text-sm mt-1">
                No pudimos enviar tu alerta tras varios intentos.{' '}
                <strong>Avisa al supervisor presencialmente ahora.</strong>
              </p>
              <button
                type="button"
                onClick={() => acknowledge(e.event.clientEventId)}
                className="mt-3 bg-white text-rose-700 font-bold px-4 py-2 rounded-xl text-sm active:scale-95 transition-transform"
              >
                Ya avisé presencialmente
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
