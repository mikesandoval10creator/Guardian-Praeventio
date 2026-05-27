// Praeventio Guard — <ShiftHandoverHistoryList />
//
// Bloque 3.18 — Listado paginado de handovers históricos por proyecto.
//
// Fetch via `fetchShiftHandoverHistory(projectId, { days })`. Paginación
// in-memory por bloques de 10 (el endpoint ya devuelve todo lo de los N
// últimos días, no excede el límite del listUnacknowledged-style query).
//
// Cada fila muestra: kind, supervisor saliente, supervisor entrante,
// quality score (de `computeHandoverQuality`), urgent notes count y
// estado (acknowledged / unacknowledged).
//
// Tailwind + teal + dark mode + accessible (table semantics).

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  RefreshCcw,
  CheckCircle2,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { ShiftKind } from '../../services/shiftHandover/shiftHandoverService';
import {
  fetchShiftHandoverHistory,
  type ShiftHandoverEntry,
} from '../../hooks/useShiftHandover';

export interface ShiftHandoverHistoryListProps {
  projectId: string;
  /** Rango por defecto, en días. */
  defaultDays?: number;
  /** Tamaño de página. */
  pageSize?: number;
  /** Callback cuando se selecciona una fila para detalle. */
  onSelect?: (entry: ShiftHandoverEntry) => void;
  /** Inyectable para tests. */
  fetcher?: typeof fetchShiftHandoverHistory;
}

const KIND_LABEL: Record<ShiftKind, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
  extended: 'Extendido',
};

const QUALITY_TONE = {
  excellent: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200',
  good: 'bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200',
  fair: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200',
  poor: 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200',
};

export function ShiftHandoverHistoryList({
  projectId,
  defaultDays = 30,
  pageSize = 10,
  onSelect,
  fetcher,
}: ShiftHandoverHistoryListProps) {
  const [days, setDays] = useState<number>(defaultDays);
  const [page, setPage] = useState<number>(0);
  const [entries, setEntries] = useState<ShiftHandoverEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const realFetcher = fetcher ?? fetchShiftHandoverHistory;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await realFetcher(projectId, { days });
      setEntries(res.shifts);
      setPage(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, days]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(entries.length / pageSize)),
    [entries.length, pageSize],
  );

  const pageItems = useMemo(() => {
    const start = page * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, page, pageSize]);

  return (
    <section
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm"
      data-testid="shift-handover-history"
      aria-label="Historial de cambios de turno"
    >
      <header className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
          Historial de cambios de turno
        </h2>
        <span className="ml-auto inline-flex items-center gap-2">
          <label htmlFor="ho-days" className="text-[11px] text-zinc-600 dark:text-zinc-400">
            Últimos
          </label>
          <select
            id="ho-days"
            data-testid="shift-handover-history-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs px-2 py-1"
          >
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            data-testid="shift-handover-history-refresh"
            aria-label="Recargar historial"
            className="rounded-md border border-zinc-300 dark:border-zinc-600 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Recargar
          </button>
        </span>
      </header>

      {error && (
        <p
          className="text-xs text-rose-600 dark:text-rose-400"
          role="alert"
          data-testid="shift-handover-history-error"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p
          className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-6"
          data-testid="shift-handover-history-loading"
        >
          Cargando…
        </p>
      ) : pageItems.length === 0 ? (
        <p
          className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-6"
          data-testid="shift-handover-history-empty"
        >
          No hay handovers en los últimos {days} días.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="text-left py-1 px-2">Inicio</th>
                <th className="text-left py-1 px-2">Turno</th>
                <th className="text-left py-1 px-2">Saliente</th>
                <th className="text-left py-1 px-2">Entrante</th>
                <th className="text-right py-1 px-2">Notas</th>
                <th className="text-right py-1 px-2">Urgentes</th>
                <th className="text-right py-1 px-2">Score</th>
                <th className="text-center py-1 px-2">Acuse</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((entry) => {
                const { shift, quality } = entry;
                const ackd = !!shift.acknowledgedByUid;
                return (
                  <tr
                    key={shift.id}
                    data-testid={`shift-handover-row-${shift.id}`}
                    onClick={() => onSelect?.(entry)}
                    className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-teal-50/40 dark:hover:bg-teal-900/10 cursor-pointer"
                  >
                    <td className="py-1 px-2 text-zinc-700 dark:text-zinc-300 tabular-nums">
                      {new Date(shift.startedAt).toLocaleString()}
                    </td>
                    <td className="py-1 px-2 text-zinc-700 dark:text-zinc-300">
                      {KIND_LABEL[shift.kind] ?? shift.kind}
                    </td>
                    <td className="py-1 px-2 text-zinc-700 dark:text-zinc-300">
                      <code>{shift.supervisorUid}</code>
                    </td>
                    <td className="py-1 px-2 text-zinc-700 dark:text-zinc-300">
                      {shift.acknowledgedByUid ? (
                        <code>{shift.acknowledgedByUid}</code>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                      {quality.totalNotes}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      <span
                        className={
                          quality.urgentNotes > 0
                            ? 'text-rose-600 dark:text-rose-400 font-bold'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }
                      >
                        {quality.urgentNotes}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right">
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-bold tabular-nums ${QUALITY_TONE[quality.level]}`}
                      >
                        {quality.qualityScore}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-center">
                      {ackd ? (
                        <CheckCircle2
                          className="w-4 h-4 text-teal-600 dark:text-teal-400 inline"
                          aria-label="Acusado"
                        />
                      ) : (
                        <CircleAlert
                          className="w-4 h-4 text-amber-600 dark:text-amber-400 inline"
                          aria-label="Sin acuse"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > pageSize && (
        <footer className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
          <span data-testid="shift-handover-history-page-label">
            Página {page + 1} de {totalPages} ({entries.length} total)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="shift-handover-history-prev"
              aria-label="Página anterior"
              className="rounded border border-zinc-300 dark:border-zinc-600 p-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              data-testid="shift-handover-history-next"
              aria-label="Página siguiente"
              className="rounded border border-zinc-300 dark:border-zinc-600 p-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
