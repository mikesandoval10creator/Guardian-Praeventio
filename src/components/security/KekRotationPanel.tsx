// Praeventio Guard — Wire UI: <KekRotationPanel />
//
// Panel en Settings que permite al usuario / admin disparar la rotación
// del KEK device-bound + ver el progreso + recovery del lock si quedó
// stuck. Consume `kekRotationOrchestrator` (#247) + `deviceKek` +
// `inspectDeviceKek`.
//
// Diseñado para Settings → Seguridad → "Rotación de clave de cifrado":
//   - Muestra edad de la KEK actual (días)
//   - Sugerencia visual cuando >90 días (warning) / >365 días (critical)
//   - Botón "Rotar ahora" con confirmación + estimación de tiempo
//   - Durante rotación: progress bar + lock detectado + cancel disabled
//     (rotación NO se puede cancelar mid-process — sería inseguro)
//   - Recovery: si el lock está expirado (TTL >5min), botón "Liberar
//     lock" para casos post-crash

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Lock,
  Unlock,
  RefreshCcw,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  inspectDeviceKek,
  getOrCreateDeviceKek,
  rotateDeviceKek,
} from '../../services/security/deviceKek';
import {
  forceReleaseRotationLock,
  inspectRotationLock,
  runKekRotation,
  type KekRotationResult,
} from '../../services/security/kekRotationOrchestrator';
import { humanErrorMessage } from '../../lib/humanError';


interface KekRotationPanelProps {
  /** Lookup de fechas custom para tests deterministicos. */
  nowMs?: () => number;
  /** Callback al completar la rotación (telemetría / audit log). */
  onRotationComplete?: (result: KekRotationResult) => void;
}

interface KekInfo {
  exists: boolean;
  ageDays?: number;
  createdAt?: string;
}

type RotationPhase = 'idle' | 'running' | 'completed' | 'failed';

function classifyAge(days: number | undefined): 'fresh' | 'aging' | 'stale' {
  if (days === undefined) return 'fresh';
  if (days > 365) return 'stale';
  if (days > 90) return 'aging';
  return 'fresh';
}

