// Praeventio Guard — Sprint 39 Fase G.11 — Lone worker admin panel.
//
// Supervisor / brigade-leader desktop view. Lists active lone-worker
// sessions for the project, with derived status (active / overdue_warning /
// overdue_critical / help_requested / ended) and the escalation decision
// from `decideEscalation`. Sortable by criticality so the rows that need
// human action float to the top.
//
// Data flow: the parent dashboard wires this with the project's session
// list (Firestore subscription elsewhere); this component is presentational
// + a single `admin-overview` POST to the backend per refresh tick, which
// returns server-derived status + escalation. The server is the source of
// truth for "now" so client-clock skew never silently buries an overdue.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Siren,
  UserCheck,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type {
  LoneWorkerSession,
  LoneWorkerStatus,
  EscalationDecision,
} from '../../services/loneWorker/loneWorkerService';
import {
  fetchLoneWorkerAdminOverview,
  type AdminOverviewEntry,
} from '../../hooks/useLoneWorker';

export interface LoneWorkerAdminPanelProps {
  projectId: string;
  sessions: LoneWorkerSession[];
  /** Optional polling interval (ms). Default 30s. Pass 0 to disable. */
  pollIntervalMs?: number;
  /** Forwarded for click-to-detail navigation in the parent. */
  onRowClick?: (entry: AdminOverviewEntry) => void;
}

const STATUS_WEIGHT: Record<LoneWorkerStatus, number> = {
  help_requested: 0,
  overdue_critical: 1,
  overdue_warning: 2,
  active: 3,
  ended: 4,
};

const STATUS_META: Record<
  LoneWorkerStatus,
  { label: string; tone: string; Icon: typeof UserCheck }
> = {
  active: {
    label: 'Activo',
    tone: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800',
    Icon: UserCheck,
  },
  overdue_warning: {
    label: 'Aviso',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
    Icon: Clock,
  },
  overdue_critical: {
    label: 'Crítico',
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800',
    Icon: AlertTriangle,
  },
  help_requested: {
    label: 'Pidió ayuda',
    tone: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700',
    Icon: Siren,
  },
  ended: {
    label: 'Cerrada',
    tone: 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
    Icon: UserCheck,
  },
};

export function LoneWorkerAdminPanel({
  projectId,
  sessions,
  pollIntervalMs = 30_000,
  onRowClick,
}: LoneWorkerAdminPanelProps) {
  const [overview, setOverview] = useState<AdminOverviewEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { overview: data } = await fetchLoneWorkerAdminOverview(projectId, {
        sessions,
      });
      setOverview(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, sessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [pollIntervalMs, refresh]);

  const sorted = useMemo(() => {
    return [...overview].sort(
      (a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status],
    );
  }, [overview]);

  const counters = useMemo(() => {
    const c: Record<LoneWorkerStatus, number> = {
      active: 0,
      overdue_warning: 0,
      overdue_critical: 0,
      help_requested: 0,
      ended: 0,
    };
    for (const e of overview) c[e.status] += 1;
    return c;
  }, [overview]);

  return (
    <section
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm"
      data-testid="loneWorker.admin"
      aria-label="Panel admin trabajo solitario"
    >
      <header className="flex items-center gap-3">
        <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
          Trabajo solitario — Sesiones activas
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          data-testid="loneWorker.admin.refresh"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <dl
        className="grid grid-cols-2 sm:grid-cols-5 gap-2"
        data-testid="loneWorker.admin.counters"
      >
        {(Object.keys(STATUS_META) as LoneWorkerStatus[]).map((k) => {
          const meta = STATUS_META[k];
          return (
            <div
              key={k}
              className={`rounded-lg border px-3 py-2 ${meta.tone}`}
              data-testid={`loneWorker.admin.count.${k}`}
            >
              <dt className="text-[10px] uppercase tracking-wider font-bold">
                {meta.label}
              </dt>
              <dd className="text-xl font-bold tabular-nums">{counters[k]}</dd>
            </div>
          );
        })}
      </dl>

      {error && (
        <p
          className="text-xs text-rose-600 dark:text-rose-400"
          data-testid="loneWorker.admin.error"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          data-testid="loneWorker.admin.table"
        >
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
              <th className="py-2 pr-3 font-medium">Trabajador</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 font-medium">Intervalo</th>
              <th className="py-2 pr-3 font-medium">Check-ins</th>
              <th className="py-2 pr-3 font-medium">Último</th>
              <th className="py-2 pr-3 font-medium">Escalar</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && !loading && (
              <tr data-testid="loneWorker.admin.empty">
                <td
                  colSpan={6}
                  className="py-6 text-center text-zinc-500 dark:text-zinc-400 text-xs"
                >
                  Sin sesiones activas en este proyecto.
                </td>
              </tr>
            )}
            {sorted.map((entry) => {
              const meta = STATUS_META[entry.status];
              const { Icon } = meta;
              const last = entry.session.checkIns[entry.session.checkIns.length - 1];
              return (
                <tr
                  key={entry.session.id}
                  className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer"
                  onClick={() => onRowClick?.(entry)}
                  data-testid={`loneWorker.admin.row.${entry.session.id}`}
                >
                  <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-100">
                    {entry.session.workerUid}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border ${meta.tone}`}
                    >
                      <Icon className="w-3 h-3" aria-hidden="true" />
                      {meta.label}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300 tabular-nums">
                    {entry.session.checkInIntervalMin} min
                  </td>
                  <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300 tabular-nums">
                    {entry.session.checkIns.length}
                  </td>
                  <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400 text-xs">
                    {last ? new Date(last.at).toLocaleTimeString() : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {entry.escalation ? (
                      <EscalationCell escalation={entry.escalation} />
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-500 text-xs">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EscalationCell({ escalation }: { escalation: EscalationDecision }) {
  const tone =
    escalation.level === 'emergency_services'
      ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
      : escalation.level === 'brigade'
        ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
        : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  return (
    <span
      className={`inline-flex items-center text-[10px] font-bold uppercase px-2 py-0.5 rounded ${tone}`}
      title={escalation.message}
    >
      {escalation.level.replace('_', ' ')}
    </span>
  );
}
