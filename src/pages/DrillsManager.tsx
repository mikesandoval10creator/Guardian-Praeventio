// Praeventio Guard — Fase F.20 page wrapper.
//
// Gestor de Simulacros: planifica + ejecuta + reporta simulacros DS 132
// / DS 594 (evacuación, incendio, derrame químico, primeros auxilios,
// rescate confinado/altura, fuga de gas, sismo). Consume el endpoint
// `/api/sprint-k/:projectId/drills` y los mutadores `planDrill` /
// `executeDrill`.
//
// El detalle vive en un modal in-page (siguiendo la convención de
// `Inbox.tsx` que mantiene todo el flujo en una sola ruta — el
// prevencionista no pierde contexto de la lista al revisar un
// simulacro individual).

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  WifiOff,
  Plus,
  Flame,
  Droplet,
  HeartPulse,
  Mountain,
  ArrowUp,
  Wind,
  Activity,
  Users,
  CalendarClock,
  X,
  CheckCircle2,
  Clock,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useDrills,
  planDrill,
  executeDrill,
  type DrillRecord,
  type DrillKindAPI,
  type DrillStatusAPI,
  type DrillLevelAPI,
} from '../hooks/useDrillsManager';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────
//
// Color palette and iconography per drill kind. Kept inline (not a
// shared component) because the surface is small and the page is the
// only consumer for now.

const KIND_META: Record<
  DrillKindAPI,
  { label: string; icon: typeof Flame; color: string; border: string; bg: string }
> = {
  evacuation: {
    label: 'Evacuación',
    icon: Users,
    color: 'text-teal-500',
    border: 'border-teal-500/30',
    bg: 'bg-teal-500/10',
  },
  fire: {
    label: 'Incendio',
    icon: Flame,
    color: 'text-rose-500',
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/10',
  },
  spill_chemical: {
    label: 'Derrame químico',
    icon: Droplet,
    color: 'text-amber-500',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
  },
  first_aid: {
    label: 'Primeros auxilios',
    icon: HeartPulse,
    color: 'text-pink-500',
    border: 'border-pink-500/30',
    bg: 'bg-pink-500/10',
  },
  rescue_confined: {
    label: 'Rescate confinado',
    icon: Mountain,
    color: 'text-violet-500',
    border: 'border-violet-500/30',
    bg: 'bg-violet-500/10',
  },
  rescue_height: {
    label: 'Rescate altura',
    icon: ArrowUp,
    color: 'text-blue-500',
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
  },
  gas_leak: {
    label: 'Fuga de gas',
    icon: Wind,
    color: 'text-yellow-500',
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/10',
  },
  earthquake: {
    label: 'Sismo',
    icon: Activity,
    color: 'text-orange-500',
    border: 'border-orange-500/30',
    bg: 'bg-orange-500/10',
  },
};

const STATUS_META: Record<
  DrillStatusAPI,
  { label: string; color: string; icon: typeof Clock }
> = {
  planned: { label: 'Planeado', color: 'text-blue-500', icon: Clock },
  in_progress: {
    label: 'En curso',
    color: 'text-amber-500',
    icon: PlayCircle,
  },
  completed: {
    label: 'Completado',
    color: 'text-emerald-500',
    icon: CheckCircle2,
  },
  cancelled: { label: 'Cancelado', color: 'text-zinc-500', icon: XCircle },
};

const LEVEL_META: Record<
  DrillLevelAPI,
  { label: string; color: string; bg: string }
