// Praeventio Guard — <StoppageResumeModal />
//
// Cierre del ciclo de paralización: cuando todas las preconditions están
// cumplidas, el supervisor responsable firma la reanudación. Este modal:
//
//   1. Captura justificación libre (≥ 50 chars).
//   2. Permite añadir/eliminar medidas adoptadas (lista de strings).
//   3. Lanza el ceremonial WebAuthn vía useBiometricAuth con
//      `purpose: 'claim-signing'` (fail-closed: ninguna firma → no resume).
//   4. POST al hook `resumeStoppage` solo si la firma fue exitosa.
//
// Directiva founder: el modal NO ejecuta paro/reanudación física. Solo
// registra la decisión humana. La firma biométrica es el sello legal.

import { useState, useEffect } from 'react';
import {
  AlertOctagon,
  Fingerprint,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { Stoppage } from '../../services/stoppage/stoppageEngine';
import { useBiometricAuth } from '../../hooks/useBiometricAuth';
import { resumeStoppage as resumeStoppageRequest } from '../../hooks/useStoppage';
import { humanErrorMessage } from '../../lib/humanError';


export interface StoppageResumeModalProps {
  /** Open state — parent controls visibility. */
  open: boolean;
  projectId: string;
  /** Stoppage being resumed; must be in `pending_resumption` status. */
  stoppage: Stoppage;
  /** Caller's role (supervisor / prevencionista / gerente / admin). */
  resumedByRole: string;
  /** Closes the modal without resuming. */
  onClose: () => void;
  /** Called with the updated stoppage on success. */
  onResumed: (next: Stoppage) => void;
  /** Optional error sink so the parent can toast/log. */
  onError?: (message: string) => void;
}

const MIN_JUSTIFICATION_CHARS = 50;

/**
 * Default suggestions for "medidas adoptadas". Supervisor can edit/add.
 * Keep this short — exhaustive list lives in a future preconditions library.
 */
const DEFAULT_MEASURES: string[] = [];

export function StoppageResumeModal({
  open,
  projectId,
  stoppage,
  resumedByRole,
  onClose,
  onResumed,
  onError,
}: StoppageResumeModalProps) {
  const { isSupported, authenticate } = useBiometricAuth();

  const [justification, setJustification] = useState('');
  const [measures, setMeasures] = useState<string[]>([...DEFAULT_MEASURES]);
  const [newMeasure, setNewMeasure] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal opens with a new stoppage.
  useEffect(() => {
    if (!open) return;
    setJustification('');
    setMeasures([...DEFAULT_MEASURES]);
    setNewMeasure('');
    setSubmitting(false);
    setSigning(false);
    setError(null);
  }, [open, stoppage.id]);

  if (!open) return null;

  const justificationOk = justification.trim().length >= MIN_JUSTIFICATION_CHARS;
  const measuresOk = measures.length > 0;
  const allPreconditionsOk = stoppage.resumptionPreconditions.every((p) => p.fulfilled);
  const canSubmit =
    !submitting && !signing && justificationOk && measuresOk && allPreconditionsOk;

  function handleAddMeasure() {
    const v = newMeasure.trim();
    if (!v) return;
    setMeasures((prev) => [...prev, v]);
    setNewMeasure('');
  }

  function handleRemoveMeasure(idx: number) {
    setMeasures((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    if (!isSupported) {
      const msg =
        'Tu dispositivo no soporta firma biométrica. Reanudación requiere firma.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSigning(true);
    let signed = false;
    try {
      signed = await authenticate(
        `Firmar reanudación de paralización: ${stoppage.id}`,
        'claim-signing',
      );
    } catch {
      signed = false;
    } finally {
      setSigning(false);
    }
    if (!signed) {
      const msg =
        'La firma biométrica no se completó. La reanudación NO fue registrada.';
      setError(msg);
      onError?.(msg);
      return;
    }

    setSubmitting(true);
    try {
      const idk = `stoppage-resume-${stoppage.id}-${Date.now()}`;
      const result = await resumeStoppageRequest(
        projectId,
        {
          stoppage,
          justification: justification.trim(),
          measuresAdopted: measures,
          resumedByRole,
          signatureAttested: true,
        },
        idk,
      );
      onResumed(result.stoppage);
    } catch (err) {
      const msg = (err as Error).message ?? 'Error al registrar reanudación.';
      setError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stoppage-resume-title"
      data-testid="stoppage.resumeModal"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-6"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="h-6 w-6 flex-shrink-0 text-teal-600 dark:text-teal-400"
              aria-hidden="true"
            />
            <div>
              <h2
                id="stoppage-resume-title"
                className="text-sm font-black uppercase tracking-wide text-zinc-800 dark:text-zinc-100"
              >
                Firmar reanudación
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {stoppage.id} · {stoppage.scope} · {stoppage.scopeTargetId}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || signing}
            data-testid="stoppage.resumeModal.close"
            aria-label="Cerrar"
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {!allPreconditionsOk && (
            <div
              role="alert"
              data-testid="stoppage.resumeModal.preconditionsWarning"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
            >
              <AlertOctagon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>
                Aún hay condiciones de reanudación sin cumplir. Verifique cada
                precondition antes de firmar.
              </span>
            </div>
          )}

          <div>
            <label
              htmlFor="stoppage-justification"
              className="block text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
            >
              Justificación de la reanudación
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Mínimo {MIN_JUSTIFICATION_CHARS} caracteres. Describa por qué
              las condiciones permiten reanudar.
            </p>
            <textarea
              id="stoppage-justification"
              name="justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={5000}
              rows={4}
              required
              data-testid="stoppage.resumeModal.justification"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="Las condiciones detalladas en el plan de reanudación se verificaron en terreno…"
            />
            <p
              className={`mt-1 text-[11px] ${
                justificationOk
                  ? 'text-teal-600 dark:text-teal-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
              data-testid="stoppage.resumeModal.justificationCount"
            >
              {justification.trim().length} / {MIN_JUSTIFICATION_CHARS} caracteres
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Medidas adoptadas
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Liste las acciones concretas que habilitan la reanudación.
            </p>

            <ul
              className="mt-2 space-y-1"
              data-testid="stoppage.resumeModal.measuresList"
            >
              {measures.map((m, idx) => (
                <li
                  key={`${idx}-${m}`}
                  className="flex items-start gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <span className="flex-1">{m}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMeasure(idx)}
                    aria-label={`Eliminar medida ${idx + 1}`}
                    className="rounded p-0.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-900/30"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
              {measures.length === 0 && (
                <li className="rounded border border-dashed border-zinc-300 px-2 py-1 text-[11px] italic text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Aún no se ha listado ninguna medida.
                </li>
              )}
            </ul>

            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newMeasure}
                onChange={(e) => setNewMeasure(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMeasure();
                  }
                }}
                maxLength={500}
                data-testid="stoppage.resumeModal.newMeasure"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-teal-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-teal-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Ej: equipo X inspeccionado y certificado por…"
              />
              <button
                type="button"
                onClick={handleAddMeasure}
                disabled={!newMeasure.trim()}
                data-testid="stoppage.resumeModal.addMeasure"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Añadir
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-[11px] text-teal-900 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100">
            <Fingerprint
              className="mb-1 inline-block h-3.5 w-3.5"
              aria-hidden="true"
            />{' '}
            La reanudación se cerrará con firma biométrica del responsable
            ({resumedByRole}). El sistema no reanuda automáticamente.
          </div>

          {error && (
            <div
              role="alert"
              data-testid="stoppage.resumeModal.error"
              className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-100"
            >
              {humanErrorMessage(error)}
            </div>
          )}

          <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || signing}
              data-testid="stoppage.resumeModal.cancel"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="stoppage.resumeModal.submit"
              className="inline-flex items-center gap-2 rounded-lg border border-teal-700 bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-teal-500 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              {signing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Solicitando firma…
                </>
              ) : submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Registrando…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Firmar y reanudar
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
