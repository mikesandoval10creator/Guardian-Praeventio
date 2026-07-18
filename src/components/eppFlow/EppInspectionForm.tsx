// Praeventio Guard — Bloque 4.2: <EppInspectionForm />
//
// Formulario mobile-first para que el trabajador inspeccione cada EPP
// item-by-item (status ok / warning / failed). Al enviar, dispara el
// flow eppInventoryPurchaseFlow via submitEppInspection.
//
// Mobile-first: cada item es una row tap-friendly (botones grandes).
// Cuando un item se marca como 'failed' aparece el selector de razon.
// La directiva 4-directivas se respeta: el server NO empuja al proveedor.

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ClipboardList,
  Send,
} from 'lucide-react';
import {
  submitEppInspection,
  type SubmitInspectionInput,
} from '../../hooks/useEppFlow';
import type {
  InspectedEppItem,
  EppItemStatus,
  EppItemFailureReason,
} from '../../services/zettelkasten/flows/eppInventoryPurchaseFlow';
import type {
  InventoryItem,
  SupplierCatalogEntry,
  PurchaseOrderDraft,
} from '../../services/financialAnalytics/purchaseOrderSuggester';
import { humanErrorMessage } from '../../lib/humanError';


export interface EppInspectionFormProps {
  projectId: string;
  tenantId: string;
  /** Trabajador siendo inspeccionado. */
  workerUid: string;
  /** Site/faena opcional. */
  siteId?: string;
  /** Catalogo de items EPP asignados a este trabajador. */
  catalog: ReadonlyArray<{ itemId: string; kind: string; label: string }>;
  /** UID del que reporta (== usuario logueado, normalmente). */
  reportedByUid: string;
  /** Estado de inventario por kind (para que el server descuente). */
  inventoryByKind: Record<string, InventoryItem>;
  /** Proveedores conocidos para que el server arme el draft de OC. */
  supplierCatalog: SupplierCatalogEntry[];
  /** Lead time por supplier (dias). */
  leadTimeDaysBySupplier: Record<string, number>;
  /** Callback al exito — entrega el draft sugerido (si lo hubo). */
  onSubmitted?: (result: {
    suggestedOrder: PurchaseOrderDraft | null;
    nodeCount: number;
    edgeCount: number;
  }) => void;
  /** Callback de error. */
  onError?: (msg: string) => void;
}

const STATUS_BUTTONS: ReadonlyArray<{
  status: EppItemStatus;
  label: string;
  Icon: typeof CheckCircle2;
  bg: string;
  bgActive: string;
  ring: string;
}> = [
  {
    status: 'ok',
    label: 'OK',
    Icon: CheckCircle2,
    bg: 'bg-emerald-50 text-emerald-700',
    bgActive: 'bg-emerald-600 text-white',
    ring: 'ring-emerald-500',
  },
  {
    status: 'warning',
    label: 'Advertencia',
    Icon: AlertTriangle,
    bg: 'bg-amber-50 text-amber-700',
    bgActive: 'bg-amber-600 text-white',
    ring: 'ring-amber-500',
  },
  {
    status: 'failed',
    label: 'Fallido',
    Icon: XCircle,
    bg: 'bg-rose-50 text-rose-700',
    bgActive: 'bg-rose-600 text-white',
    ring: 'ring-rose-500',
  },
];

const REASON_OPTIONS: ReadonlyArray<{
  value: EppItemFailureReason;
  label: string;
}> = [
  { value: 'expired', label: 'Vencido' },
  { value: 'damaged', label: 'Danado' },
  { value: 'missing', label: 'Perdido' },
  { value: 'contaminated', label: 'Contaminado' },
  { value: 'other', label: 'Otro' },
];

interface ItemFormState {
  status: EppItemStatus | null;
  failureReason?: EppItemFailureReason;
  notes?: string;
}

