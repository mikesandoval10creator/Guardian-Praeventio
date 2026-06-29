// Praeventio Guard — Incremento 2a: tabs Conductores + Ranking unificados.
//
// Extraído de `src/pages/DrivingSafety.tsx` para que la página canónica
// `SafeDriving.tsx` (que ya tiene mapa + rutas + reporte de incidente)
// incorpore la gestión de conductores y el ranking de seguridad SIN
// duplicar ~300 LOC de JSX inline. Toda la lógica original se preserva:
//   - tab 'conductores' = lista + cards de scoring (DriverScoreCard) +
//     CTA "Registrar viaje" (JourneyModal start/end).
//   - tab 'ranking' = conductores ordenados desc por safetyScore con
//     bandas de color, nivel y blockers visibles.
//
// Copy es-CL en strings planos (no nuevos t() keys) para no tocar el gate
// de paridad i18n — mismo criterio que KpiRow / RotatingAdviceBanner.
//
// NUNCA bloquea operación: muestra score y blockers; el supervisor decide.

import { useMemo, useState } from 'react';
import {
  Car,
  X,
  AlertTriangle,
  AlertCircle,
  Trophy,
  Gauge,
  Users,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import {
  useDrivingDrivers,
  useDrivingRanking,
  recordJourney,
  type DrivingDriver,
  type DrivingRankingEntry,
} from '../../hooks/useDrivingSafety';
import { DriverScoreCard } from './DriverScoreCard';
import { logger } from '../../utils/logger';

export type DriverScoringTab = 'conductores' | 'ranking';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers (copiados 1:1 de DrivingSafety.tsx)
// ────────────────────────────────────────────────────────────────────────

/** Days until ISO-8601 expiry vs `now`. Negative = already expired. */
function daysUntil(iso: string, now: number = Date.now()): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 0;
  return Math.floor((ts - now) / 86_400_000);
}

