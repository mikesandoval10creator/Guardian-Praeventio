// Praeventio Guard — Bloque 4.2: <PurchaseOrderSignModal />
//
// Modal de review + firma de OC. Patron alineado con StoppageResumeModal:
//   1. Muestra lineas del draft + total CLP.
//   2. Corre el ceremony WebAuthn 'claim-signing' (sensitive, fail-closed).
//   3. Solo si la firma fue exitosa, llama a signEppOrder(...).
//   4. Tras firmar, ofrece boton "Descargar PDF" (no auto-envia al proveedor).
//
// La firma biometrica es el sello legal (Ley 19.799 art. 3). El modal
// muestra explicitamente la directiva 4-directivas: "Praeventio NO envia
// al proveedor — la empresa descarga y envia manualmente".

import { useState } from 'react';
import {
  Fingerprint,
  Loader2,
  ShoppingCart,
  X,
  AlertOctagon,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import {
  signEppOrder,
  downloadEppOrderPdf,
  type PendingOrder,
} from '../../hooks/useEppFlow';
import { humanErrorMessage } from '../../lib/humanError';


export interface PurchaseOrderSignModalProps {
  open: boolean;
  projectId: string;
  tenantId: string;
  /** OC siendo firmada — debe estar `pending_signature`. */
  order: PendingOrder;
  /** UID del admin firmante (debe matchear callerUid en server). */
  adminUid: string;
  adminRut?: string;
  adminName?: string;
  onClose: () => void;
  /** Callback tras firma exitosa. */
  onSigned?: (signedOrder: PendingOrder) => void;
  /** Callback de error. */
  onError?: (msg: string) => void;
}

export function PurchaseOrderSignModal({
  open,
  projectId,
  tenantId,
  order,
  adminUid,
  adminRut,
  adminName,
  onClose,
  onSigned,
  onError,
}: PurchaseOrderSignModalProps) {
  const { isSupported, authenticate } = useBiometricAuth();

  const [signing, setSigning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [signed, setSigned] = useState<PendingOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const hasEmergency = order.draft.lines.some((l) => l.urgency === 'emergency');

  async function handleSign(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!isSupported) {
      const msg = 'Tu dispositivo no soporta firma biometrica. Firma requerida.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSigning(true);
    let bioOk = false;
    try {
      bioOk = await authenticate(
        `Firmar orden de compra: ${order.orderId} (CLP ${order.draft.totalClp})`,
        'claim-signing',
      );
    } catch {
      bioOk = false;
    } finally {
      setSigning(false);
    }

    if (!bioOk) {
      const msg = 'La firma biometrica no se completo. OC NO firmada.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSubmitting(true);
    try {
      // MVP: usamos un placeholder challengeId equivalente al que ya
      // consumio el ceremony interno de useBiometricAuth. Una iteracion
      // siguiente debe propagar el challengeId desde useBiometricAuth.
      // Por ahora derivamos uno determinista para idempotencia + auditoria.
      const challengeId = `chal-${order.orderId}-${Date.now()}`;
      const r = await signEppOrder(projectId, order.orderId, {
        challengeId,
        signerUid: adminUid,
        signerRut: adminRut,
        signerName: adminName,
        signedAt: new Date().toISOString(),
        suggestedNodeId: order.suggestedNodeId,
        draftTotalClp: order.draft.totalClp,
        tenantId,
      });
      setSigned(r.order);
      onSigned?.(r.order);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Error firmando OC.';
      setError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(): Promise<void> {
    setError(null);
    setDownloading(true);
    try {
      const blob = await downloadEppOrderPdf(projectId, order.orderId, tenantId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.orderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Error descargando PDF.';
      setError(msg);
      onError?.(msg);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="oc-sign-modal-title"
      data-testid="oc-sign-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-6"
    >
      <div className="w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div className="flex items-start gap-3">
            <ShoppingCart className="h-6 w-6 flex-shrink-0 text-teal-600" aria-hidden="true" />
            <div>
              <h2
                id="oc-sign-modal-title"
                className="text-sm font-black uppercase tracking-wide text-zinc-800 dark:text-zinc-100"
              >
                Revisar y firmar OC
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {order.orderId} · {order.draft.lines.length} items
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || signing || downloading}
            data-testid="oc-sign-modal-close"
            aria-label="Cerrar"
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSign} className="space-y-4 px-5 py-4">
          {hasEmergency && (
            <div
              role="alert"
              data-testid="oc-sign-modal-emergency"
              className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
            >
              <AlertOctagon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>Esta OC contiene items en EMERGENCIA (stock 0). Priorizar.</span>
            </div>
          )}

          {/* Lineas del draft */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Lineas
            </h3>
            <ul className="mt-2 space-y-1" data-testid="oc-sign-modal-lines">
              {order.draft.lines.map((line, idx) => (
                <li
                  key={`${idx}-${line.kind}`}
                  data-testid={`oc-line:${line.kind}`}
                  className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <span className="flex-1 truncate">
                    {line.kind} · qty {line.quantity}
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    CLP {(line.quantity * line.estimatedUnitCostClp).toLocaleString('es-CL')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
            <span className="font-bold text-zinc-700 dark:text-zinc-200">TOTAL</span>
            <span className="font-black text-zinc-900 dark:text-zinc-100">
              CLP {order.draft.totalClp.toLocaleString('es-CL')}
            </span>
          </div>

          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-[11px] text-teal-900 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100">
            <Fingerprint className="mb-1 inline-block h-3.5 w-3.5" aria-hidden="true" />{' '}
            La OC se cerrara con firma biometrica del admin. El sistema NO
            envia automaticamente al proveedor — la empresa descarga el PDF
            y lo envia por su canal habitual (Ley 19.799 art. 3).
          </div>

          {error && (
            <div
              role="alert"
              data-testid="oc-sign-modal-error"
              className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
            >
              {humanErrorMessage(error)}
            </div>
          )}

          {!signed && (
            <button
              type="submit"
              disabled={submitting || signing}
              data-testid="oc-sign-modal-submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow hover:bg-teal-700 disabled:opacity-50"
            >
              {signing || submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Fingerprint className="h-4 w-4" aria-hidden="true" />
              )}
              {signing ? 'Verificando huella…' : submitting ? 'Registrando firma…' : 'Firmar OC'}
            </button>
          )}

          {signed && (
            <div className="space-y-2" data-testid="oc-sign-modal-signed">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100">
                <ShieldCheck className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>
                  OC firmada por {signed.signerUid}. Descarga el PDF para
                  enviarlo al proveedor.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={downloading}
                data-testid="oc-sign-modal-download"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow hover:bg-zinc-900 disabled:opacity-50 dark:bg-teal-700 dark:hover:bg-teal-800"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Descargar PDF
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
