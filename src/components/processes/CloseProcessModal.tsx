// SPDX-License-Identifier: MIT
// Sprint 16 — Process close modal con celebración positiva.
//
// Calcula compliance auto: 100 base, -5 por incidente, +5 por
// alertResponded, cap [0,100]. Muestra preview de XP usando
// computeProcessCloseXp (mismo contrato que el server). Botón
// "Cerrar y celebrar" lanza confetti via canvas-confetti y POST
// /api/processes/:id/close. Nunca bloquea: si el POST falla, la modal
// queda abierta con el error y la opción de reintentar.

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, PartyPopper, ShieldCheck, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Process } from '../../types/organic';
import { computeProcessCloseXp, baseXpForProcessType } from '../../services/organic/processService';
import { auth } from '../../services/firebase';
import { apiAuthHeader } from '../../lib/apiAuth';

export interface CloseProcessModalProps {
  isOpen: boolean;
  process: Process | null;
  onClose: () => void;
  onClosed?: (xpAwarded: number) => void;
}

/**
 * Auto compliance score: 100 base, -5 per incidente, +5 per alerta atendida.
 * Capped to [0,100]. Pure function so the preview matches what's POSTed.
 */
export function computeAutoCompliance(p: Pick<Process, 'incidentsDuringProcess' | 'alertsResponded'>): number {
  const base = 100 - (p.incidentsDuringProcess ?? 0) * 5 + (p.alertsResponded ?? 0) * 5;
  return Math.max(0, Math.min(100, base));
}

export function CloseProcessModal({ isOpen, process, onClose, onClosed }: CloseProcessModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auto = useMemo(() => (process ? computeAutoCompliance(process) : 0), [process]);
  const previewXp = useMemo(
    () => (process ? computeProcessCloseXp(process.type, auto, process.alertsResponded) : 0),
    [process, auto]
  );

  if (!isOpen || !process) return null;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) {
        setError(t('processes.error_no_session_short', 'Sesión no disponible.'));
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/processes/${process.id}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({ complianceScore: auto }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      const j = await res.json();
      // Celebración positiva — confetti centrado, no bloquea.
      try {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#f59e0b', '#3b82f6', '#a855f7'],
        });
      } catch {
        // canvas-confetti puede fallar en jsdom; ignorar silenciosamente.
      }
      onClosed?.(j.xpAwarded ?? previewXp);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? t('processes.error_network', 'Error de red'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{t('processes.close_title', 'Cerrar proceso')}</h3>
            </div>
            <button onClick={onClose} aria-label={t('common.close', 'Cerrar')} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('processes.process_label', 'Proceso')}</p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">{process.name}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3">
                <p className="text-zinc-500 dark:text-zinc-400">{t('processes.incidents', 'Incidentes')}</p>
                <p className="text-base font-bold text-zinc-900 dark:text-white">{process.incidentsDuringProcess}</p>
              </div>
              <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3">
                <p className="text-zinc-500 dark:text-zinc-400">{t('processes.alerts_responded', 'Alertas atendidas')}</p>
                <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">+{process.alertsResponded}</p>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3">
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">{t('processes.compliance_auto', 'Cumplimiento auto-calculado')}</p>
              <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{auto} / 100</p>
              <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                {t('processes.crew_xp_estimate', 'XP estimado para la cuadrilla')}:{' '}
                <span className="font-mono font-bold">+{previewXp}</span>{' '}
                <span className="text-zinc-500 dark:text-zinc-400">({t('processes.base_xp_label', 'base')} {baseXpForProcessType(process.type)})</span>
              </p>
            </div>

            {process.incidentsDuringProcess > 0 && (
              <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {t('processes.incidents_warning', 'Hubo incidentes durante el proceso. La cuadrilla mantiene su XP por las respuestas atendidas — la gamificación es siempre positiva.')}
                </span>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t('common.cancel', 'Cancelar')}
            </button>
            <button
              disabled={submitting}
              onClick={submit}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <PartyPopper className="w-3.5 h-3.5" />
              {submitting ? t('processes.closing', 'Cerrando…') : t('processes.close_celebrate', 'Cerrar y celebrar')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
