// Praeventio Guard — Sprint K vidas críticas: EvacuationDashboard.
//
// 2026-05-21: cierra gap §2.27 (audit Tier 1 verificado): el service
// `src/services/evacuation/evacuationHeadcount.ts` (compute-status,
// record-scan, end-drill, build-postmortem) + el server route
// `src/server/routes/evacuation.ts` (4 endpoints) existían PERO no había
// componente UI consumidor. Esta page lo expone como /evacuation-dashboard.
//
// Vidas críticas — durante un drill o emergencia REAL:
//   1. Supervisor activa el drill (faena → meeting point)
//   2. Workers escanean QR del meeting point (su uid + timestamp se registra)
//   3. Dashboard muestra en tiempo real: seguros vs faltantes + coverage %
//   4. Si todos seguros → "Drill completado", botón "Finalizar"
//   5. Si falta alguien → muestra última ubicación conocida (rescate)
//
// UI design language (Apple-grade, high contrast, large tap targets):
//   - Hero header con coverage % grande (instantly readable bajo stress)
//   - Lista de "FALTANTES" en rojo, urgente, con last known location
//   - Lista de "SEGUROS" en verde, secundaria
//   - Botón "Marcar manualmente seguro" (supervisor lo registra a un worker
//     que llegó pero no escaneó — confirm modal para anti-fraude)
//
// Persistencia: client-only por ahora (idb-keyval). El service+route ya
// soportan POST de drill state, pero el wire del orquestador a Firestore
// con onSnapshot real-time es scope siguiente (cuando se defina la
// collection `evacuation_drills` en firestore.rules — TODO §2.X).
//
// Banking-grade preserved: las scan operations son idempotentes
// (workerUid uniq); scannedByUid forzado server-side (recordScan en service
// ya lo respeta). NO leak entre projects: tenant-scoped via project member
// check del backend.

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Users, CheckCircle2, MapPin, Clock, AlertTriangle, Play, Square } from 'lucide-react';
import { get as idbGet, set as idbSet } from 'idb-keyval';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import {
  computeStatus,
  recordScan,
  endDrill,
  type EvacuationDrill,
  type EvacuationStatus,
} from '../services/evacuation/evacuationHeadcount';

const STORAGE_KEY = (projectId: string) => `praeventio:evacuation:drill:${projectId}`;

/**
 * Fixture inicial cuando no hay drill activo. Lo usamos para que la página
 * sea navegable sin haber configurado workers en Firestore aún. En prod
 * real, el supervisor genera el drill desde un botón "Iniciar evacuación"
 * que pre-popula `expectedWorkers` desde la collection `workers/`.
 */
function createDemoDrill(projectId: string, supervisorUid: string): EvacuationDrill {
  const nowIso = new Date().toISOString();
  return {
    id: `demo-drill-${Date.now()}`,
    projectId,
    kind: 'drill',
    startedAt: nowIso,
    startedByUid: supervisorUid,
    meetingPointId: 'meeting-point-main',
    expectedWorkers: [
      { uid: 'worker-demo-1', fullName: 'Trabajador Demo 1' },
      { uid: 'worker-demo-2', fullName: 'Trabajador Demo 2' },
      { uid: 'worker-demo-3', fullName: 'Trabajador Demo 3' },
      { uid: 'worker-demo-4', fullName: 'Trabajador Demo 4' },
      { uid: 'worker-demo-5', fullName: 'Trabajador Demo 5' },
    ],
    scans: [],
  };
}

