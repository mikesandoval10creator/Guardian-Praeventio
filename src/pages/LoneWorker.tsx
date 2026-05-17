// Praeventio Guard — Sprint mobile FGS: LoneWorker page wrapper.
//
// Surface page for the lone-worker check-in flow. Cierra el último eslabón
// del flujo G.11 (servicio + adapter + card existían pero la página
// navegable faltaba). Esta página:
//
//   1. Muestra un breve resumen del estado: si hay sesión activa
//      `LoneWorkerCard` (riusing el componente existente) se renderiza
//      con un mock minimal — el estado autoritativo vive en Firestore y
//      será conectado en una ola posterior; el foco de esta page es la
//      INTEGRACIÓN DEL FOREGROUND SERVICE ANDROID.
//
//   2. Activa el foreground service nativo Android al entrar a la página
//      (start) y lo detiene al desmontar (stop). Esto garantiza que,
//      mientras el trabajador esté en la pantalla de check-in solitario,
//      Android mantenga la notificación persistente "Guardian Activo —
//      Protegiendo tu vida" y el proceso vivo aún si la WebView se
//      hiberna.
//
//   3. Es no-op sin errores en web/iOS (el wrapper hace la guard).
//
// El estado UI (botón START / STOP) refleja `isRunning()` del wrapper;
// los callers más sofisticados (la integración real con `loneWorkerService`
// + cloud function de escalamiento) montarán este page con una sesión
// real venidera. Hoy basta con el ciclo on-mount / on-unmount.

import { useEffect, useState, useCallback } from 'react';
import { Shield, Power, PauseCircle } from 'lucide-react';
import { LoneWorkerCard } from '../components/loneWorker/LoneWorkerCard';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  startLoneWorkerFgs,
  stopLoneWorkerFgs,
  isRunning,
  isAndroidNative,
} from '../services/mobile/foregroundServiceClient';
import type { LoneWorkerSession } from '../services/loneWorker/loneWorkerService';

const DEFAULT_INTERVAL_MIN = 15;

export function LoneWorker() {
  const { user } = useFirebase();
  const workerUid = user?.uid ?? 'anonymous';
  const [fgsActive, setFgsActive] = useState<boolean>(false);
  const [fgsMessage, setFgsMessage] = useState<string>('');

  /**
   * Boot the FGS whenever the user lands on this page and tear it down
   * when they leave. We keep it intentionally simple: the page presence
   * itself is the lone-worker session boundary. A future sprint will
   * swap this for a Firestore-driven session (session.startedAt /
   * endedAt) so the FGS survives accidental tab swaps.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await startLoneWorkerFgs({
        workerUid,
        checkInIntervalSec: DEFAULT_INTERVAL_MIN * 60,
      });
      if (cancelled) return;
      setFgsActive(isRunning());
      setFgsMessage(
        r.applied
          ? `FGS ${r.reason}.`
          : r.reason === 'not_native'
            ? 'Plataforma web — foreground service no aplica.'
            : r.reason === 'no_plugin'
              ? 'Plugin no disponible en este build.'
              : `FGS error: ${r.error ?? 'desconocido'}`,
      );
    })();
    return () => {
      cancelled = true;
      // fire-and-forget; the page is unmounting so we don't await
      void stopLoneWorkerFgs().then(() => {
        setFgsActive(false);
      });
    };
  }, [workerUid]);

  const handleManualStop = useCallback(async () => {
    const r = await stopLoneWorkerFgs();
    setFgsActive(isRunning());
    setFgsMessage(
      r.applied ? 'FGS detenido.' : r.error ?? 'FGS no estaba corriendo.',
    );
  }, []);

  const handleManualStart = useCallback(async () => {
    const r = await startLoneWorkerFgs({
      workerUid,
      checkInIntervalSec: DEFAULT_INTERVAL_MIN * 60,
    });
    setFgsActive(isRunning());
    setFgsMessage(r.applied ? `FGS ${r.reason}.` : `FGS no aplica (${r.reason}).`);
  }, [workerUid]);

  // Mock session usada únicamente para alimentar el card visualmente
  // mientras la conexión con `loneWorkerService` real llega en otra ola.
  const mockSession: LoneWorkerSession = {
    id: `local:${workerUid}`,
    workerUid,
    startedAt: new Date().toISOString(),
    checkInIntervalMin: DEFAULT_INTERVAL_MIN,
    checkIns: [],
    status: 'active',
  };

  return (
    <section
      className="p-4 space-y-4"
      data-testid="loneWorker.page"
      aria-label="Trabajador solitario"
    >
      <header className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-teal-600" aria-hidden="true" />
        <h1 className="text-lg font-bold">Trabajador solitario</h1>
      </header>

      <LoneWorkerCard session={mockSession} status="active" />

      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"
        data-testid="loneWorker.fgs"
      >
        <header className="flex items-center gap-2">
          <Power className={`w-4 h-4 ${fgsActive ? 'text-teal-600' : 'text-slate-400'}`} aria-hidden="true" />
          <h2 className="text-sm font-bold">
            Foreground service {fgsActive ? 'activo' : 'detenido'}
          </h2>
        </header>
        <p className="text-[11px] text-slate-600" data-testid="loneWorker.fgs.message">
          {fgsMessage || 'Iniciando…'}
        </p>
        <p className="text-[11px] text-slate-500">
          Plataforma: {isAndroidNative() ? 'Android nativo' : 'Web / iOS (no-op)'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleManualStart}
            disabled={fgsActive}
            className="rounded-md px-3 py-2 text-xs font-bold bg-teal-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="loneWorker.fgs.start"
          >
            <Power className="w-3 h-3 inline mr-1" aria-hidden="true" /> Iniciar
          </button>
          <button
            type="button"
            onClick={handleManualStop}
            disabled={!fgsActive}
            className="rounded-md px-3 py-2 text-xs font-bold bg-rose-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="loneWorker.fgs.stop"
          >
            <PauseCircle className="w-3 h-3 inline mr-1" aria-hidden="true" /> Detener
          </button>
        </div>
      </div>
    </section>
  );
}
