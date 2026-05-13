// Praeventio Guard — Wire UI S45: <SyncQueueBadge />
//
// Badge presentacional para el estado de la cola offline-sync.
// El padre llama a `summarizeQueue` + `deriveBadge` y pasa el
// resultado como prop. Sólo informa — el motor de retry está en el
// service layer.

import { Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import type {
  QueueSummary,
  SyncBadge as SyncBadgeData,
} from '../../services/syncStatus/syncQueueTracker.js';

interface SyncQueueBadgeProps {
  summary: QueueSummary;
  badge: SyncBadgeData;
  /** Callback opcional para forzar reintento manual. */
  onRetry?: () => void;
}

const COLOR_TONE: Record<SyncBadgeData['color'], string> = {
  green: 'bg-teal-50 text-teal-700 border-teal-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
};

const COLOR_ICON: Record<SyncBadgeData['color'], typeof Cloud> = {
  green: Cloud,
  amber: CloudOff,
  red: AlertTriangle,
  blue: RefreshCw,
};

export function SyncQueueBadge({
  summary,
  badge,
  onRetry,
}: SyncQueueBadgeProps) {
  const Icon = COLOR_ICON[badge.color];
  const tone = COLOR_TONE[badge.color];

  return (
    <section
      className={`rounded-2xl border p-3 space-y-2 ${tone}`}
      data-testid="syncStatus.badge"
      aria-label="Estado de sincronización"
    >
      <header className="flex items-center gap-2">
        <Icon
          className={`w-4 h-4 ${badge.color === 'blue' ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span
          className="text-sm font-black"
          data-testid="syncStatus.label"
        >
          {badge.label}
        </span>
        <span
          className="ml-auto text-[10px] uppercase font-bold tabular-nums"
          data-testid="syncStatus.totalItems"
        >
          {summary.totalItems} item(s)
        </span>
      </header>

      <dl
        className="grid grid-cols-5 gap-1 text-[10px] text-center"
        data-testid="syncStatus.breakdown"
      >
        {(['saved_local', 'syncing', 'synced', 'sync_error', 'sync_failed'] as const).map(
          (k) => (
            <div key={k} data-testid={`syncStatus.count.${k}`}>
              <dt className="opacity-70">{k}</dt>
              <dd className="font-black tabular-nums">{summary.byStatus[k]}</dd>
            </div>
          ),
        )}
      </dl>

      {summary.failedItems.length > 0 && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="syncStatus.retryBtn"
          className="px-3 py-1 rounded-lg bg-white/80 text-rose-900 text-xs font-bold border border-rose-300 hover:bg-white"
        >
          Reintentar fallidos
        </button>
      )}
    </section>
  );
}