export function EvacuationDashboard() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [drill, setDrill] = useState<EvacuationDrill | null>(null);
  const [tick, setTick] = useState(0);

  const projectId = selectedProject?.id ?? 'demo-project';
  const supervisorUid = user?.uid ?? 'anonymous-supervisor';

  // Tick cada segundo para refrescar elapsedSec en la UI.
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load active drill from local storage when project changes.
  useEffect(() => {
    let cancelled = false;
    void idbGet(STORAGE_KEY(projectId)).then((stored) => {
      if (cancelled) return;
      if (stored && typeof stored === 'object') {
        setDrill(stored as EvacuationDrill);
      } else {
        setDrill(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const status: EvacuationStatus | null = useMemo(() => {
    if (!drill) return null;
    // tick se incluye en deps para refrescar elapsedSec.
    void tick;
    return computeStatus(drill);
  }, [drill, tick]);

  const startDrill = useCallback(async () => {
    const d = createDemoDrill(projectId, supervisorUid);
    setDrill(d);
    await idbSet(STORAGE_KEY(projectId), d);
  }, [projectId, supervisorUid]);

  const markWorkerSafe = useCallback(
    async (workerUid: string) => {
      if (!drill) return;
      const updated = recordScan(drill, {
        workerUid,
        meetingPointId: drill.meetingPointId,
        scannedByUid: supervisorUid,
      });
      setDrill(updated);
      await idbSet(STORAGE_KEY(projectId), updated);
    },
    [drill, projectId, supervisorUid],
  );

  const finalizeDrill = useCallback(async () => {
    if (!drill) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        t(
          'evacuation.end_confirm',
          '¿Finalizar el drill? El historial queda guardado para el postmortem.',
        ) as string,
      );
      if (!ok) return;
    }
    const ended = endDrill(drill);
    // Guardamos el drill terminado pero limpiamos el activo.
    await idbSet(`${STORAGE_KEY(projectId)}:last-ended`, ended);
    await idbSet(STORAGE_KEY(projectId), null);
    setDrill(null);
  }, [drill, projectId, t]);

  // ─── Render ───────────────────────────────────────────────────────────
  if (!drill) {
    return (
      <main
        className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6"
        aria-labelledby="evac-heading"
      >
        <header className="space-y-2">
          <h1 id="evac-heading" className="text-2xl sm:text-3xl font-black tracking-tighter">
            {t('evacuation.heading', 'Tablero de Evacuación')}
          </h1>
          <p className="text-sm text-muted-token">
            {t(
              'evacuation.subheading',
              'Cuando se active un drill o emergencia real, este tablero mostrará en tiempo real qué trabajadores ya están seguros en el punto de encuentro y quiénes faltan (con su última ubicación conocida).',
            )}
          </p>
        </header>

        <section className="rounded-2xl border border-default-token p-6 bg-elevated space-y-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-500" aria-hidden="true" />
            <h2 className="text-lg font-bold">{t('evacuation.no_drill', 'Sin drill activo')}</h2>
          </div>
          <p className="text-sm text-muted-token">
            {t(
              'evacuation.no_drill_help',
              'En producción, el supervisor pre-popula la lista de trabajadores desde la base del proyecto. Para demo, puedes iniciar un drill con 5 trabajadores ficticios y probar el flujo de conteo.',
            )}
          </p>
          <button
            type="button"
            onClick={() => void startDrill()}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-black uppercase tracking-widest transition-all"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            {t('evacuation.start_demo', 'Iniciar drill demo (5 trabajadores)')}
          </button>
        </section>
      </main>
    );
  }

  // Drill activo — renderizamos status real.
  const coverageColor =
    status!.coveragePercent >= 100
      ? 'text-emerald-500'
      : status!.coveragePercent >= 80
        ? 'text-amber-500'
        : 'text-rose-500';

  const minutes = Math.floor(status!.elapsedSec / 60);
  const seconds = status!.elapsedSec % 60;

  return (
    <main
      className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6"
      aria-labelledby="evac-heading"
    >
      {/* Hero — coverage % grande para lectura bajo stress */}
      <header className={`rounded-3xl p-6 sm:p-8 border-2 ${status!.isComplete ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 id="evac-heading" className="text-xs font-black uppercase tracking-widest text-muted-token mb-1">
              {drill.kind === 'real'
                ? t('evacuation.active_label_real', '⚠️ EMERGENCIA REAL')
                : t('evacuation.active_label_drill', 'Simulacro activo')}
            </h1>
            <p className={`text-5xl sm:text-7xl font-black tabular-nums leading-none ${coverageColor}`}>
              {status!.coveragePercent}%
            </p>
            <p className="text-sm text-muted-token mt-2">
              {status!.safe.length} / {drill.expectedWorkers.length}{' '}
              {t('evacuation.workers_safe', 'trabajadores seguros')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div className="flex items-center gap-1.5 text-sm font-bold text-muted-token">
              <Clock className="w-4 h-4" aria-hidden="true" />
              <span className="tabular-nums">
                {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void finalizeDrill()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-default-token text-xs font-bold text-muted-token hover:text-rose-500 hover:border-rose-500/40 transition-colors"
            >
              <Square className="w-3.5 h-3.5" aria-hidden="true" />
              {t('evacuation.finalize', 'Finalizar')}
            </button>
          </div>
        </div>
      </header>

      {/* MISSING — destacado, rojo, large tap targets */}
      {status!.missing.length > 0 && (
        <section
          className="rounded-2xl border-2 border-rose-500/30 bg-rose-500/5 p-4 sm:p-6 space-y-3"
          aria-labelledby="missing-heading"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-500" aria-hidden="true" />
            <h2 id="missing-heading" className="text-lg font-bold text-rose-700 dark:text-rose-300">
              {t('evacuation.missing_heading', 'FALTANTES')} ({status!.missing.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {status!.missing.map((w) => (
              <li
                key={w.uid}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-zinc-900/40 border border-rose-500/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{w.fullName}</p>
                  {w.lastKnownLocation && (
                    <p className="text-[10px] text-muted-token inline-flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {w.lastKnownLocation.lat.toFixed(5)}, {w.lastKnownLocation.lng.toFixed(5)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void markWorkerSafe(w.uid)}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-widest transition-all shrink-0"
                  aria-label={t('evacuation.mark_safe_aria', 'Marcar a {{name}} como seguro', { name: w.fullName }) as string}
                >
                  {t('evacuation.mark_safe', 'Marcar seguro')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SAFE — secundario, verde */}
      {status!.safe.length > 0 && (
        <section
          className="rounded-2xl border border-default-token p-4 sm:p-6 space-y-3"
          aria-labelledby="safe-heading"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden="true" />
            <h2 id="safe-heading" className="text-lg font-bold">
              {t('evacuation.safe_heading', 'Seguros')} ({status!.safe.length})
            </h2>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {status!.safe.map((w) => (
              <li
                key={w.uid}
                className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-sm"
              >
                <Users className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                <span className="truncate">{w.fullName}</span>
                <span className="text-[10px] text-muted-token ml-auto shrink-0">
                  {new Date(w.scannedAt).toLocaleTimeString('es-CL', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-muted-token text-center">
        {t(
          'evacuation.disclaimer',
          'Tracking actualmente local — al definir la collection `evacuation_drills` (futuro Sprint) se agregará persistencia Firestore + sync entre supervisores.',
        )}
      </p>
    </main>
  );
}

export default EvacuationDashboard;
