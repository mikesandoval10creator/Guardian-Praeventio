// Praeventio Guard — Sprint 39 Bloque 3 wire — <EvacuationDashboard />.
//
// Live UI superior al `<EvacuationStatusBoard />` existente: además del
// tablero safe/missing, expone:
//
//   • Botón "Iniciar evacuación" (kind=drill | real) — supervisor inicia
//   • Subscription a Firestore para que `safe`/`missing` se actualicen
//     <1s sin polling
//   • Apertura del scanner <EvacuationQRScanner /> embebido (botón "Escanear")
//   • Botón "Finalizar" — devuelve postmortem
//
// Paleta usuario: teal #4db6ac primary (favorito), petroleum + gold acentos,
// coral demoted a alerta (rose-500 para missing). Dark-mode compatible vía
// tokens `bg-surface` / `text-primary-token` ya en el design system.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  AlertOctagon,
  CheckCheck,
  Clock,
  Play,
  Square,
  QrCode,
  Loader2,
} from 'lucide-react';
import {
  computeStatus,
  type EvacuationDrill,
  type EvacuationPostmortem,
} from '../../services/evacuation/evacuationHeadcount.js';
import {
  useEvacuationHeadcount,
  subscribeToDrill,
  EvacuationAlreadyActiveError,
} from '../../hooks/useEvacuationHeadcount.js';
import { EvacuationQRScanner } from './EvacuationQRScanner.js';
import { humanErrorMessage } from '../../lib/humanError';


// Paleta usuario — teal primary, gold/petroleum acentos.
const TEAL = '#4db6ac';
const TEAL_DARK = '#26a69a';

export interface EvacuationDashboardProps {
  projectId: string;
  tenantId: string;
  /** Lista de workers activos en faena, para arrancar el drill. */
  expectedWorkers: EvacuationDrill['expectedWorkers'];
  /** Meeting point default (puede ofrecerse picker en una iteración futura). */
  meetingPointId: string;
  /** Drill activo si el supervisor entra a pantalla con uno en curso. */
  initialDrillId?: string;
  /**
   * Whether STARTING a new drill is allowed. A container gates this on having a
   * real roster (attendance) — a headcount with no roster reports a false
   * "100% / 0 missing" all-clear. Default true (standalone use). When false the
   * start buttons are disabled and `startBlockedHint` is shown. Does NOT affect
   * resuming/ending an already-active drill.
   */
  canStartNew?: boolean;
  /** Localized reason shown when `canStartNew` is false (e.g. "no attendance"). */
  startBlockedHint?: string;
  /** Override clock — sólo tests. */
  nowProvider?: () => Date;
}

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

