// Praeventio Guard — Sprint K §214-215 page wrapper.
//
// Centro de Observaciones Positivas + Balance Positivo/Correctivo.
// Cultura preventiva sana NO solo registra lo malo: también reconoce
// comportamientos seguros, ideas de mejora, intervenciones útiles. El
// balance (§215) mide la salud cultural — un sitio con sólo feedback
// negativo es señal de cultura punitiva.
//
// Esta página:
//   1. Lee observaciones del período seleccionado via
//      `usePositiveObservations`.
//   2. Lee el balance positivas vs correctivas (`usePositiveObservationBalance`).
//   3. Permite registrar una nueva observación con un formulario simple
//      (trabajador + categoría + comentario). El observerUid sale del
//      token (verifyAuth lo extrae en el servidor).
//
// Determinístico. No-bloqueante. NUNCA un trabajador queda atado a una
// observación negativa sin oportunidad de reconocimiento.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, WifiOff, Sparkles, PlusCircle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  usePositiveObservations,
  usePositiveObservationBalance,
  createPositiveObservation,
  type PositiveObservationPeriod,
} from '../hooks/useSprintK';
import type {
  PositiveObservation,
  PositiveObservationKind,
} from '../services/positiveObservations/positiveObservationsService';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Kind metadata for UI (label + icon color)
// ────────────────────────────────────────────────────────────────────────

const KIND_OPTIONS: Array<{ value: PositiveObservationKind; label: string }> = [
  { value: 'safe_behavior', label: 'Conducta segura' },
  { value: 'improvement_idea', label: 'Idea de mejora' },
  { value: 'helpful_intervention', label: 'Intervención útil' },
  { value: 'creative_workaround', label: 'Solución creativa' },
  { value: 'mentoring_action', label: 'Mentoría' },
];

