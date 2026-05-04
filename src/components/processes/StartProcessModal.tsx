// SPDX-License-Identifier: MIT
// Sprint 16 — Process lifecycle modal: arranque de proceso.
//
// Form modal for POST /api/processes. Spanish UI, semantic tokens, no
// blocking — modal is informational and dismissable. The crew/project
// IDs come from the parent page (via context-aware caller) so the modal
// stays decoupled from app routing.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Hammer } from 'lucide-react';
import type { ProcessType } from '../../types/organic';
import { auth } from '../../services/firebase';
import { analytics } from '../../services/analytics';
import type { ProcesoTemplate } from '../../services/analytics';

// NOTE: ProcessType values are stable identifiers persisted to Firestore.
// Only the display labels are localised via processTypeLabel below.
const PROCESS_TYPE_VALUES: ProcessType[] = [
  'concreto',
  'fachada',
  'movimiento_tierras',
  'soldadura',
  'mantenimiento',
  'demolicion',
  'instalacion_electrica',
  'pintura',
  'topografia',
  'transporte',
  'otro',
];

export interface StartProcessModalProps {
  isOpen: boolean;
  projectId: string;
  crewId: string;
  crewName?: string;
  onClose: () => void;
  onCreated?: (processId: string) => void;
}

export function StartProcessModal({ isOpen, projectId, crewId, crewName, onClose, onCreated }: StartProcessModalProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<ProcessType>('concreto');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processTypeLabel = (value: ProcessType): string => {
    switch (value) {
      case 'concreto': return t('processes.type_concrete', 'Concreto');
      case 'fachada': return t('processes.type_facade', 'Fachada');
      case 'movimiento_tierras': return t('processes.type_earthworks', 'Movimiento de tierras');
      case 'soldadura': return t('processes.type_welding', 'Soldadura');
      case 'mantenimiento': return t('processes.type_maintenance', 'Mantenimiento');
      case 'demolicion': return t('processes.type_demolition', 'Demolición');
      case 'instalacion_electrica': return t('processes.type_electrical', 'Instalación eléctrica');
      case 'pintura': return t('processes.type_painting', 'Pintura');
      case 'topografia': return t('processes.type_surveying', 'Topografía');
      case 'transporte': return t('processes.type_transport', 'Transporte');
      case 'otro': return t('processes.type_other', 'Otro');
      default: return value;
    }
  };

  if (!isOpen) return null;

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('processes.error_name_required', 'El nombre es obligatorio.'));
      return;
    }
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setError(t('processes.error_no_session', 'Sesión no disponible. Reintenta en un momento.'));
        setSubmitting(false);
        return;
      }
      const res = await fetch('/api/processes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          projectId,
          crewId,
          type,
          name: name.trim(),
          description: description.trim(),
          plannedEndDate: plannedEndDate || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      const j = await res.json();
      // Wave-14 analytics: a freshly-created proceso is the canonical
      // `proceso.created` signal (catalog row 48). The org-domain
      // `ProcessType` is a concrete work class (concreto, fachada, …) —
      // not the protocol-kind enum the catalog asks for, so we collapse
      // to `custom` here. When IPER/PREXOR/TMERT-driven creation is
      // wired (Sprint 21+) this mapping should bubble the protocol id up.
      try {
        const procesoTemplate: ProcesoTemplate = 'custom';
        analytics.track('proceso.created', {
          proceso_id: j.id,
          proceso_template: procesoTemplate,
        });
      } catch { /* analytics must never break user flow */ }
      onCreated?.(j.id);
      // Reset
      setName('');
      setDescription('');
      setPlannedEndDate('');
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
              <Hammer className="w-4 h-4 text-[var(--accent-primary,#4db6ac)]" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{t('processes.start_title', 'Iniciar proceso')}</h3>
            </div>
            <button onClick={onClose} aria-label={t('common.close', 'Cerrar')} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {crewName && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('processes.crew_label', 'Cuadrilla')}: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{crewName}</span>
              </p>
            )}

            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">{t('processes.field_type', 'Tipo de proceso')}</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ProcessType)}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
              >
                {PROCESS_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>{processTypeLabel(value)}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">{t('processes.field_name', 'Nombre')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('processes.field_name_placeholder', 'p.ej. Hormigonado losa nivel 3')}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
                maxLength={120}
              />
            </label>

            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">{t('processes.field_description', 'Descripción')}</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
                maxLength={500}
              />
            </label>

            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">{t('processes.field_planned_end_date', 'Fecha estimada de cierre')}</span>
              <input
                type="date"
                value={plannedEndDate}
                onChange={(e) => setPlannedEndDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
              />
            </label>

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
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? t('processes.starting', 'Iniciando…') : t('processes.start_button', 'Iniciar')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