function licenseBandClass(daysToExpiry: number): string {
  if (daysToExpiry < 0) return 'text-rose-600 dark:text-rose-400';
  if (daysToExpiry < 30) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function fatigueBandClass(fatigue: number): string {
  if (fatigue >= 75) return 'text-rose-600 dark:text-rose-400';
  if (fatigue >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function safetyBandClass(score: number): string {
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 75) return 'text-teal-600 dark:text-teal-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  if (score >= 40) return 'text-orange-600 dark:text-orange-400';
  return 'text-rose-600 dark:text-rose-400';
}

function levelLabel(level: DrivingRankingEntry['level']): string {
  switch (level) {
    case 'excellent':
      return 'Excelente';
    case 'good':
      return 'Bueno';
    case 'fair':
      return 'Aceptable';
    case 'poor':
      return 'Bajo';
    case 'critical':
      return 'Crítico';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Componente principal: tabs Conductores + Ranking
// ────────────────────────────────────────────────────────────────────────

interface DriverScoringTabsProps {
  projectId: string | null;
  tab: DriverScoringTab;
}

export function DriverScoringTabs({ projectId, tab }: DriverScoringTabsProps) {
  const driversResp = useDrivingDrivers(projectId);
  const rankingResp = useDrivingRanking(projectId);
  const [journeyDriverUid, setJourneyDriverUid] = useState<string | null>(null);

  const drivers: DrivingDriver[] = useMemo(
    () => driversResp.data?.drivers ?? [],
    [driversResp.data],
  );
  const ranking: DrivingRankingEntry[] = useMemo(
    () => rankingResp.data?.ranking ?? [],
    [rankingResp.data],
  );

  return (
    <>
      {/* Conductores tab */}
      {tab === 'conductores' && (
        <section
          aria-label="Conductores"
          className="space-y-3"
          data-testid="driving-safety-conductores-section"
        >
          {driversResp.loading && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="driving-safety-drivers-loading"
            >
              Cargando…
            </div>
          )}

          {driversResp.error && (
            <div
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
              data-testid="driving-safety-drivers-error"
              role="alert"
            >
              No se pudieron cargar los conductores: {driversResp.error.message}
            </div>
          )}

          {!driversResp.loading && !driversResp.error && drivers.length === 0 && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-8 text-center"
              data-testid="driving-safety-drivers-empty"
            >
              <Users
                className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                aria-hidden="true"
              />
              <p className="text-sm text-secondary-token italic">
                No hay conductores registrados en este proyecto.
              </p>
            </div>
          )}

          {!driversResp.loading && !driversResp.error && drivers.length > 0 && (
            <ul className="space-y-2" data-testid="driving-safety-drivers-list">
              {drivers.map((d) => {
                const daysToExpiry = daysUntil(d.licenseExpiresAt);
                return (
                  <li
                    key={d.workerUid}
                    className="rounded-xl border border-default-token bg-surface p-3 shadow-mode"
                    data-testid={`driving-safety-driver-${d.workerUid}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-9 h-9 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                        <Car className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-primary-token truncate">
                          {d.workerUid}
                        </p>
                        <p className="text-[11px] text-secondary-token">
                          Licencia:{' '}
                          {d.licenseClass} ·{' '}
                          <span
                            className={`font-bold ${licenseBandClass(daysToExpiry)}`}
                            data-testid={`driving-safety-driver-license-${d.workerUid}`}
                          >
                            {daysToExpiry < 0
                              ? 'vencida'
                              : `vence en ${daysToExpiry}d`}
                          </span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
                          <span className="flex items-center gap-1 text-secondary-token">
                            <Gauge className="w-3 h-3" aria-hidden="true" />
                            <span>
                              Fatiga:{' '}
                              <span
                                className={`font-bold ${fatigueBandClass(d.fatigueScore)}`}
                                data-testid={`driving-safety-driver-fatigue-${d.workerUid}`}
                              >
                                {d.fatigueScore}
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-1 text-secondary-token">
                            <Activity className="w-3 h-3" aria-hidden="true" />
                            <span>
                              Horas/sem:{' '}
                              <span className="font-bold text-primary-token">
                                {d.hoursThisWeek.toFixed(1)}
                              </span>
                            </span>
                          </span>
                          <span className="text-secondary-token">
                            Incidentes 12m:{' '}
                            <span className="font-bold text-primary-token">
                              {d.incidents12m}
                            </span>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setJourneyDriverUid(d.workerUid)}
                        className="shrink-0 rounded-lg border border-default-token bg-surface px-2 py-1 text-xs font-bold text-secondary-token transition-colors hover:text-blue-600"
                        data-testid={`driving-safety-driver-journey-${d.workerUid}`}
                      >
                        Registrar viaje
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!driversResp.loading && !driversResp.error && drivers.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              data-testid="driving-safety-score-cards"
            >
              {drivers.map((d) => (
                <DriverScoreCard key={d.workerUid} profile={d} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Ranking tab */}
      {tab === 'ranking' && (
        <section
          aria-label="Ranking"
          className="space-y-3"
          data-testid="driving-safety-ranking-section"
        >
          {rankingResp.loading && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="driving-safety-ranking-loading"
            >
              Cargando…
            </div>
          )}

          {rankingResp.error && (
            <div
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
              data-testid="driving-safety-ranking-error"
              role="alert"
            >
              No se pudo cargar el ranking: {rankingResp.error.message}
            </div>
          )}

          {!rankingResp.loading && !rankingResp.error && ranking.length === 0 && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-8 text-center"
              data-testid="driving-safety-ranking-empty"
            >
              <Trophy
                className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                aria-hidden="true"
              />
              <p className="text-sm text-secondary-token italic">
                No hay conductores registrados para ranquear.
              </p>
            </div>
          )}

          {!rankingResp.loading && !rankingResp.error && ranking.length > 0 && (
            <ol className="space-y-2" data-testid="driving-safety-ranking-list">
              {ranking.map((r, idx) => (
                <li
                  key={r.workerUid}
                  className="flex items-start gap-3 rounded-xl border border-default-token bg-surface p-3 shadow-mode"
                  data-testid={`driving-safety-ranking-${r.workerUid}`}
                >
                  <span
                    className="shrink-0 w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center text-sm font-black tabular-nums"
                    aria-label={`Posición ${idx + 1}`}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-primary-token truncate">
                      {r.workerUid}
                    </p>
                    <p className="text-[11px] text-secondary-token">
                      {levelLabel(r.level)} · horas sem: {r.hoursThisWeek.toFixed(1)}
                    </p>
                    {r.canOperate ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Puede operar
                      </p>
                    ) : (
                      r.blockers.length > 0 && (
                        <p
                          className="mt-1 inline-flex items-start gap-1 text-[10px] font-bold text-rose-600"
                          data-testid={`driving-safety-ranking-blockers-${r.workerUid}`}
                        >
                          <AlertTriangle className="w-3 h-3 mt-px" aria-hidden="true" />
                          <span>{r.blockers.join(' · ')}</span>
                        </p>
                      )
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono text-xl font-black tabular-nums ${safetyBandClass(r.safetyScore)}`}
                      data-testid={`driving-safety-ranking-score-${r.workerUid}`}
                    >
                      {r.safetyScore}
                    </p>
                    <p className="text-[9px] uppercase text-secondary-token">
                      Score
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {journeyDriverUid && projectId && (
        <JourneyModal
          projectId={projectId}
          driverUid={journeyDriverUid}
          onClose={() => setJourneyDriverUid(null)}
          onSuccess={() => {
            setJourneyDriverUid(null);
            driversResp.refetch?.();
            rankingResp.refetch?.();
          }}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Inline modal: registrar viaje (start / end) — copiado 1:1 de DrivingSafety.tsx
// ────────────────────────────────────────────────────────────────────────

interface JourneyModalProps {
  projectId: string;
  driverUid: string;
  onClose: () => void;
  onSuccess: () => void;
}

function JourneyModal({
  projectId,
  driverUid,
  onClose,
  onSuccess,
}: JourneyModalProps) {
  const [action, setAction] = useState<'start' | 'end'>('start');
  const [journeyId, setJourneyId] = useState('');
  const [hours, setHours] = useState<string>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (action === 'end' && journeyId.trim().length < 1) {
      setError('Para cerrar un viaje necesitas el ID.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const hrs = Number(hours);
      await recordJourney(projectId, driverUid, {
        action,
        journeyId: action === 'end' ? journeyId.trim() : undefined,
        hours: Number.isFinite(hrs) && hrs > 0 ? hrs : undefined,
        note: note.trim() || undefined,
      });
      logger.info('drivingSafety.journey.recorded', { projectId, driverUid, action });
      onSuccess();
    } catch (err) {
      logger.error('drivingSafety.journey.failed', err);
      setError(
        (err as Error).message || 'No se pudo registrar el viaje.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="driving-safety-journey-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <Car className="w-5 h-5 text-blue-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            Registrar viaje
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label="Cerrar"
            data-testid="driving-safety-journey-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            Acción
          </span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as 'start' | 'end')}
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="driving-safety-journey-modal-action"
          >
            <option value="start">Iniciar viaje</option>
            <option value="end">Cerrar viaje</option>
          </select>
        </label>

        {action === 'end' && (
          <>
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                ID del viaje
              </span>
              <input
                type="text"
                value={journeyId}
                onChange={(e) => setJourneyId(e.target.value)}
                placeholder="j_..."
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-journey-modal-id"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                Horas (opcional, autocalcula si está vacío)
              </span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-journey-modal-hours"
              />
            </label>
          </>
        )}

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            Nota (opcional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="driving-safety-journey-modal-note"
          />
        </label>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="driving-safety-journey-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="driving-safety-journey-modal-cancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="driving-safety-journey-modal-submit"
          >
            {submitting ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DriverScoringTabs;