export function KekRotationPanel({
  nowMs,
  onRotationComplete,
}: KekRotationPanelProps) {
  const { t } = useTranslation();
  const [kekInfo, setKekInfo] = useState<KekInfo | null>(null);
  const [lockHeld, setLockHeld] = useState(false);
  const [lockExpired, setLockExpired] = useState(false);
  const [phase, setPhase] = useState<RotationPhase>('idle');
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<KekRotationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    const nowIso = new Date(nowMs ? nowMs() : Date.now()).toISOString();
    const k = await inspectDeviceKek(nowIso).catch(() => ({ exists: false }));
    // `ageMs` solo existe en el shape completo `DeviceKekInfo`; el shape
    // de fallback `{ exists: false }` no lo tiene. Usamos `'ageMs' in k`
    // como type guard para que TS narrow correctamente.
    const ageMs = 'ageMs' in k ? k.ageMs : undefined;
    setKekInfo({
      exists: k.exists,
      ageDays:
        k.exists && ageMs !== undefined
          ? Math.round(ageMs / (1000 * 60 * 60 * 24))
          : undefined,
      createdAt: 'createdAt' in k ? k.createdAt : undefined,
    });
    const lock = inspectRotationLock(nowMs ? nowMs() : Date.now());
    setLockHeld(lock.held);
    setLockExpired(Boolean(lock.expired));
  }, [nowMs]);

  // Refresh on mount + cuando completa una rotación.
  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const handleRotate = useCallback(async () => {
    if (phase === 'running') return;
    setPhase('running');
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      const oldKek = await getOrCreateDeviceKek();
      const newKek = await rotateDeviceKek();
      const r = await runKekRotation(
        {
          oldKek,
          newKek,
          onProgress: (p, t) => setProgress({ processed: p, total: t }),
        },
        nowMs,
      );
      setResult(r);
      // Aborted (e.g. no_records, lock_busy) is still a graceful
      // completion of the orchestrator — show the result block with
      // the abort reason. Hard exceptions become phase='failed' below.
      setPhase('completed');
      onRotationComplete?.(r);
      await refreshState();
    } catch (err) {
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
      setPhase('failed');
      await refreshState();
    }
  }, [nowMs, onRotationComplete, phase, refreshState]);

  const handleReleaseLock = useCallback(() => {
    forceReleaseRotationLock();
    void refreshState();
  }, [refreshState]);

  if (!kekInfo) {
    return (
      <section
        data-testid="kek-rotation-panel"
        data-loading="true"
        data-phase="idle"
        className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      >
        <p className="text-xs italic text-stone-600 dark:text-stone-400">
          {t('kek.loading', 'Inspeccionando clave de cifrado…')}
        </p>
      </section>
    );
  }

  const ageClass = classifyAge(kekInfo.ageDays);
  const ageMeta = {
    fresh: {
      icon: ShieldCheck,
      cls: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
      label: t('kek.ageFresh', 'Clave saludable'),
    },
    aging: {
      icon: AlertTriangle,
      cls: 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300',
      label: t('kek.ageAging', 'Rotación recomendada'),
    },
    stale: {
      icon: AlertOctagon,
      cls: 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300',
      label: t('kek.ageStale', 'Rotación urgente'),
    },
  }[ageClass];

  return (
    <section
      data-testid="kek-rotation-panel"
      data-phase={phase}
      data-age-class={ageClass}
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
    >
      <header className="flex items-center gap-2 mb-3">
        <Key
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {t('kek.title', 'Clave de cifrado del dispositivo')}
        </h2>
      </header>

      {/* Estado actual */}
      <div
        data-testid="kek-rotation-status"
        className={`rounded-lg border px-3 py-2 mb-3 ${ageMeta.cls}`}
      >
        <div className="flex items-start gap-2">
          <ageMeta.icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-bold opacity-80">
              {ageMeta.label}
            </p>
            {kekInfo.exists ? (
              <p
                data-testid="kek-rotation-age"
                className="text-sm font-bold mt-0.5"
              >
                {kekInfo.ageDays}{' '}
                {t('kek.daysOld', 'días desde creación')}
              </p>
            ) : (
              <p className="text-sm font-bold mt-0.5">
                {t('kek.notExists', 'Sin clave generada')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Lock recovery */}
      {lockHeld && (
        <div
          data-testid="kek-rotation-lock-banner"
          data-expired={lockExpired ? 'true' : 'false'}
          className={`rounded-md border px-2.5 py-2 mb-3 flex items-start gap-2 ${
            lockExpired
              ? 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200'
              : 'border-blue-500/40 bg-blue-500/5 text-blue-800 dark:text-blue-200'
          }`}
        >
          <Lock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold">
              {lockExpired
                ? t('kek.lockExpired', 'Lock de rotación expirado')
                : t('kek.lockHeld', 'Rotación en curso en otra pestaña')}
            </p>
            <p className="text-[11px] opacity-80 mt-0.5">
              {lockExpired
                ? t(
                    'kek.lockExpiredHint',
                    'Una rotación previa quedó bloqueada (probablemente crash). Puedes liberar el lock para intentar de nuevo.',
                  )
                : t(
                    'kek.lockHeldHint',
                    'Otra ventana está rotando la clave. Espera a que termine o cierra esa ventana.',
                  )}
            </p>
            {lockExpired && (
              <button
                type="button"
                onClick={handleReleaseLock}
                data-testid="kek-rotation-release-lock"
                className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-600 text-white text-[11px] font-bold hover:brightness-110"
              >
                <Unlock className="w-3 h-3" aria-hidden="true" />
                {t('kek.releaseLock', 'Liberar lock')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Acción principal */}
      {phase === 'running' ? (
        <div data-testid="kek-rotation-progress" className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              {t('kek.rotating', 'Rotando clave + re-envolviendo datos…')}
            </span>
            {progress && (
              <span className="text-sm font-bold font-mono">
                {progress.processed}/{progress.total}
              </span>
            )}
          </div>
          <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden">
            <div
              data-testid="kek-rotation-progress-fill"
              style={{
                width: progress
                  ? `${Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%`
                  : '4%',
              }}
              className="h-full bg-teal-500 transition-all"
            />
          </div>
          <p className="text-[10px] mt-1 opacity-70">
            {t(
              'kek.rotatingHint',
              'No cierres esta ventana. La rotación es atómica por registro.',
            )}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleRotate}
          disabled={lockHeld && !lockExpired}
          data-testid="kek-rotation-trigger"
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-teal-600 text-white text-sm font-bold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCcw className="w-4 h-4" aria-hidden="true" />
          {t('kek.rotateButton', 'Rotar clave ahora')}
        </button>
      )}

      {/* Resultado */}
      {phase === 'completed' && result && (
        <div
          data-testid="kek-rotation-result"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 mt-3"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2
              className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0 text-xs text-emerald-800 dark:text-emerald-200">
              <p className="font-bold">
                {result.aborted
                  ? t('kek.resultAborted', 'Rotación abortada')
                  : t('kek.resultDone', 'Rotación completada')}
              </p>
              <p className="opacity-80 mt-0.5">
                {result.processed} {t('kek.processed', 'rotados')}
                {result.alreadyMigrated > 0 && (
                  <>
                    {', '}
                    {result.alreadyMigrated} {t('kek.alreadyMigrated', 'ya estaban migrados')}
                  </>
                )}
                {result.failed > 0 && (
                  <>
                    {', '}
                    <span className="text-rose-700 dark:text-rose-300 font-bold">
                      {result.failed} {t('kek.failed', 'fallaron')}
                    </span>
                  </>
                )}
              </p>
              {result.abortedReason && (
                <p
                  data-testid="kek-rotation-aborted-reason"
                  className="text-[11px] mt-0.5 opacity-75 font-mono"
                >
                  {result.abortedReason}
                </p>
              )}
              {result.failures.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-bold">
                    {t('kek.viewFailures', 'Ver fallos')}
                  </summary>
                  <ul
                    data-testid="kek-rotation-failures"
                    className="mt-1 space-y-0.5 font-mono text-[10px]"
                  >
                    {result.failures.map((f, i) => (
                      <li key={i}>
                        <span className="opacity-70">{f.key}:</span> {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'failed' && error && (
        <div
          data-testid="kek-rotation-error"
          className="rounded-md border border-rose-500/40 bg-rose-500/5 px-2.5 py-2 mt-3"
        >
          <p className="text-xs font-bold text-rose-800 dark:text-rose-200">
            {t('kek.errorTitle', 'Error en la rotación')}
          </p>
          <p className="text-[11px] mt-0.5 text-rose-700 dark:text-rose-300 font-mono">
            {humanErrorMessage(error)}
          </p>
        </div>
      )}
    </section>
  );
}
