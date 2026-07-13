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
  Plus,
  Route,
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Trophy,
  Gauge,
  Users,
  Activity,
  CheckCircle2,
  Wind,
  Snowflake,
  Cloud,
} from 'lucide-react';
import {
  useDrivingRoutes,
  useDrivingDrivers,
  useDrivingRanking,
  registerRoute,
  flagRouteAlert,
  recordJourney,
  type DrivingRoute,
  type DrivingRouteCriticality,
  type DrivingRouteHazard,
  type DrivingRouteAlertKind,
  type DrivingRoutesStatus,
  type DrivingDriver,
  type DrivingRankingEntry,
} from '../../hooks/useDrivingSafety';
import { DriverScoreCard } from './DriverScoreCard';
import { logger } from '../../utils/logger';

export type DriverScoringTab = 'conductores' | 'ranking' | 'rutas';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers (copiados 1:1 de DrivingSafety.tsx)
// ────────────────────────────────────────────────────────────────────────

const CRITICALITY_META: Record<
  DrivingRouteCriticality,
  { label: string; color: string; bg: string; border: string }
> = {
  low: {
    label: 'Baja',
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  medium: {
    label: 'Media',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  high: {
    label: 'Alta',
    color: 'text-orange-600',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
  },
  extreme: {
    label: 'Extrema',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
};

const HAZARD_LABEL: Record<DrivingRouteHazard, string> = {
  cliff: 'Acantilado',
  rockfall: 'Caída de rocas',
  flood_zone: 'Zona de inundación',
  sharp_curves: 'Curvas pronunciadas',
  limited_visibility: 'Visibilidad limitada',
  wildlife: 'Fauna silvestre',
  mining_traffic: 'Tráfico minero',
  icy_surface: 'Superficie helada',
  fog: 'Niebla',
  debris: 'Escombros',
  accident_reported: 'Accidente reportado',
};

const ALERT_KIND_META: Record<
  DrivingRouteAlertKind,
  { label: string; icon: typeof AlertTriangle }
> = {
  icy: { label: 'Hielo en pista', icon: Snowflake },
  fog: { label: 'Niebla', icon: Cloud },
  debris: { label: 'Escombros', icon: AlertTriangle },
  accident_reported: { label: 'Accidente reportado', icon: AlertCircle },
  weather: { label: 'Clima adverso', icon: Wind },
  other: { label: 'Otra alerta', icon: AlertTriangle },
};

const CRITICALITY_OPTIONS: DrivingRouteCriticality[] = ['low', 'medium', 'high', 'extreme'];
const HAZARD_OPTIONS: DrivingRouteHazard[] = [
  'cliff',
  'rockfall',
  'flood_zone',
  'sharp_curves',
  'limited_visibility',
  'wildlife',
  'mining_traffic',
  'icy_surface',
  'fog',
  'debris',
  'accident_reported',
];
const ALERT_KIND_OPTIONS: DrivingRouteAlertKind[] = [
  'icy',
  'fog',
  'debris',
  'accident_reported',
  'weather',
  'other',
];
const STATUS_OPTIONS: { value: DrivingRoutesStatus; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Con alerta' },
  { value: 'critical', label: 'Críticas' },
];

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
  const [status, setStatus] = useState<DrivingRoutesStatus>('all');
  const routesResp = useDrivingRoutes(projectId, { status });
  const driversResp = useDrivingDrivers(projectId);
  const rankingResp = useDrivingRanking(projectId);
  const [journeyDriverUid, setJourneyDriverUid] = useState<string | null>(null);
  const [showCreateRoute, setShowCreateRoute] = useState(false);
  const [alertRouteId, setAlertRouteId] = useState<string | null>(null);

  const routes: DrivingRoute[] = useMemo(
    () => routesResp.data?.routes ?? [],
    [routesResp.data],
  );
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
      {/* Rutas Críticas tab */}
      {tab === 'rutas' && (
        <section
          aria-label="Rutas Críticas"
          className="space-y-3"
          data-testid="driving-safety-rutas-section"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase font-bold text-secondary-token">
              Estado:
            </span>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  status === opt.value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-default-token text-secondary-token hover:text-primary-token'
                }`}
                data-testid={`driving-safety-status-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowCreateRoute(true)}
              className="ml-auto flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600"
              data-testid="driving-safety-new-route-button"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Nueva ruta
            </button>
          </div>

          {routesResp.loading && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="driving-safety-routes-loading"
            >
              Cargando…
            </div>
          )}

          {routesResp.error && (
            <div
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
              data-testid="driving-safety-routes-error"
              role="alert"
            >
              No se pudieron cargar las rutas: {routesResp.error.message}
            </div>
          )}

          {!routesResp.loading && !routesResp.error && routes.length === 0 && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-8 text-center"
              data-testid="driving-safety-routes-empty"
            >
              <Route
                className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                aria-hidden="true"
              />
              <p className="text-sm text-secondary-token italic">
                No hay rutas registradas para este filtro.
              </p>
            </div>
          )}

          {!routesResp.loading && !routesResp.error && routes.length > 0 && (
            <ul className="space-y-2" data-testid="driving-safety-routes-list">
              {routes.map((r) => {
                const meta = CRITICALITY_META[r.criticality];
                const alertIcon = r.activeAlert
                  ? ALERT_KIND_META[r.activeAlert.kind].icon
                  : null;
                const AlertIcon = alertIcon;
                return (
                  <li
                    key={r.id}
                    className={`rounded-xl border bg-surface p-3 shadow-mode ${meta.border}`}
                    data-testid={`driving-safety-route-${r.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${meta.color} ${meta.bg} ${meta.border}`}
                        data-testid={`driving-safety-route-criticality-${r.id}`}
                      >
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-primary-token">
                          {r.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-secondary-token">
                          {r.origin} → {r.destination} · {r.distanceKm}km · máx{' '}
                          {r.recommendedMaxSpeedKmh}km/h
                        </p>
                        {r.weatherSensitive && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
                            <Cloud className="w-3 h-3" aria-hidden="true" />
                            Clima sensible
                          </span>
                        )}
                        {r.hazards.length > 0 && (
                          <ul
                            className="mt-1.5 flex flex-wrap gap-1"
                            data-testid={`driving-safety-route-hazards-${r.id}`}
                          >
                            {r.hazards.map((h) => (
                              <li
                                key={h}
                                className="rounded-md border border-default-token bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase text-secondary-token"
                              >
                                {HAZARD_LABEL[h]}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.activeAlert && AlertIcon && (
                          <div
                            className="mt-2 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
                            data-testid={`driving-safety-route-alert-${r.id}`}
                            role="alert"
                          >
                            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold">
                                {ALERT_KIND_META[r.activeAlert.kind].label}
                              </p>
                              {r.activeAlert.note && (
                                <p className="mt-0.5 text-[11px]">
                                  {r.activeAlert.note}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAlertRouteId(r.id)}
                        className="shrink-0 rounded-lg border border-default-token bg-surface px-2 py-1 text-xs font-bold text-secondary-token transition-colors hover:text-rose-600"
                        data-testid={`driving-safety-route-flag-${r.id}`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                        {r.activeAlert ? 'Gestionar' : 'Reportar'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

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

      {showCreateRoute && projectId && (
        <NewRouteModal
          projectId={projectId}
          onClose={() => setShowCreateRoute(false)}
          onSuccess={() => {
            setShowCreateRoute(false);
            routesResp.refetch?.();
          }}
        />
      )}

      {alertRouteId && projectId && (
        <FlagAlertModal
          projectId={projectId}
          routeId={alertRouteId}
          hasOpenAlert={
            routes.find((r) => r.id === alertRouteId)?.activeAlert !== null &&
            routes.find((r) => r.id === alertRouteId)?.activeAlert !== undefined
          }
          onClose={() => setAlertRouteId(null)}
          onSuccess={() => {
            setAlertRouteId(null);
            routesResp.refetch?.();
          }}
        />
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
// Inline modal: nueva ruta crítica — copiado de DrivingSafety.tsx (copy es-CL plano)
// ────────────────────────────────────────────────────────────────────────

interface NewRouteModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function NewRouteModal({ projectId, onClose, onSuccess }: NewRouteModalProps) {
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [distanceKm, setDistanceKm] = useState<string>('50');
  const [criticality, setCriticality] = useState<DrivingRouteCriticality>('medium');
  const [hazards, setHazards] = useState<DrivingRouteHazard[]>([]);
  const [weatherSensitive, setWeatherSensitive] = useState(false);
  const [maxSpeed, setMaxSpeed] = useState<string>('60');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleHazard = (h: DrivingRouteHazard) => {
    setHazards((prev) =>
      prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h],
    );
  };

  const handleSubmit = async () => {
    const distance = Number(distanceKm);
    const speed = Number(maxSpeed);
    if (name.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    if (origin.trim().length < 2 || destination.trim().length < 2) {
      setError('Origen y destino son obligatorios.');
      return;
    }
    if (!Number.isFinite(distance) || distance < 0) {
      setError('Distancia inválida.');
      return;
    }
    if (!Number.isFinite(speed) || speed < 5 || speed > 200) {
      setError('Velocidad fuera de rango (5-200).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await registerRoute(projectId, {
        name: name.trim(),
        origin: origin.trim(),
        destination: destination.trim(),
        distanceKm: distance,
        criticality,
        hazards,
        weatherSensitive,
        recommendedMaxSpeedKmh: speed,
      });
      logger.info('drivingSafety.route.registered', { projectId, criticality });
      onSuccess();
    } catch (err) {
      logger.error('drivingSafety.route.register.failed', err);
      setError((err as Error).message || 'No se pudo registrar la ruta.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="driving-safety-new-route-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <header className="flex items-center gap-2">
          <Route className="w-5 h-5 text-blue-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            Nueva ruta crítica
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label="Cerrar"
            data-testid="driving-safety-new-route-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              Nombre
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="driving-safety-new-route-modal-name"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                Origen
              </span>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-new-route-modal-origin"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                Destino
              </span>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-new-route-modal-destination"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                Distancia (km)
              </span>
              <input
                type="number"
                min="0"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-new-route-modal-distance"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
                Vel. máx (km/h)
              </span>
              <input
                type="number"
                min="5"
                max="200"
                value={maxSpeed}
                onChange={(e) => setMaxSpeed(e.target.value)}
                className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
                data-testid="driving-safety-new-route-modal-speed"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              Criticidad
            </span>
            <select
              value={criticality}
              onChange={(e) =>
                setCriticality(e.target.value as DrivingRouteCriticality)
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="driving-safety-new-route-modal-criticality"
            >
              {CRITICALITY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CRITICALITY_META[c].label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="block">
            <legend className="block text-xs font-bold uppercase text-secondary-token mb-1">
              Hazards (selección múltiple)
            </legend>
            <div className="flex flex-wrap gap-1">
              {HAZARD_OPTIONS.map((h) => {
                const active = hazards.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => toggleHazard(h)}
                    className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'border-default-token bg-surface text-secondary-token hover:text-primary-token'
                    }`}
                    data-testid={`driving-safety-new-route-modal-hazard-${h}`}
                  >
                    {HAZARD_LABEL[h]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-xs text-secondary-token">
            <input
              type="checkbox"
              checked={weatherSensitive}
              onChange={(e) => setWeatherSensitive(e.target.checked)}
              data-testid="driving-safety-new-route-modal-weather"
            />
            <span>
              Sensible al clima (notificar al cambio de condiciones)
            </span>
          </label>
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="driving-safety-new-route-modal-error"
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
            data-testid="driving-safety-new-route-modal-cancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="driving-safety-new-route-modal-submit"
          >
            {submitting ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Inline modal: reportar / resolver alerta de ruta — copiado de DrivingSafety.tsx
// ────────────────────────────────────────────────────────────────────────

interface FlagAlertModalProps {
  projectId: string;
  routeId: string;
  hasOpenAlert: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function FlagAlertModal({
  projectId,
  routeId,
  hasOpenAlert,
  onClose,
  onSuccess,
}: FlagAlertModalProps) {
  const [kind, setKind] = useState<DrivingRouteAlertKind>('icy');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (resolve: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      await flagRouteAlert(projectId, routeId, {
        kind,
        note: note.trim() || undefined,
        resolve,
      });
      logger.info('drivingSafety.route.alert.recorded', { projectId, routeId, resolve });
      onSuccess();
    } catch (err) {
      logger.error('drivingSafety.route.alert.failed', err);
      setError((err as Error).message || 'No se pudo registrar la alerta.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="driving-safety-alert-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {hasOpenAlert ? 'Gestionar alerta' : 'Reportar alerta de ruta'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label="Cerrar"
            data-testid="driving-safety-alert-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            Tipo de alerta
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DrivingRouteAlertKind)}
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="driving-safety-alert-modal-kind"
          >
            {ALERT_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {ALERT_KIND_META[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
            Nota (opcional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ej: Helada km 45-50, visibilidad reducida."
            className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
            data-testid="driving-safety-alert-modal-note"
          />
        </label>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="driving-safety-alert-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="driving-safety-alert-modal-cancel"
          >
            Cancelar
          </button>
          {hasOpenAlert && (
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-bold text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
              data-testid="driving-safety-alert-modal-resolve"
            >
              Resolver actual
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="driving-safety-alert-modal-submit"
          >
            {submitting ? 'Guardando…' : 'Reportar'}
          </button>
        </div>
      </div>
    </div>
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
