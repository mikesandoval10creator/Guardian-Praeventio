// Praeventio Guard — Bloque 3.17: <MOCStatusPanel />
//
// Admin overview: lista de MOCs recientes con su % de acknowledgment
// progress. El admin puede ver pending workers y, cuando la cobertura es
// 100%, cerrar el MOC (marcar como implementado).
//
// Mirror Tailwind: teal-primary, amber-medium-impact, rose-high-impact,
// soporte dark mode. Reusa la presentación del OperationalChangeCard
// existente para cada item.

import { useState } from 'react';
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  PackageCheck,
  Users,
} from 'lucide-react';
import { OperationalChangeCard } from './OperationalChangeCard';
import type {
  OperationalChange,
  ChangeAcknowledgementSummary,
} from '../../services/changeMgmt/operationalChangeService';
import { closeMoc, useMocList } from '../../hooks/useOperationalChange';

export interface MOCStatusPanelProps {
  projectId: string;
  /** Después de cerrar, notifica al padre para refrescar lista. */
  onClosed?: (mocId: string) => void;
  /** Notifica error al padre. */
  onError?: (message: string) => void;
}

interface ClosingState {
  mocId: string;
  busy: boolean;
}

export function MOCStatusPanel({
  projectId,
  onClosed,
  onError,
}: MOCStatusPanelProps) {
  const { data, loading, error, refetch } = useMocList(projectId, {
    limit: 50,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<ClosingState | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleClose(mocId: string) {
    setCloseError(null);
    setClosing({ mocId, busy: true });
    try {
      await closeMoc(projectId, mocId);
      onClosed?.(mocId);
      refetch();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error al cerrar el MOC';
      setCloseError(msg);
      onError?.(msg);
    } finally {
      setClosing(null);
    }
  }

  if (loading && !data) {
    return (
      <div
        className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-400"
        data-testid="moc.panel.loading"
      >
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Cargando cambios operacionales…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 p-4 text-sm"
        role="alert"
        data-testid="moc.panel.error"
      >
        Error al cargar MOCs: {error.message}
      </div>
    );
  }

  const items = data?.items ?? [];
  const summaries = data?.summaries ?? [];

  if (items.length === 0) {
    return (
      <div
        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-600 dark:text-slate-400"
        data-testid="moc.panel.empty"
      >
        Aún no hay cambios operacionales declarados.
      </div>
    );
  }

  // Compute aggregated metrics for the panel header.
  const totalAffected = summaries.reduce(
    (sum, s) => sum + s.totalAffected,
    0,
  );
  const totalAcked = summaries.reduce((sum, s) => sum + s.acknowledged, 0);
  const overallPct =
    totalAffected === 0
      ? 100
      : Math.round((totalAcked / totalAffected) * 100);

  return (
    <section
      className="space-y-3"
      aria-label="Panel de cambios operacionales"
      data-testid="moc.panel"
    >
      <header className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 p-4">
        <div className="flex items-center gap-2">
          <Users
            className="w-5 h-5 text-teal-700 dark:text-teal-300"
            aria-hidden="true"
          />
          <h2 className="text-sm font-bold text-teal-900 dark:text-teal-100">
            Cambios operacionales — cobertura global
          </h2>
          <span
            className="ml-auto text-xl font-bold text-teal-900 dark:text-teal-100"
            data-testid="moc.panel.overallPct"
          >
            {overallPct}%
          </span>
        </div>
        <p className="text-xs text-teal-800 dark:text-teal-200 mt-1">
          {totalAcked}/{totalAffected} confirmaciones recibidas sobre{' '}
          {items.length} cambios activos
        </p>
      </header>

      {closeError && (
        <p
          className="rounded border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 text-xs px-3 py-2"
          role="alert"
          data-testid="moc.panel.closeError"
        >
          {closeError}
        </p>
      )}

      <ul className="space-y-3" data-testid="moc.panel.list">
        {items.map((change, idx) => {
          const summary: ChangeAcknowledgementSummary =
            summaries[idx] ?? {
              changeId: change.id,
              totalAffected: change.affectedWorkerUids.length,
              acknowledged: change.acknowledgments.length,
              pending: change.affectedWorkerUids.length - change.acknowledgments.length,
              coveragePercent:
                change.affectedWorkerUids.length === 0
                  ? 100
                  : Math.round(
                      (change.acknowledgments.length /
                        change.affectedWorkerUids.length) *
                        100,
                    ),
              pendingWorkerUids: [],
            };
          const isExpanded = !!expanded[change.id];
          const canClose =
            !change.revertedAt && summary.coveragePercent >= 100;
          const isClosing =
            closing?.mocId === change.id && closing?.busy === true;

          return (
            <li key={change.id} data-testid="moc.panel.item">
              <div className="space-y-2">
                <OperationalChangeCard change={change} summary={summary} />
                <div className="rounded-b-2xl border border-t-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 -mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(change.id)}
                    className="text-xs text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 inline-flex items-center gap-1"
                    data-testid={`moc.panel.toggle.${change.id}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-3 h-3" aria-hidden="true" />
                    )}
                    {summary.pending > 0
                      ? `${summary.pending} pendientes`
                      : 'Detalle cobertura'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleClose(change.id)}
                    disabled={!canClose || isClosing}
                    className="ml-auto rounded bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs font-bold px-3 py-1.5 inline-flex items-center gap-1"
                    data-testid={`moc.panel.closeButton.${change.id}`}
                    aria-label={
                      canClose
                        ? 'Cerrar MOC (marcar implementado)'
                        : 'Cobertura incompleta o revertido'
                    }
                  >
                    {isClosing ? (
                      <Loader2
                        className="w-3 h-3 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <PackageCheck className="w-3 h-3" aria-hidden="true" />
                    )}
                    {isClosing ? 'Cerrando…' : 'Cerrar MOC'}
                  </button>
                </div>

                {isExpanded && (
                  <div
                    className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs space-y-2"
                    data-testid={`moc.panel.detail.${change.id}`}
                  >
                    <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 font-bold">
                      <CheckCheck className="w-3 h-3" aria-hidden="true" />
                      {summary.acknowledged} confirmaron
                    </div>
                    {change.acknowledgments.length > 0 && (
                      <ul className="flex flex-wrap gap-1">
                        {change.acknowledgments.map((a) => (
                          <li
                            key={a.workerUid}
                            className="rounded bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 px-2 py-0.5"
                          >
                            {a.workerUid}
                          </li>
                        ))}
                      </ul>
                    )}
                    {summary.pendingWorkerUids.length > 0 && (
                      <>
                        <div className="font-bold text-amber-700 dark:text-amber-300">
                          Pendientes:
                        </div>
                        <ul className="flex flex-wrap gap-1">
                          {summary.pendingWorkerUids.map((uid) => (
                            <li
                              key={uid}
                              className="rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5"
                            >
                              {uid}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
