// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 deuda P1 — Reemplaza window.prompt()
// con un modal validado para capturar razones de approve/reject/revert/verify.
//
// `window.prompt()` no soporta multilínea, no permite validación en tiempo
// real, y los browsers móviles lo renderizan mal. Este modal:
//   - textarea con counter `n/min`
//   - botón Confirmar deshabilitado hasta cumplir min length
//   - cancelar via X o Escape
//   - bloquea scroll del body mientras está abierto

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export interface ReasonModalProps {
  open: boolean;
  title: string;
  description?: string;
  /** Placeholder del textarea. */
  placeholder?: string;
  /** Mínimo de caracteres requerido (default 15). */
  minLength?: number;
  /** Label del botón confirmar. */
  confirmLabel: string;
  /** Color del botón confirmar (Tailwind utility class). */
  confirmColor?: string;
  /** Opcional: campo "effective" boolean (para verificación PDCA). */
  showEffectiveField?: boolean;
  onConfirm: (reason: string, extra?: { effective: boolean }) => void;
  onCancel: () => void;
}

export function ReasonModal({
  open,
  title,
  description,
  placeholder,
  minLength = 15,
  confirmLabel,
  confirmColor = 'bg-rose-600 hover:bg-rose-500',
  showEffectiveField = false,
  onConfirm,
  onCancel,
}: ReasonModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState(true);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setReason('');
      setEffective(true);
    }
  }, [open]);

  // Block body scroll while open + Escape to cancel
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  const trimmedLen = reason.trim().length;
  const canConfirm = trimmedLen >= minLength;

  const handleSubmit = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(reason.trim(), showEffectiveField ? { effective } : undefined);
  }, [canConfirm, reason, effective, showEffectiveField, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reason-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-2xl">
        <header className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-white/10">
          <h2 id="reason-modal-title" className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close', 'Cerrar') as string}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          {description && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {description}
            </p>
          )}
          {showEffectiveField && (
            <fieldset className="space-y-2 text-xs">
              <legend className="font-bold text-zinc-700 dark:text-zinc-300">
                {t(
                  'reason_modal.effective_field.legend',
                  '¿El cambio logró su objetivo?',
                )}
              </legend>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="effective"
                  checked={effective === true}
                  onChange={() => setEffective(true)}
                />
                <span>{t('reason_modal.effective_field.yes', 'Sí — registro como verificado')}</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="effective"
                  checked={effective === false}
                  onChange={() => setEffective(false)}
                />
                <span>{t('reason_modal.effective_field.no', 'No — requiere acción correctiva')}</span>
              </label>
            </fieldset>
          )}
          <label className="block space-y-1 text-xs">
            <span className="font-bold text-zinc-700 dark:text-zinc-300">
              {t('reason_modal.textarea_label', 'Motivo / observaciones')}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder={placeholder}
              autoFocus
              className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-950 px-2 py-1.5 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <div className={`text-[10px] text-right ${canConfirm ? 'text-emerald-600' : 'text-zinc-500'}`}>
              {trimmedLen}/{minLength}
            </div>
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t border-zinc-200 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 disabled:cursor-not-allowed ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ReasonModal;