export function EvacuationDashboard({
  projectId,
  tenantId,
  expectedWorkers,
  meetingPointId,
  initialDrillId,
  canStartNew = true,
  startBlockedHint,
  nowProvider,
}: EvacuationDashboardProps) {
  const { t } = useTranslation();
  const { start, scanQr, end } = useEvacuationHeadcount();

  const [drillId, setDrillId] = useState<string | null>(initialDrillId ?? null);
  const [drill, setDrill] = useState<EvacuationDrill | null>(null);
  const [postmortem, setPostmortem] = useState<EvacuationPostmortem | null>(null);
  const [busy, setBusy] = useState<'idle' | 'start' | 'end' | 'scan'>('idle');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when we are subscribed to a specific drill (resume) but its doc does
  // NOT exist — it finished/was deleted on another device. We then show a
  // notice instead of silently dropping to the start screen (which would read
  // as "nothing was in progress").
  const [staleResume, setStaleResume] = useState(false);
  const [tick, setTick] = useState(0);

  // Re-render every second so elapsed counter stays live.
  useEffect(() => {
    if (!drill || drill.endedAt) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [drill]);

  // Suscripción Firestore al drill activo.
  useEffect(() => {
    if (!drillId) {
      setDrill(null);
      setStaleResume(false);
      return undefined;
    }
    setStaleResume(false);
    const unsub = subscribeToDrill(
      { tenantId, projectId, drillId },
      (next) => {
        setDrill(next);
        // Subscribed to a specific drill but it does not exist (ended/deleted
        // on another device). A drill we just ENDED keeps its doc (endedAt set),
        // so a null here is a genuine vanished-resume, not a normal close-out.
        setStaleResume(next === null);
      },
      (err) => setError(humanErrorMessage(err.message ?? 'subscription_error')),
    );
    return () => unsub();
  }, [drillId, tenantId, projectId]);

  const now = useMemo(() => (nowProvider ?? (() => new Date()))(), [
    nowProvider,
    tick, // include tick so memo invalidates each second
  ]);
  const status = useMemo(
    () => (drill ? computeStatus(drill, now) : null),
    [drill, now],
  );

  const handleStart = useCallback(
    async (kind: 'drill' | 'real') => {
      setBusy('start');
      setError(null);
      try {
        const res = await start({
          projectId,
          kind,
          meetingPointId,
          expectedWorkers,
        });
        setDrillId(res.drill.id);
      } catch (e) {
        // Cross-device: another supervisor already started a count. Detect by
        // instanceof OR by name (robust if a future lazy-chunk split ever gives
        // the class two identities across module boundaries — a failed detect
        // here would degrade a real-emergency join to a raw error).
        const alreadyActive =
          e instanceof EvacuationAlreadyActiveError ||
          (e as { name?: string })?.name === 'EvacuationAlreadyActiveError';
        const existingId = (e as { drillId?: string | null })?.drillId ?? null;
        if (alreadyActive && existingId) {
          // JOIN the in-progress drill (never two concurrent counts).
          setDrillId(existingId);
          setError(null);
        } else if (alreadyActive) {
          // A count is active but its id wasn't returned — can't auto-join; tell
          // the supervisor how to join rather than show the raw internal key.
          setError(
            t(
              'evacuation.dashboard.alreadyActive',
              'Ya hay un conteo de evacuación activo en otro dispositivo. Recargá la pantalla para unirte.',
            ),
          );
        } else {
          setError((e as Error).message ?? 'start_failed');
        }
      } finally {
        setBusy('idle');
      }
    },
    [projectId, meetingPointId, expectedWorkers, start, t],
  );

  const handleEnd = useCallback(async () => {
    if (!drillId) return;
    setBusy('end');
    setError(null);
    try {
      const res = await end({ projectId, drillId });
      setPostmortem(res.postmortem);
      // The board stays mounted showing the postmortem; the supervisor reads the
      // close-out record and explicitly starts a new count via the postmortem's
      // "Iniciar nuevo conteo" button (resetForNewDrill). We do NOT tear down
      // here — that previously destroyed the postmortem.
    } catch (e) {
      setError((e as Error).message ?? 'end_failed');
    } finally {
      setBusy('idle');
    }
  }, [drillId, projectId, end]);

  // Return to the idle/start screen after reading the postmortem — deterministic
  // regardless of roster state (the container no longer drives teardown).
  const resetForNewDrill = useCallback(() => {
    setDrillId(null);
    setDrill(null);
    setPostmortem(null);
    setError(null);
  }, []);

  const handleScannedQr = useCallback(
    async (workerUid: string) => {
      if (!drillId) return;
      setBusy('scan');
      setError(null);
      try {
        await scanQr({ projectId, drillId, workerUid, meetingPointId });
        // Firestore subscription will reflect the new scan automatically;
        // no setState needed.
      } catch (e) {
        setError((e as Error).message ?? 'scan_failed');
      } finally {
        setBusy('idle');
        setScannerOpen(false);
      }
    },
    [drillId, projectId, meetingPointId, scanQr],
  );

  const coverageTone =
    status && status.coveragePercent >= 100
      ? 'bg-emerald-500'
      : status && status.coveragePercent >= 80
        ? 'bg-amber-500'
        : 'bg-rose-500';

  // ── Drill ended → postmortem (TOP-LEVEL, decoupled from `drill`) ─────
  // Rendered before the !drill / active branches and gated ONLY on `postmortem`,
  // so a live-subscription update (even one that nulls `drill`, e.g. the doc is
  // deleted/expired) can never tear down the close-out record. The supervisor
  // leaves it explicitly via "Iniciar nuevo conteo" (resetForNewDrill).
  if (postmortem) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 shadow-mode dark:bg-zinc-900 dark:border-zinc-700 space-y-3"
        data-testid={`evacuation-dashboard-postmortem-${postmortem.drillId}`}
        aria-label={t('evacuation.aria.postmortem', 'Resumen de evacuación') as string}
      >
        <header className="flex items-center gap-2">
          <CheckCheck className="w-5 h-5" style={{ color: TEAL }} aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-primary-token dark:text-white">
            {t('evacuation.postmortem.title', 'Postmortem')}
          </h2>
        </header>
        <p className="text-sm">
          {t('evacuation.postmortem.coverage', 'Cobertura final')}:{' '}
          <span className="font-bold tabular-nums">{postmortem.finalCoveragePercent}%</span>{' '}
          ({postmortem.totalSafe}/{postmortem.totalExpected})
        </p>
        <p className="text-sm">
          {t('evacuation.postmortem.elapsed', 'Tiempo total')}:{' '}
          <span className="font-bold tabular-nums">{formatElapsed(postmortem.totalElapsedSec)}</span>
        </p>
        <p className="text-sm">
          {t('evacuation.postmortem.avgScan', 'Tiempo prom. de scan')}:{' '}
          <span className="font-bold tabular-nums">{postmortem.averageTimeToScanSec}s</span>
        </p>
        {postmortem.missingWorkers.length > 0 && (
          <p className="text-sm font-bold text-rose-600 dark:text-rose-400">
            {t('evacuation.postmortem.stillMissing', 'No localizados')}: {postmortem.missingWorkers.length}
          </p>
        )}
        <button
          type="button"
          onClick={resetForNewDrill}
          data-testid="evacuation-postmortem-new"
          className="mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow transition hover:opacity-90"
          style={{ backgroundColor: TEAL }}
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          {t('evacuation.postmortem.startNew', 'Iniciar nuevo conteo')}
        </button>
      </section>
    );
  }

  // ── No drill active → show start buttons ────────────────────────────
  if (!drill) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 shadow-mode dark:bg-zinc-900 dark:border-zinc-700 space-y-4"
        data-testid="evacuation-dashboard-idle"
        aria-label={t('evacuation.aria.idle', 'Panel de evacuación') as string}
      >
        <header className="flex items-center gap-2">
          <Users className="w-5 h-5" style={{ color: TEAL }} aria-hidden="true" />
          <h2 className="text-base font-black text-primary-token dark:text-white uppercase tracking-wide">
            {t('evacuation.dashboard.title', 'Conteo de Evacuación')}
          </h2>
        </header>

        <p className="text-sm text-secondary-token dark:text-zinc-300">
          {t(
            'evacuation.dashboard.idleHint',
            'No hay drill activo. Inicia un simulacro o, en emergencia real, dispara el conteo.',
          )}
        </p>

        {staleResume && (
          <div
            className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
            data-testid="evacuation-stale-resume"
            role="alert"
          >
            <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t(
                'evacuation.dashboard.staleResume',
                'La evacuación que intentabas retomar ya no existe (finalizó o se eliminó en otro dispositivo). Iniciá un nuevo conteo si corresponde.',
              )}
            </span>
          </div>
        )}

        {!canStartNew && startBlockedHint && (
          <div
            className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
            data-testid="evacuation-start-blocked"
          >
            <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{startBlockedHint}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleStart('drill')}
            disabled={busy !== 'idle' || !canStartNew}
            data-testid="evacuation-start-drill"
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: TEAL }}
          >
            {busy === 'start' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {t('evacuation.dashboard.startDrill', 'Iniciar simulacro')}
          </button>
          <button
            type="button"
            onClick={() => handleStart('real')}
            disabled={busy !== 'idle' || !canStartNew}
            data-testid="evacuation-start-real"
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white bg-rose-600 shadow transition hover:bg-rose-700 disabled:opacity-50"
          >
            {busy === 'start' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <AlertOctagon className="w-4 h-4" />
            )}
            {t('evacuation.dashboard.startReal', 'Emergencia real')}
          </button>
        </div>

        {error && (
          <p
            className="text-xs text-rose-600 dark:text-rose-300 font-bold"
            data-testid="evacuation-dashboard-error"
          >
            {humanErrorMessage(error)}
          </p>
        )}
      </section>
    );
  }

  // ── Active drill → live board ───────────────────────────────────────
  const elapsedSec = status?.elapsedSec ?? 0;

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode dark:bg-zinc-900 dark:border-zinc-700 space-y-3"
      data-testid={`evacuation-dashboard-${drill.id}`}
      aria-label={t('evacuation.aria.active', 'Tablero evacuación activo') as string}
    >
      <header className="flex items-center gap-2">
        <Users className="w-4 h-4" style={{ color: TEAL }} aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          {drill.kind === 'real' ? (
            <span className="text-rose-600 dark:text-rose-400">
              {t('evacuation.real', 'EMERGENCIA REAL')}
            </span>
          ) : (
            <span className="text-primary-token dark:text-white">
              {t('evacuation.drill', 'Simulacro')}
            </span>
          )}
        </h2>
        <span
          className="ml-auto flex items-center gap-1 text-[10px] text-secondary-token dark:text-zinc-400 tabular-nums"
          data-testid={`evacuation-dashboard-elapsed-${drill.id}`}
        >
          <Clock className="w-3 h-3" aria-hidden="true" />
          {formatElapsed(elapsedSec)}
        </span>
      </header>

      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="uppercase font-bold">
            {t('evacuation.coverage', 'Cobertura')}
          </span>
          <span
            className="tabular-nums font-bold"
            data-testid={`evacuation-dashboard-coverage-${drill.id}`}
          >
            {status?.coveragePercent ?? 0}%
          </span>
        </div>
        <div
          className="h-2 bg-surface-elevated dark:bg-zinc-800 rounded overflow-hidden"
          role="progressbar"
          aria-valuenow={status?.coveragePercent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full ${coverageTone}`}
            style={{ width: `${status?.coveragePercent ?? 0}%` }}
            data-testid={`evacuation-dashboard-coverage-bar-${drill.id}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div
          className="bg-emerald-500/10 rounded p-2"
          data-testid={`evacuation-dashboard-safe-${drill.id}`}
        >
          <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-300 mb-1">
            <CheckCheck className="w-3 h-3" aria-hidden="true" />
            {t('evacuation.safe', 'Seguros')} ({status?.safe.length ?? 0})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {status?.safe.map((w) => (
              <li
                key={w.uid}
                className="text-[11px] truncate"
                data-testid={`evacuation-dashboard-safe-${w.uid}`}
              >
                {w.fullName}
              </li>
            ))}
          </ul>
        </div>
        <div
          className="bg-rose-500/10 rounded p-2"
          data-testid={`evacuation-dashboard-missing-${drill.id}`}
        >
          <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            <AlertOctagon className="w-3 h-3" aria-hidden="true" />
            {t('evacuation.missing', 'Faltan')} ({status?.missing.length ?? 0})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {status?.missing.map((w) => (
              <li
                key={w.uid}
                className="text-[11px] truncate"
                data-testid={`evacuation-dashboard-missing-${w.uid}`}
              >
                {w.fullName}
                {w.lastKnownLocation && (
                  <span className="text-[9px] text-secondary-token dark:text-zinc-400 ml-1">
                    ({w.lastKnownLocation.lat.toFixed(3)},{' '}
                    {w.lastKnownLocation.lng.toFixed(3)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!drill.endedAt && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            disabled={busy !== 'idle'}
            data-testid={`evacuation-dashboard-open-scanner-${drill.id}`}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white shadow transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: TEAL }}
          >
            <QrCode className="w-4 h-4" />
            {t('evacuation.dashboard.scan', 'Escanear QR')}
          </button>
          <button
            type="button"
            onClick={handleEnd}
            disabled={busy !== 'idle'}
            data-testid={`evacuation-dashboard-end-${drill.id}`}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white bg-zinc-700 dark:bg-zinc-600 shadow transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy === 'end' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {t('evacuation.dashboard.end', 'Finalizar')}
          </button>
        </div>
      )}

      {status?.isComplete && !drill.endedAt && (
        <p
          className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-2 rounded font-bold text-center"
          data-testid={`evacuation-dashboard-complete-${drill.id}`}
        >
          {t('evacuation.complete', 'Todos seguros — drill puede cerrarse.')}
        </p>
      )}

      {error && (
        <p
          className="text-xs text-rose-600 dark:text-rose-300 font-bold"
          data-testid={`evacuation-dashboard-error-${drill.id}`}
        >
          {humanErrorMessage(error)}
        </p>
      )}

      {scannerOpen && (
        <EvacuationQRScanner
          onScanned={handleScannedQr}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* tincture de gradiente teal-dark al borde inferior — micro-touch
          de marca, evita que el dashboard se vea genérico. */}
      <div
        className="h-0.5 rounded-b -mx-4 -mb-4"
        style={{
          background: `linear-gradient(90deg, ${TEAL} 0%, ${TEAL_DARK} 100%)`,
        }}
        aria-hidden="true"
      />
    </section>
  );
}