function kindLabel(kind: PositiveObservationKind): string {
  return KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

// ────────────────────────────────────────────────────────────────────────
// Balance ring widget — green/amber/red based on §215 level
// ────────────────────────────────────────────────────────────────────────

interface BalanceWidgetProps {
  positive: number;
  corrective: number;
  ratio: number;
  level: 'punitive' | 'imbalanced' | 'balanced' | 'positive_skew';
  message: string;
  period: PositiveObservationPeriod;
}

function BalanceWidget({
  positive,
  corrective,
  ratio,
  level,
  message,
  period,
}: BalanceWidgetProps) {
  const ringClass = (() => {
    if (level === 'punitive') return 'ring-rose-500/40 text-rose-600 dark:text-rose-400';
    if (level === 'imbalanced') return 'ring-amber-500/40 text-amber-600 dark:text-amber-400';
    if (level === 'balanced') return 'ring-emerald-500/40 text-emerald-600 dark:text-emerald-400';
    return 'ring-teal-500/40 text-teal-600 dark:text-teal-400';
  })();

  const periodLabel = period === '30d' ? '30 días' : period === '90d' ? '90 días' : 'Todas';

  return (
    <div
      className="rounded-2xl border border-default-token bg-surface p-5 sm:p-6"
      data-testid="positive-balance-widget"
    >
      <div className="flex items-start gap-5">
        <div
          className={`w-24 h-24 rounded-full ring-4 ${ringClass} flex flex-col items-center justify-center bg-surface shrink-0`}
          aria-label={`Balance ${level}`}
        >
          <span className="text-2xl font-black tabular-nums" data-testid="balance-ratio">
            {ratio.toFixed(1)}
          </span>
          <span className="text-[10px] uppercase tracking-widest opacity-80">ratio</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
              Balance positivo / correctivo
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-secondary-token">
              {periodLabel}
            </span>
          </div>
          <p
            className="mt-1.5 text-xs sm:text-sm text-secondary-token"
            data-testid="balance-message"
          >
            {message}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <dt className="uppercase tracking-widest text-[10px] text-emerald-600 dark:text-emerald-400">
                Positivas
              </dt>
              <dd
                className="mt-0.5 text-xl font-black text-emerald-700 dark:text-emerald-300 tabular-nums"
                data-testid="balance-positive-count"
              >
                {positive}
              </dd>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <dt className="uppercase tracking-widest text-[10px] text-rose-600 dark:text-rose-400">
                Correctivas
              </dt>
              <dd
                className="mt-0.5 text-xl font-black text-rose-700 dark:text-rose-300 tabular-nums"
                data-testid="balance-corrective-count"
              >
                {corrective}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Period chips toolbar
// ────────────────────────────────────────────────────────────────────────

interface PeriodChipsProps {
  value: PositiveObservationPeriod;
  onChange: (next: PositiveObservationPeriod) => void;
}

function PeriodChips({ value, onChange }: PeriodChipsProps) {
  const opts: Array<{ value: PositiveObservationPeriod; label: string }> = [
    { value: '30d', label: '30 días' },
    { value: '90d', label: '90 días' },
    { value: 'all', label: 'Todas' },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Período">
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={
              active
                ? 'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-teal-500/15 text-teal-600 dark:text-teal-300 border border-teal-500/30'
                : 'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-surface text-secondary-token border border-default-token hover:border-teal-500/30'
            }
            data-testid={`period-chip-${o.value}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// New observation form
// ────────────────────────────────────────────────────────────────────────

interface NewObservationFormProps {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

function NewObservationForm({ projectId, onClose, onSaved }: NewObservationFormProps) {
  const [workerUid, setWorkerUid] = useState('');
  const [kind, setKind] = useState<PositiveObservationKind>('safe_behavior');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    workerUid.trim().length > 0 &&
    description.trim().length >= 5 &&
    location.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPositiveObservation(projectId, {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `po_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        observedWorkerUid: workerUid.trim(),
        kind,
        description: description.trim(),
        observedAt: new Date().toISOString(),
        location: location.trim(),
        shared: false,
      });
      logger.info('positiveObs.created', { projectId, kind });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('positiveObs.create.failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
      data-testid="positive-obs-form"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-teal-500" aria-hidden="true" />
        <h3 className="text-sm font-black uppercase tracking-tight text-primary-token">
          Nueva observación positiva
        </h3>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          Trabajador observado (UID o nombre)
        </label>
        <input
          type="text"
          value={workerUid}
          onChange={(e) => setWorkerUid(e.target.value)}
          placeholder="ej. uid_abc123"
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="positive-obs-worker-input"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          Categoría
        </label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PositiveObservationKind)}
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="positive-obs-kind-select"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          Ubicación
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="ej. Frente de obra norte"
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="positive-obs-location-input"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          Comentario
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="¿Qué viste que valió la pena reconocer?"
          rows={3}
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="positive-obs-description-input"
        />
      </div>
      {error && (
        <div
          className="text-xs text-rose-600 dark:text-rose-400"
          data-testid="positive-obs-form-error"
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-secondary-token hover:text-primary-token"
          data-testid="positive-obs-form-cancel"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!valid || submitting}
          className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-teal-500 text-white disabled:bg-zinc-400 disabled:cursor-not-allowed"
          data-testid="positive-obs-form-submit"
        >
          {submitting ? 'Guardando…' : 'Registrar'}
        </button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Observation card
// ────────────────────────────────────────────────────────────────────────

function ObservationCard({ obs }: { obs: PositiveObservation }) {
  const date = (() => {
    try {
      const d = new Date(obs.observedAt);
      if (Number.isNaN(d.getTime())) return obs.observedAt;
      return d.toLocaleDateString('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return obs.observedAt;
    }
  })();
  return (
    <article
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-2"
      data-testid="positive-obs-card"
    >
      <div className="flex items-start gap-2 justify-between">
        <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-teal-500/10 text-teal-600 dark:text-teal-300 border border-teal-500/20">
          {kindLabel(obs.kind)}
        </span>
        <span className="text-[10px] text-secondary-token tabular-nums">{date}</span>
      </div>
      <p className="text-sm text-primary-token leading-snug">{obs.description}</p>
      <dl className="grid grid-cols-2 gap-2 text-[11px] text-secondary-token">
        <div>
          <dt className="uppercase tracking-widest text-[9px] opacity-70">Trabajador</dt>
          <dd className="font-mono">{obs.observedWorkerUid}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-[9px] opacity-70">Observador</dt>
          <dd className="font-mono">{obs.observerUid}</dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-widest text-[9px] opacity-70">Ubicación</dt>
          <dd>{obs.location}</dd>
        </div>
      </dl>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export function PositiveObservations() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const [period, setPeriod] = useState<PositiveObservationPeriod>('30d');
  const [formOpen, setFormOpen] = useState(false);

  const listResp = usePositiveObservations(projectId, { period });
  const balanceResp = usePositiveObservationBalance(projectId, period);

  const loading = listResp.loading || balanceResp.loading;
  const error = listResp.error || balanceResp.error;

  const observations = useMemo(() => listResp.data?.observations ?? [], [listResp.data]);

  const handleSaved = () => {
    setFormOpen(false);
    listResp.refetch?.();
    balanceResp.refetch?.();
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="positive-obs-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Award className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('positiveObs.page.title', 'Observaciones Positivas')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'positiveObs.page.selectProject',
              'Selecciona un proyecto para registrar y revisar observaciones positivas.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="positive-obs-page"
    >
      <header className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Award className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('positiveObs.page.title', 'Observaciones Positivas')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'positiveObs.page.subtitle',
              'Refuerza la cultura preventiva — §214-215. {{count}} observaciones cargadas.',
              { count: observations.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="positive-obs-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-teal-500 text-white hover:bg-teal-600 transition-colors"
          data-testid="positive-obs-new-button"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {formOpen ? 'Cerrar' : 'Nueva observación'}
        </button>
      </header>

      {formOpen && (
        <NewObservationForm
          projectId={projectId!}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {balanceResp.data && (
        <BalanceWidget
          positive={balanceResp.data.positive}
          corrective={balanceResp.data.corrective}
          ratio={balanceResp.data.ratio}
          level={balanceResp.data.balance.level}
          message={balanceResp.data.balance.message}
          period={balanceResp.data.period}
        />
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PeriodChips value={period} onChange={setPeriod} />
        <span className="text-[10px] uppercase tracking-widest text-secondary-token">
          §214-215 Cultura Preventiva
        </span>
      </div>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="positive-obs-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="positive-obs-error"
          role="alert"
        >
          {t('positiveObs.page.error', 'No se pudieron cargar las observaciones: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && observations.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="positive-obs-empty"
        >
          <Sparkles
            className="w-10 h-10 mx-auto mb-3 text-teal-500/70"
            aria-hidden="true"
          />
          <p className="text-sm text-primary-token font-medium">
            {t(
              'positiveObs.page.emptyTitle',
              'Aún no hay observaciones positivas en este período.',
            )}
          </p>
          <p className="mt-2 text-xs text-secondary-token max-w-md mx-auto">
            {t(
              'positiveObs.page.emptyHint',
              'Captura cuando veas algo bien hecho — refuerza la cultura.',
            )}
          </p>
        </div>
      )}

      {!loading && !error && observations.length > 0 && (
        <div
          className="grid gap-3 sm:grid-cols-2"
          data-testid="positive-obs-list"
        >
          {observations.map((o) => (
            <ObservationCard key={o.id} obs={o} />
          ))}
        </div>
      )}
    </div>
  );
}

export default PositiveObservations;
