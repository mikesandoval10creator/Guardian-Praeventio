// Praeventio Guard — Sprint 43 Fase F.8 UI: Bandeja del Prevencionista.
//
// Componente presentacional puro que renderiza la salida de
// `aggregateInbox()` (src/services/inbox/inboxAggregator.ts). Sin hooks,
// sin fetches — el padre calcula y le pasa los items + summary como props.

import type { InboxItem, InboxSummary, InboxUrgency } from '../../services/inbox/inboxAggregator.js';

export interface InboxPrevencionistaPanelProps {
  items: ReadonlyArray<InboxItem>;
  summary: InboxSummary;
  /** Callback opcional cuando el usuario hace click en una quick action. */
  onAction?: (item: InboxItem, actionKind: string) => void;
  /** Callback opcional para abrir detalle. */
  onOpenDetail?: (item: InboxItem) => void;
  /** Tono visual: light por default. */
  appearance?: 'light' | 'dark';
}

const URGENCY_STYLES: Record<InboxUrgency, { bg: string; text: string; label: string }> = {
  urgent: { bg: 'bg-rose-100', text: 'text-rose-800', label: 'URGENTE' },
  high: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'ALTA' },
  medium: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'MEDIA' },
  low: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'BAJA' },
};

export function InboxPrevencionistaPanel({
  items,
  summary,
  onAction,
  onOpenDetail,
  appearance = 'light',
}: InboxPrevencionistaPanelProps) {
  const isDark = appearance === 'dark';
  const cardBase = isDark
    ? 'bg-slate-800 border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const sectionTitle = isDark ? 'text-teal-300' : 'text-teal-700';

  const activeItems = items.filter((i) => !i.dismissedAt);

  return (
    <section
      data-testid="inbox.panel"
      aria-label="Bandeja del Prevencionista"
      className={`rounded-2xl border ${cardBase} p-4 shadow-sm`}
    >
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2
            data-testid="inbox.panel.title"
            className={`text-lg font-semibold ${sectionTitle}`}
          >
            Bandeja del Prevencionista
          </h2>
          <p className="text-xs opacity-70">
            {summary.total} pendientes · {summary.overdueCount} vencidos · {summary.byUrgency.urgent}{' '}
            urgentes
          </p>
        </div>
        <div className="flex gap-1" data-testid="inbox.panel.urgency-badges">
          {(['urgent', 'high', 'medium', 'low'] as const).map((u) => {
            const count = summary.byUrgency[u];
            if (count === 0) return null;
            const s = URGENCY_STYLES[u];
            return (
              <span
                key={u}
                data-testid={`inbox.panel.urgency.${u}`}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
              >
                {count} {s.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      </header>

      {activeItems.length === 0 ? (
        <p
          data-testid="inbox.panel.empty"
          className="rounded-lg border border-dashed border-teal-300 bg-teal-50 p-4 text-center text-sm text-teal-700"
        >
          ✨ Sin pendientes. Buen momento para una vuelta de inspección.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="inbox.panel.list">
          {activeItems.map((item) => {
            const s = URGENCY_STYLES[item.urgency];
            return (
              <li
                key={item.id}
                data-testid={`inbox.item.${item.id}`}
                data-kind={item.kind}
                data-urgency={item.urgency}
                className={`rounded-xl border p-3 ${
                  isDark ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      data-testid={`inbox.item.${item.id}.title`}
                      className="truncate text-sm font-semibold"
                    >
                      {item.title}
                    </p>
                    <p className="text-xs opacity-70" data-testid={`inbox.item.${item.id}.desc`}>
                      {item.description}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
                    data-testid={`inbox.item.${item.id}.urgency`}
                  >
                    {s.label}
                  </span>
                </div>

                {item.dueAt ? (
                  <p className="mb-2 text-xs opacity-60" data-testid={`inbox.item.${item.id}.due`}>
                    Vence: {new Date(item.dueAt).toLocaleString('es-CL')}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-1.5" data-testid={`inbox.item.${item.id}.actions`}>
                  {item.quickActions.map((qa) => (
                    <button
                      key={qa.kind}
                      type="button"
                      data-testid={`inbox.item.${item.id}.action.${qa.kind}`}
                      onClick={() => onAction?.(item, qa.kind)}
                      className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                        qa.kind === 'approve' || qa.kind === 'mark_done'
                          ? 'bg-teal-600 text-white hover:bg-teal-700'
                          : qa.kind === 'reject'
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {qa.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid={`inbox.item.${item.id}.open`}
                    onClick={() => onOpenDetail?.(item)}
                    className="rounded-md border border-teal-300 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                  >
                    Ver detalle
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
