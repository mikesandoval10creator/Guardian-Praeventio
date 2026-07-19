// Praeventio Guard — Bloque 4.2: <PendingPurchaseOrdersPanel />
//
// Lista las OC sugeridas pendientes de firma. El admin ve cada una con:
//   - Total CLP + numero de items
//   - Urgencia (emergency / urgent / routine) global
//   - Boton "Revisar y firmar" que abre <PurchaseOrderSignModal />
//
// Patron alineado con <StoppageBanner /> + <DocumentReadConfirmCard />.

import { useCallback, useEffect, useState } from 'react';
import {
  ShoppingCart,
  Loader2,
  AlertOctagon,
  Clock,
  FileSignature,
  RefreshCw,
} from 'lucide-react';
import {
  listPendingEppOrders,
  type PendingOrder,
} from '../../hooks/useEppFlow';
import { humanErrorMessage } from '../../lib/humanError';


export interface PendingPurchaseOrdersPanelProps {
  projectId: string;
  /** Callback cuando el admin clickea "Revisar y firmar". El padre abre el modal. */
  onReviewOrder: (order: PendingOrder) => void;
  /**
   * Polling interval en ms (0 = no auto-refresh). Default 30s.
   * Usamos polling simple en vez de Firestore onSnapshot porque la fuente
   * de verdad es el server-side cache (futuro: Firestore listener cuando
   * persistamos las ordenes en una collection).
   */
  pollIntervalMs?: number;
}

export function PendingPurchaseOrdersPanel({
  projectId,
  onReviewOrder,
  pollIntervalMs = 30_000,
}: PendingPurchaseOrdersPanelProps) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await listPendingEppOrders(projectId);
      setOrders(r.orders);
    } catch (err) {
      setError(humanErrorMessage((err as Error)?.message ?? 'Error cargando OC pendientes.'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
    if (pollIntervalMs <= 0) return undefined;
    const t = setInterval(() => {
      void reload();
    }, pollIntervalMs);
    return () => clearInterval(t);
  }, [reload, pollIntervalMs]);

  return (
    <section
      data-testid="pending-orders-panel"
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      aria-label="Ordenes de compra pendientes de firma"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-teal-600" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
            OC pendientes de firma
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          aria-label="Recargar"
          data-testid="pending-orders-reload"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {error && (
        <div
          role="alert"
          data-testid="pending-orders-error"
          className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
        >
          {humanErrorMessage(error)}
        </div>
      )}

      {loading && orders.length === 0 && (
        <p
          data-testid="pending-orders-loading"
          className="mt-3 text-xs italic text-zinc-500 dark:text-zinc-400"
        >
          Cargando OC pendientes…
        </p>
      )}

      {!loading && orders.length === 0 && !error && (
        <p
          data-testid="pending-orders-empty"
          className="mt-3 text-xs italic text-zinc-500 dark:text-zinc-400"
        >
          No hay OC pendientes de firma.
        </p>
      )}

      <ul className="mt-3 space-y-2" data-testid="pending-orders-list">
        {orders.map((order) => {
          const hasEmergency = order.draft.lines.some((l) => l.urgency === 'emergency');
          const hasUrgent = order.draft.lines.some((l) => l.urgency === 'urgent');
          return (
            <li
              key={order.orderId}
              data-testid={`pending-order:${order.orderId}`}
              className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">
                    {order.orderId}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {order.draft.lines.length} items · CLP {order.draft.totalClp.toLocaleString('es-CL')}
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    <Clock className="mr-0.5 inline-block h-3 w-3" aria-hidden="true" />
                    Entrega estimada: semana {order.draft.deliveryWeekHint}
                  </p>
                </div>
                {hasEmergency ? (
                  <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/30 dark:text-rose-100">
                    <AlertOctagon className="h-3 w-3" aria-hidden="true" />
                    EMERGENCY
                  </span>
                ) : hasUrgent ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
                    URGENT
                  </span>
                ) : (
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    ROUTINE
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => onReviewOrder(order)}
                data-testid={`pending-order-review:${order.orderId}`}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700"
              >
                <FileSignature className="h-3.5 w-3.5" aria-hidden="true" />
                Revisar y firmar
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