> = {
  excellent: {
    label: 'Excelente',
    color: 'text-emerald-600',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  good: {
    label: 'Bueno',
    color: 'text-teal-600',
    bg: 'bg-teal-500/10 border-teal-500/30',
  },
  needs_improvement: {
    label: 'Mejorar',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10 border-amber-500/30',
  },
  critical: {
    label: 'Crítico',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10 border-rose-500/30',
  },
  // Codex PR #316 P2: nuevo nivel cuando faltan baselines reales
  // (`expectedCount` / `benchmarkSeconds`). Se muestra en gris para no
  // confundirlo con un grading real — no es "Excelente por default".
  insufficient_baseline: {
    label: 'Baseline insuficiente',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10 border-zinc-500/30',
  },
};

const KIND_OPTIONS: DrillKindAPI[] = [
  'evacuation',
  'fire',
  'spill_chemical',
  'first_aid',
  'rescue_confined',
  'rescue_height',
  'gas_leak',
  'earthquake',
];

const STATUS_OPTIONS: { value: DrillStatusAPI | 'all'; label: string }[] = [
  { value: 'planned', label: 'Planeados' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Completados' },
  { value: 'all', label: 'Todos' },
];

/**
 * Conservative countdown text. Negative deltas render as "Atrasado Nd"
 * so the prevencionista immediately spots overdue drills without doing
 * the math.
 */
function countdownLabel(scheduledAtIso: string, nowMs: number): string {
  const ts = Date.parse(scheduledAtIso);
  if (Number.isNaN(ts)) return scheduledAtIso;
  const deltaMs = ts - nowMs;
  const absDays = Math.floor(Math.abs(deltaMs) / 86_400_000);
  if (deltaMs < 0) {
    if (absDays === 0) return 'Hoy (atrasado)';
    return `Atrasado ${absDays}d`;
  }
  if (absDays === 0) return 'Hoy';
  if (absDays === 1) return 'Mañana';
  return `En ${absDays}d`;
}

export function DrillsManager() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [statusFilter, setStatusFilter] = useState<DrillStatusAPI | 'all'>(
    'planned',
  );
  const [kindFilter, setKindFilter] = useState<DrillKindAPI | null>(null);
  const [selectedDrillId, setSelectedDrillId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  // Codex PR #316 P2 (line 330): banner page-level para fallos de
  // ejecución. Antes el catch solo logueaba y el modal se cerraba,
  // descartando lo que el usuario había escrito. Ahora `handleExecute`
  // re-lanza el error; el modal queda abierto (no se cierra hasta que
  // resuelve OK) y el banner aparece arriba con el detalle.
  const [executeError, setExecuteError] = useState<string | null>(null);

  // For "all" status we fetch each tracked status independently and merge
  // — the endpoint takes a single optional `status`, so the simplest way
  // to show every record is to issue parallel queries. Pattern mirrors
  // `CorrectiveActions.tsx`.
  const plannedResp = useDrills(projectId, {
    status: 'planned',
    ...(kindFilter ? { kind: kindFilter } : {}),
  });
  const inProgressResp = useDrills(projectId, {
    status: 'in_progress',
    ...(kindFilter ? { kind: kindFilter } : {}),
  });
  const completedResp = useDrills(projectId, {
    status: 'completed',
    ...(kindFilter ? { kind: kindFilter } : {}),
  });
  const cancelledResp = useDrills(projectId, {
    status: 'cancelled',
    ...(kindFilter ? { kind: kindFilter } : {}),
  });

  const loading =
    plannedResp.loading ||
    (statusFilter === 'all' &&
      (inProgressResp.loading ||
        completedResp.loading ||
        cancelledResp.loading));

  const error =
    statusFilter === 'planned'
      ? plannedResp.error
      : statusFilter === 'in_progress'
        ? inProgressResp.error
        : statusFilter === 'completed'
          ? completedResp.error
          : plannedResp.error ||
            inProgressResp.error ||
            completedResp.error ||
            cancelledResp.error;

  const drills: DrillRecord[] = useMemo(() => {
    if (statusFilter === 'planned') return plannedResp.data?.drills ?? [];
    if (statusFilter === 'in_progress') return inProgressResp.data?.drills ?? [];
    if (statusFilter === 'completed') return completedResp.data?.drills ?? [];
    return [
      ...(plannedResp.data?.drills ?? []),
      ...(inProgressResp.data?.drills ?? []),
      ...(completedResp.data?.drills ?? []),
      ...(cancelledResp.data?.drills ?? []),
    ];
  }, [
    statusFilter,
    plannedResp.data,
    inProgressResp.data,
    completedResp.data,
    cancelledResp.data,
  ]);

  // Stable "now" for countdowns within one render pass. Updates every
  // 60s so a long-lived view doesn't keep showing stale "Mañana"
  // labels past midnight.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const selectedDrill = useMemo(() => {
    if (!selectedDrillId) return null;
    return drills.find((d) => d.id === selectedDrillId) ?? null;
  }, [drills, selectedDrillId]);

  const refetchAll = () => {
    plannedResp.refetch?.();
    inProgressResp.refetch?.();
    completedResp.refetch?.();
    cancelledResp.refetch?.();
  };

  const handlePlan = async (payload: {
    kind: DrillKindAPI;
    scheduledAt: string;
    responsibleUid: string;
    title?: string;
    location?: string;
    expectedCount?: number;
    benchmarkSeconds?: number;
  }) => {
    if (!projectId) return;
    // Codex PR #316 R2 P2 (line 323): re-lanzamos el error si el plan
    // falla (offline / unauthorized / Firestore down). Antes el catch
    // solo logueaba y resolvía OK al modal, que cerraba sin avisar y el
    // planner creía que el simulacro estaba guardado. Ahora propaga
    // para que `NewDrillModal` muestre el banner inline y reintente.
    try {
      const id = `drill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await planDrill(projectId, { id, ...payload });
      logger.info('drills.plan.created', { projectId, id, kind: payload.kind });
      setShowNewModal(false);
      refetchAll();
    } catch (err) {
      logger.error('drills.plan.failed', err);
      throw err;
    }
  };

  const handleExecute = async (
    drillId: string,
    payload: {
      executedAt: string;
      participantCount: number;
      responseTimeSeconds: number;
      observedGaps?: string[];
      requiredExternal?: boolean;
      notes?: string;
    },
  ) => {
    if (!projectId) return;
    // Codex PR #316 P2 (line 330): re-lanzamos el error en vez de
    // silenciarlo. Antes el catch loggeaba y resolvía OK, el
    // `onExecute` callback continuaba y cerraba el modal — el usuario
    // pensaba que se había guardado pero perdía lo escrito. Ahora el
    // page-level banner se actualiza y el modal NO se cierra (el
    // callback corta antes del `setSelectedDrillId(null)`).
    setExecuteError(null);
    try {
      await executeDrill(projectId, drillId, payload);
      logger.info('drills.execute.recorded', { projectId, drillId });
      refetchAll();
    } catch (err) {
      logger.error('drills.execute.failed', err);
      const msg =
        err instanceof Error
          ? err.message
          : t('drills.execute.errorFallback', 'No se pudo registrar la ejecución.');
      setExecuteError(msg);
      throw err;
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="drills-manager-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ShieldAlert
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('drills.page.title', 'Gestor de Simulacros')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'drills.page.selectProject',
              'Selecciona un proyecto para planificar y registrar simulacros.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="drills-manager-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <ShieldAlert className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('drills.page.title', 'Gestor de Simulacros')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'drills.page.subtitle',
              'DS 132 / DS 594 — planifica, ejecuta y reporta tu preparación.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="drills-manager-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className={`${isOnline ? 'ml-auto' : ''} inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold uppercase tracking-wide transition-colors shadow-sm`}
          data-testid="drills-manager-new-button"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('drills.page.newButton', 'Nuevo Simulacro')}
        </button>
      </header>

      {/* Filters */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-3 sm:p-4 space-y-3"
        data-testid="drills-manager-filters"
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mb-2">
            {t('drills.filters.statusLabel', 'Estado')}
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((opt) => {
              const active = statusFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                    active
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300'
                      : 'bg-surface border-default-token text-secondary-token hover:text-primary-token'
                  }`}
                  data-testid={`drills-status-chip-${opt.value}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mb-2">
            {t('drills.filters.kindLabel', 'Tipo')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setKindFilter(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                kindFilter === null
                  ? 'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300'
                  : 'bg-surface border-default-token text-secondary-token hover:text-primary-token'
              }`}
              data-testid="drills-kind-chip-all"
            >
              {t('drills.filters.kindAll', 'Todos')}
            </button>
            {KIND_OPTIONS.map((k) => {
              const meta = KIND_META[k];
              const active = kindFilter === k;
              const Icon = meta.icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                    active
                      ? `${meta.bg} ${meta.border} ${meta.color}`
                      : 'bg-surface border-default-token text-secondary-token hover:text-primary-token'
                  }`}
                  data-testid={`drills-kind-chip-${k}`}
                >
                  <Icon className="w-3 h-3" aria-hidden="true" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="drills-manager-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="drills-manager-error"
          role="alert"
        >
          {t(
            'drills.page.error',
            'No se pudieron cargar los simulacros: {{msg}}',
            { msg: error.message },
          )}
        </div>
      )}

      {/* Codex PR #316 R2 P2 (line 525): el banner de error de ejecución
          se renderiza ahora DENTRO de `DrillDetailModal` para que sea
          visible sobre el backdrop `z-50`. Antes vivía aquí en el page
          content y quedaba oculto detrás del modal. */}

      {!loading && !error && drills.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="drills-manager-empty"
        >
          <ShieldAlert
            className="w-10 h-10 mx-auto mb-3 text-amber-500/70"
            aria-hidden="true"
          />
          <p className="text-sm font-bold text-primary-token">
            {t(
              'drills.page.emptyTitle',
              'Aún no hay simulacros en este filtro.',
            )}
          </p>
          <p className="mt-1 text-xs text-secondary-token">
            {t(
              'drills.page.emptyEncourage',
              'Planifica el primer simulacro del mes — DS 132 exige al menos uno semestral por turno.',
            )}
          </p>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold uppercase tracking-wide transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t('drills.page.newButton', 'Nuevo Simulacro')}
          </button>
        </div>
      )}

      {!loading && !error && drills.length > 0 && (
        <ul
          className="space-y-3"
          data-testid="drills-manager-list"
        >
          {drills.map((drill) => {
            const meta = KIND_META[drill.kind];
            const status = STATUS_META[drill.status];
            const Icon = meta.icon;
            const StatusIcon = status.icon;
            const level = drill.report?.level;
            return (
              <li key={drill.id}>
                <button
                  type="button"
                  onClick={() => setSelectedDrillId(drill.id)}
                  className="w-full text-left rounded-2xl border border-default-token bg-surface p-4 hover:border-teal-500/40 hover:shadow-md transition-all"
                  data-testid={`drills-card-${drill.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl ${meta.bg} ${meta.color} flex items-center justify-center border ${meta.border} shrink-0`}
                    >
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}
                        >
                          {meta.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${status.color}`}
                        >
                          <StatusIcon className="w-3 h-3" aria-hidden="true" />
                          {status.label}
                        </span>
                        {level && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${LEVEL_META[level].bg} ${LEVEL_META[level].color}`}
                            data-testid={`drills-level-${drill.id}`}
                          >
                            {LEVEL_META[level].label}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-bold text-primary-token truncate">
                        {drill.title ?? meta.label}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-secondary-token">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock
                            className="w-3 h-3"
                            aria-hidden="true"
                          />
                          {countdownLabel(drill.scheduledAt, nowMs)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3 h-3" aria-hidden="true" />
                          {drill.responsibleUid}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedDrill && (
        <DrillDetailModal
          drill={selectedDrill}
          executeError={executeError}
          onDismissExecuteError={() => setExecuteError(null)}
          onClose={() => {
            setExecuteError(null);
            setSelectedDrillId(null);
          }}
          onExecute={async (payload) => {
            // Codex PR #316 P2 (line 330): `handleExecute` ahora re-lanza
            // en fallo. Dejamos que la excepción propague para que el
            // modal NO se cierre (la línea `setSelectedDrillId(null)` no
            // se ejecuta) y el banner DENTRO del modal (Codex PR #316 R2
            // P2, line 525) surfacée el error sobre el backdrop.
            await handleExecute(selectedDrill.id, payload);
            setSelectedDrillId(null);
          }}
        />
      )}

      {showNewModal && (
        <NewDrillModal
          onClose={() => setShowNewModal(false)}
          onPlan={handlePlan}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail modal
// ────────────────────────────────────────────────────────────────────────

function DrillDetailModal(props: {
  drill: DrillRecord;
  /**
   * Codex PR #316 R2 P2 (line 525): el banner del page-level vivía detrás
   * del backdrop `z-50` del modal, así que el usuario nunca lo veía. Lo
   * recibimos como prop y lo renderizamos DENTRO del modal, sobre el
   * formulario, para que el feedback sea visible cuando `onExecute`
   * rechaza.
   */
  executeError: string | null;
  onDismissExecuteError: () => void;
  onClose: () => void;
  onExecute: (payload: {
    executedAt: string;
    participantCount: number;
    responseTimeSeconds: number;
    observedGaps?: string[];
    requiredExternal?: boolean;
    notes?: string;
  }) => Promise<void>;
}) {
  const { drill, executeError, onDismissExecuteError, onClose, onExecute } = props;
  const { t } = useTranslation();
  const meta = KIND_META[drill.kind];
  const Icon = meta.icon;
  const [submitting, setSubmitting] = useState(false);
  const [participantCount, setParticipantCount] = useState<string>(
    String(drill.participantCount ?? ''),
  );
  const [responseTimeSeconds, setResponseTimeSeconds] = useState<string>(
    String(drill.responseTimeSeconds ?? ''),
  );
  const [observedGapsText, setObservedGapsText] = useState<string>(
    (drill.observedGaps ?? []).join('\n'),
  );
  const [requiredExternal, setRequiredExternal] = useState<boolean>(
    drill.requiredExternal ?? false,
  );
  const [notes, setNotes] = useState<string>(drill.notes ?? '');

  const canExecute = drill.status !== 'completed' && drill.status !== 'cancelled';

  const handleSubmit = async () => {
    const participants = Number.parseInt(participantCount, 10);
    const response = Number.parseInt(responseTimeSeconds, 10);
    if (Number.isNaN(participants) || Number.isNaN(response)) {
      return;
    }
    setSubmitting(true);
    try {
      const gaps = observedGapsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await onExecute({
        executedAt: new Date().toISOString(),
        participantCount: participants,
        responseTimeSeconds: response,
        observedGaps: gaps,
        requiredExternal,
        notes: notes.trim().length > 0 ? notes : undefined,
      });
    } catch {
      // Codex PR #316 P2 (line 330): el page-level `handleExecute` ya
      // loguea + setea el banner. Acá solo evitamos la unhandled
      // rejection y dejamos el modal abierto (no llamamos `onClose`).
      // El form preserva todo lo que el usuario escribió.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="drills-detail-modal"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-default-token shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-default-token">
          <div
            className={`w-10 h-10 rounded-xl ${meta.bg} ${meta.color} flex items-center justify-center border ${meta.border}`}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}
            >
              {meta.label}
            </p>
            <p className="text-sm font-bold text-primary-token truncate">
              {drill.title ?? meta.label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-secondary-token"
            data-testid="drills-detail-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.scheduledAt', 'Programado')}
              </dt>
              <dd className="text-primary-token">
                {new Date(drill.scheduledAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.status', 'Estado')}
              </dt>
              <dd className={STATUS_META[drill.status].color}>
                {STATUS_META[drill.status].label}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.responsible', 'Responsable')}
              </dt>
              <dd className="text-primary-token break-all">
                {drill.responsibleUid}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.location', 'Ubicación')}
              </dt>
              <dd className="text-primary-token">
                {drill.location ?? '—'}
              </dd>
            </div>
          </dl>

          {drill.report && (
            <div
              className={`rounded-xl p-3 border ${LEVEL_META[drill.report.level].bg}`}
              data-testid="drills-detail-report"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.report', 'Reporte de preparación')}
              </p>
              <p
                className={`text-sm font-black ${LEVEL_META[drill.report.level].color}`}
              >
                {LEVEL_META[drill.report.level].label}
              </p>
              {/* Codex PR #316 P2 (line 1300): participación / velocidad
                  pueden ser `null` cuando faltó el baseline. Mostramos
                  "—" en vez de "0%" o "+0%" para no engañar al lector. */}
              <p className="text-xs text-secondary-token mt-1">
                {t('drills.detail.participation', 'Participación')}:{' '}
                {drill.report.participationRate !== null
                  ? `${drill.report.participationRate}%`
                  : '—'}{' '}
                ·{' '}
                {t('drills.detail.speed', 'Velocidad')}:{' '}
                {drill.report.speedDeficitPercent !== null
                  ? `${drill.report.speedDeficitPercent >= 0 ? '+' : ''}${drill.report.speedDeficitPercent}%`
                  : '—'}
              </p>
              {drill.report.recommendations.length > 0 && (
                <ul className="mt-2 space-y-1 list-disc list-inside text-xs text-primary-token">
                  {drill.report.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canExecute && executeError && (
            // Codex PR #316 R2 P2 (line 525): banner dentro del modal,
            // sobre el formulario. Reemplaza el banner page-level (queda
            // detrás del backdrop z-50 y nunca era visible).
            <div
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2"
              data-testid="drills-detail-execute-error"
              role="alert"
            >
              <ShieldAlert
                className="w-4 h-4 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold uppercase tracking-widest text-[10px]">
                  {t('drills.page.executeErrorTitle', 'No se registró la ejecución')}
                </p>
                <p className="mt-1">
                  {t(
                    'drills.page.executeError',
                    'El simulacro no se guardó: {{msg}}. Tus datos siguen en el formulario — corrige y reintenta.',
                    { msg: executeError },
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onDismissExecuteError}
                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 shrink-0"
                aria-label={t('common.close', 'Cerrar')}
                data-testid="drills-detail-execute-error-dismiss"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {canExecute && (
            <div className="rounded-xl border border-default-token p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
                {t('drills.detail.executeTitle', 'Registrar ejecución')}
              </p>
              <label className="block text-xs text-secondary-token">
                {t('drills.detail.participants', 'Participantes')}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={participantCount}
                  onChange={(e) => setParticipantCount(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
                  data-testid="drills-detail-participants-input"
                />
              </label>
              <label className="block text-xs text-secondary-token">
                {t('drills.detail.responseSeconds', 'Tiempo respuesta (s)')}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={responseTimeSeconds}
                  onChange={(e) => setResponseTimeSeconds(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
                  data-testid="drills-detail-response-input"
                />
              </label>
              <label className="block text-xs text-secondary-token">
                {t('drills.detail.gapsLabel', 'Brechas observadas (una por línea)')}
                <textarea
                  rows={3}
                  value={observedGapsText}
                  onChange={(e) => setObservedGapsText(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-secondary-token">
                <input
                  type="checkbox"
                  checked={requiredExternal}
                  onChange={(e) => setRequiredExternal(e.target.checked)}
                />
                {t(
                  'drills.detail.requiredExternal',
                  'Requirió intervención externa',
                )}
              </label>
              <label className="block text-xs text-secondary-token">
                {t('drills.detail.notes', 'Observaciones generales')}
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
                />
              </label>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  participantCount.length === 0 ||
                  responseTimeSeconds.length === 0
                }
                className="w-full px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wide"
                data-testid="drills-detail-execute-button"
              >
                {submitting
                  ? t('common.saving', 'Guardando…')
                  : t('drills.detail.executeButton', 'Registrar y calcular reporte')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// New drill modal
// ────────────────────────────────────────────────────────────────────────

function NewDrillModal(props: {
  onClose: () => void;
  onPlan: (payload: {
    kind: DrillKindAPI;
    scheduledAt: string;
    responsibleUid: string;
    title?: string;
    location?: string;
    expectedCount?: number;
    benchmarkSeconds?: number;
  }) => Promise<void>;
}) {
  const { onClose, onPlan } = props;
  const { t } = useTranslation();
  const [kind, setKind] = useState<DrillKindAPI>('evacuation');
  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [responsibleUid, setResponsibleUid] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [expectedCount, setExpectedCount] = useState<string>('');
  const [benchmarkSeconds, setBenchmarkSeconds] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  // Codex PR #316 R2 P2 (line 323): estado de error inline para que el
  // planner vea cuando `onPlan` rechaza (offline / unauthorized /
  // Firestore down) en vez de creer que el simulacro se guardó. El
  // formulario sigue lleno para reintentar.
  const [planError, setPlanError] = useState<string | null>(null);

  const canSubmit =
    kind && scheduledAt.length > 0 && responsibleUid.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setPlanError(null);
    try {
      const ec = expectedCount.trim()
        ? Number.parseInt(expectedCount, 10)
        : undefined;
      const bm = benchmarkSeconds.trim()
        ? Number.parseInt(benchmarkSeconds, 10)
        : undefined;
      await onPlan({
        kind,
        scheduledAt: new Date(scheduledAt).toISOString(),
        responsibleUid: responsibleUid.trim(),
        title: title.trim().length > 0 ? title.trim() : undefined,
        location: location.trim().length > 0 ? location.trim() : undefined,
        expectedCount: ec !== undefined && !Number.isNaN(ec) ? ec : undefined,
        benchmarkSeconds: bm !== undefined && !Number.isNaN(bm) ? bm : undefined,
      });
    } catch (err) {
      // Codex PR #316 R2 P2 (line 323): el page-level `handlePlan` ahora
      // re-lanza. Capturamos acá para mostrar el banner inline sin
      // disparar unhandled rejection y dejar el form intacto.
      const msg =
        err instanceof Error
          ? err.message
          : t('drills.new.errorFallback', 'No se pudo guardar el simulacro.');
      setPlanError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      data-testid="drills-new-modal"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-default-token shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-default-token">
          <Plus
            className="w-5 h-5 text-teal-500"
            aria-hidden="true"
          />
          <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
            {t('drills.new.title', 'Planificar simulacro')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="ml-auto w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-secondary-token"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <label className="block text-xs text-secondary-token">
            {t('drills.new.kind', 'Tipo')}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DrillKindAPI)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-secondary-token">
            {t('drills.new.scheduledAt', 'Fecha y hora programada')}
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
            />
          </label>
          <label className="block text-xs text-secondary-token">
            {t('drills.new.responsible', 'UID responsable')}
            <input
              type="text"
              value={responsibleUid}
              onChange={(e) => setResponsibleUid(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
              placeholder="uid_responsable"
            />
          </label>
          <label className="block text-xs text-secondary-token">
            {t('drills.new.titleField', 'Título (opcional)')}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
            />
          </label>
          <label className="block text-xs text-secondary-token">
            {t('drills.new.location', 'Ubicación (opcional)')}
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-secondary-token">
              {t('drills.new.expectedCount', 'Personas esperadas')}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={expectedCount}
                onChange={(e) => setExpectedCount(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
              />
            </label>
            <label className="block text-xs text-secondary-token">
              {t('drills.new.benchmarkSeconds', 'Benchmark (s)')}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={benchmarkSeconds}
                onChange={(e) => setBenchmarkSeconds(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-default-token bg-canvas text-sm"
              />
            </label>
          </div>
          {planError && (
            // Codex PR #316 R2 P2 (line 323): banner inline cuando
            // `onPlan` rechaza (offline / unauthorized / Firestore
            // down). Antes el modal se cerraba en silencio y el planner
            // creía que el simulacro estaba guardado.
            <div
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2"
              data-testid="drills-new-plan-error"
              role="alert"
            >
              <ShieldAlert
                className="w-4 h-4 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold uppercase tracking-widest text-[10px]">
                  {t('drills.new.planErrorTitle', 'No se planificó el simulacro')}
                </p>
                <p className="mt-1">
                  {t(
                    'drills.new.planError',
                    'El simulacro no se guardó: {{msg}}. Tus datos siguen en el formulario — corrige y reintenta.',
                    { msg: planError },
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanError(null)}
                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 shrink-0"
                aria-label={t('common.close', 'Cerrar')}
                data-testid="drills-new-plan-error-dismiss"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="w-full px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wide"
            data-testid="drills-new-submit-button"
          >
            {submitting
              ? t('common.saving', 'Guardando…')
              : t('drills.new.submit', 'Planificar')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrillsManager;
