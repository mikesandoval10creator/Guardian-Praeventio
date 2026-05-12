// Praeventio Guard — Sprint 40 F.4: <CorrectiveActionsCenterPanel />
//
// Dashboard central PDCA: lista de acciones correctivas con filtro
// (source + status), stats PDCA visuales y trigger para programar review
// de eficacia sobre acciones cerradas (F.11).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Filter, CalendarCheck } from 'lucide-react';
import {
  assessProgressPDCA,
  scheduleEffectivenessReview,
  linkToSemaforo,
  type CorrectiveActionRecord,
  type CorrectiveActionSource,
  type CorrectiveActionStatus,
  type EffectivenessReviewEntry,
  type PdcaPhase,
} from '../../services/correctiveActions/correctiveActionsCenter.js';

interface Props {
  actions: CorrectiveActionRecord[];
  /** Callback al programar un review de eficacia. */
  onScheduleReview?: (entry: EffectivenessReviewEntry) => void;
  /** Inyectable para tests deterministas. */
  now?: Date;
}

const SOURCE_FILTERS: Array<{ value: CorrectiveActionSource | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'inspection', label: 'Inspección' },
  { value: 'audit', label: 'Auditoría' },
  { value: 'document_expiry', label: 'Vencimiento' },
  { value: 'incident', label: 'Incidente' },
  { value: 'training_gap', label: 'Capacitación' },
];

const STATUS_FILTERS: Array<{ value: CorrectiveActionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'closed', label: 'Cerradas' },
  { value: 'verified', label: 'Verificadas' },
  { value: 'reopened', label: 'Reabiertas' },
];

const PHASE_TONE: Record<PdcaPhase, string> = {
  plan: 'bg-sky-500',
  do: 'bg-amber-500',
  check: 'bg-violet-500',
  act: 'bg-emerald-500',
};

const PHASE_ORDER: PdcaPhase[] = ['plan', 'do', 'check', 'act'];

const SEMAFORO_TONE: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
};

export function CorrectiveActionsCenterPanel({ actions, onScheduleReview, now }: Props) {
  const { t } = useTranslation();
  const [sourceFilter, setSourceFilter] = useState<CorrectiveActionSource | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<CorrectiveActionStatus | 'all'>('all');

  const filtered = useMemo(
    () =>
      actions.filter(
        (a) =>
          (sourceFilter === 'all' || a.source === sourceFilter) &&
          (statusFilter === 'all' || a.status === statusFilter),
      ),
    [actions, sourceFilter, statusFilter],
  );

  const report = useMemo(() => assessProgressPDCA(actions), [actions]);

  function handleSchedule(action: CorrectiveActionRecord) {
    const entry = scheduleEffectivenessReview(action);
    if (entry && onScheduleReview) onScheduleReview(entry);
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="corrective-actions-center-panel"
      aria-label={t('caCenter.aria', 'Centro de acciones correctivas') as string}
    >
      <header className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-teal-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('caCenter.title', 'Centro de acciones correctivas')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">
          {report.total} {t('caCenter.totalLabel', 'acciones')}
        </span>
      </header>

      {/* Stats PDCA */}
      <div data-testid="caCenter-pdca-stats" className="space-y-1.5">
        <div className="text-[10px] uppercase font-bold text-secondary-token">
          {t('caCenter.pdcaStats', 'Progreso PDCA')}
        </div>
        {PHASE_ORDER.map((phase) => {
          const count = report.byPhase[phase];
          const pct = report.total > 0 ? Math.round((count / report.total) * 100) : 0;
          return (
            <div key={phase} data-testid={`caCenter-phase-row-${phase}`}>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="uppercase font-bold">{phase}</span>
                <span className="tabular-nums text-secondary-token">
                  {count} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 bg-surface-elevated rounded overflow-hidden">
                <div
                  className={`h-full ${PHASE_TONE[phase]}`}
                  style={{ width: `${pct}%` }}
                  data-testid={`caCenter-phase-bar-${phase}`}
                />
              </div>
            </div>
          );
        })}
        <div className="text-[10px] text-secondary-token pt-1" data-testid="caCenter-pdca-message">
          {report.message}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center text-[10px]" data-testid="caCenter-filters">
        <Filter className="w-3 h-3 text-secondary-token" aria-hidden="true" />
        <label className="flex items-center gap-1">
          <span className="uppercase font-bold">{t('caCenter.sourceLabel', 'Origen')}:</span>
          <select
            data-testid="caCenter-source-filter"
            className="bg-surface-elevated rounded px-1 py-0.5"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as CorrectiveActionSource | 'all')}
          >
            {SOURCE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="uppercase font-bold">{t('caCenter.statusLabel', 'Estado')}:</span>
          <select
            data-testid="caCenter-status-filter"
            className="bg-surface-elevated rounded px-1 py-0.5"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CorrectiveActionStatus | 'all')}
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Lista */}
      <ul data-testid="caCenter-list" className="space-y-2">
        {filtered.length === 0 && (
          <li
            className="text-[11px] text-secondary-token italic"
            data-testid="caCenter-empty"
          >
            {t('caCenter.empty', 'No hay acciones que coincidan con los filtros.')}
          </li>
        )}
        {filtered.map((a) => {
          const impact = linkToSemaforo(a, now);
          const isClosed = a.status === 'closed' || a.status === 'verified';
          return (
            <li
              key={a.id}
              data-testid={`caCenter-row-${a.id}`}
              className="border border-default-token rounded p-2 space-y-1"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  data-testid={`caCenter-semaforo-${a.id}`}
                  className={`w-2 h-2 rounded-full ${SEMAFORO_TONE[impact.color]}`}
                  aria-label={impact.color}
                />
                <span className="uppercase text-[10px] font-bold text-secondary-token">
                  {a.source}
                </span>
                <span className="ml-auto text-[10px] uppercase font-bold">{a.status}</span>
              </div>
              <div className="text-[11px]">{a.description}</div>
              <div className="flex items-center justify-between text-[10px] text-secondary-token">
                <span>
                  {t('caCenter.dueDate', 'Vence')}: {a.dueDate.slice(0, 10)}
                </span>
                {isClosed && (
                  <button
                    type="button"
                    data-testid={`caCenter-schedule-${a.id}`}
                    onClick={() => handleSchedule(a)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20"
                  >
                    <CalendarCheck className="w-3 h-3" aria-hidden="true" />
                    {t('caCenter.scheduleReview', 'Programar review')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