export function EppInspectionForm({
  projectId,
  tenantId,
  workerUid,
  siteId,
  catalog,
  reportedByUid,
  inventoryByKind,
  supplierCatalog,
  leadTimeDaysBySupplier,
  onSubmitted,
  onError,
}: EppInspectionFormProps) {
  const [stateByItemId, setStateByItemId] = useState<Record<string, ItemFormState>>(
    () => Object.fromEntries(catalog.map((c) => [c.itemId, { status: null }])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCount = catalog.length;
  const completedCount = useMemo(
    () => Object.values(stateByItemId).filter((s) => s.status !== null).length,
    [stateByItemId],
  );
  const failedCount = useMemo(
    () => Object.values(stateByItemId).filter((s) => s.status === 'failed').length,
    [stateByItemId],
  );

  const canSubmit =
    !submitting &&
    completedCount === totalCount &&
    // Cada item failed debe tener una razon.
    !Object.values(stateByItemId).some(
      (s) => s.status === 'failed' && !s.failureReason,
    );

  function setStatusFor(itemId: string, status: EppItemStatus): void {
    setStateByItemId((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status,
        // Si pasa de failed a otro estado, limpiamos razon.
        failureReason: status === 'failed' ? prev[itemId]?.failureReason : undefined,
      },
    }));
  }

  function setReasonFor(itemId: string, reason: EppItemFailureReason): void {
    setStateByItemId((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], failureReason: reason },
    }));
  }

  function setNotesFor(itemId: string, notes: string): void {
    setStateByItemId((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], notes },
    }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const items: InspectedEppItem[] = catalog.map((c) => {
        const s = stateByItemId[c.itemId];
        return {
          itemId: c.itemId,
          kind: c.kind,
          status: (s?.status ?? 'ok') as EppItemStatus,
          failureReason: s?.failureReason,
          reportedByUid,
          notes: s?.notes,
        };
      });
      const input: SubmitInspectionInput = {
        inspection: {
          inspectionId: `insp-${Date.now()}`,
          siteId,
          workerUid,
          items,
          inspectedAt: new Date().toISOString(),
        },
        inventoryByKind,
        supplierCatalog,
        leadTimeDaysBySupplier,
        tenantId,
      };
      const result = await submitEppInspection(projectId, input);
      onSubmitted?.({
        suggestedOrder: result.suggestedOrder,
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Error al enviar inspeccion.';
      setError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="epp-inspection-form"
      className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      <header className="flex items-start gap-2">
        <ClipboardList className="h-5 w-5 flex-shrink-0 text-teal-600" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
            Inspeccion EPP
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Trabajador {workerUid}
            {siteId ? ` — ${siteId}` : ''} · {completedCount}/{totalCount} items
            {failedCount > 0 && (
              <span className="ml-2 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/30 dark:text-rose-100">
                {failedCount} failed
              </span>
            )}
          </p>
        </div>
      </header>

      <ul className="space-y-3" data-testid="epp-inspection-items">
        {catalog.map((entry) => {
          const itemState = stateByItemId[entry.itemId] ?? { status: null };
          return (
            <li
              key={entry.itemId}
              className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
              data-testid={`epp-item:${entry.itemId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">
                    {entry.label}
                  </p>
                  <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {entry.kind} · {entry.itemId}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {STATUS_BUTTONS.map((btn) => {
                  const active = itemState.status === btn.status;
                  return (
                    <button
                      key={btn.status}
                      type="button"
                      onClick={() => setStatusFor(entry.itemId, btn.status)}
                      data-testid={`epp-status:${entry.itemId}:${btn.status}`}
                      aria-pressed={active}
                      className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold transition ${
                        active ? btn.bgActive : btn.bg
                      } ${active ? `ring-2 ${btn.ring}` : ''}`}
                    >
                      <btn.Icon className="h-4 w-4" aria-hidden="true" />
                      {btn.label}
                    </button>
                  );
                })}
              </div>

              {itemState.status === 'failed' && (
                <div className="mt-3 space-y-2">
                  <label
                    htmlFor={`reason-${entry.itemId}`}
                    className="block text-[11px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300"
                  >
                    Razon del fallo (requerida)
                  </label>
                  <select
                    id={`reason-${entry.itemId}`}
                    value={itemState.failureReason ?? ''}
                    onChange={(ev) =>
                      setReasonFor(entry.itemId, ev.target.value as EppItemFailureReason)
                    }
                    required
                    data-testid={`epp-reason:${entry.itemId}`}
                    className="w-full rounded-lg border border-zinc-300 bg-white p-2 text-xs text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">Seleccionar…</option>
                    {REASON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    placeholder="Notas opcionales (descripcion del fallo)…"
                    value={itemState.notes ?? ''}
                    onChange={(ev) => setNotesFor(entry.itemId, ev.target.value)}
                    maxLength={500}
                    data-testid={`epp-notes:${entry.itemId}`}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <div
          role="alert"
          data-testid="epp-inspection-error"
          className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
        >
          {humanErrorMessage(error)}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="epp-inspection-submit"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow hover:bg-teal-700 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" aria-hidden="true" />
        )}
        Enviar inspeccion
      </button>
    </form>
  );
}
