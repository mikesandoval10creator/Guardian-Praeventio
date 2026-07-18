// SPDX-License-Identifier: MIT
// Sprint 20 — Bucket D: Create-crew modal for the Cuadrillas dashboard.
//
// Minimal create form: nombre + descripción opcional. Submits via
// POST /api/crews using the same Authorization-bearer pattern as the
// other organic modals (StartProcess/CloseProcess). The endpoint already
// gates by project membership so this modal stays a thin client.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Users } from 'lucide-react';
import { auth } from '../../services/firebase';
import { apiAuthHeader } from '../../lib/apiAuth';
import { humanErrorFromBody } from '../../lib/humanError';
import { humanErrorMessage } from '../../lib/humanError';


export interface CreateCrewModalProps {
  isOpen: boolean;
  projectId: string;
  onClose: () => void;
  onCreated?: (crewId: string) => void;
}

export function CreateCrewModal({ isOpen, projectId, onClose, onCreated }: CreateCrewModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('crews.error_name_required', 'El nombre es obligatorio.'));
      return;
    }
    setSubmitting(true);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) {
        setError(t('crews.error_no_session', 'Sesión no disponible. Reintenta en un momento.'));
        setSubmitting(false);
        return;
      }
      const res = await fetch('/api/crews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          // Body field is required by the route; we start with the
          // current user implicitly via server-side createdBy. Empty
          // memberUids is allowed — the dashboard exposes "Agregar miembro"
          // separately via /api/crews/:id/members.
          memberUids: [],
          description: description.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(humanErrorFromBody(j, res.status));
        setSubmitting(false);
        return;
      }
      const j = await res.json();
      onCreated?.(j.id);
      setName('');
      setDescription('');
      onClose();
    } catch (err: any) {
      setError(humanErrorMessage(err?.message ?? t('crews.error_network', 'Error de red')));
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
              <Users className="w-4 h-4 text-[var(--accent-primary,#4db6ac)]" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                {t('crews.create_title', 'Nueva cuadrilla')}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close', 'Cerrar')}
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                {t('crews.field_name', 'Nombre')}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('crews.field_name_placeholder', 'p.ej. Cuadrilla A — Estructuras')}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
                maxLength={120}
              />
            </label>

            <label className="block text-xs">
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                {t('crews.field_description', 'Descripción')}
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t('crews.field_description_placeholder', 'Tareas habituales, turno, faena…')}
                className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
                maxLength={500}
              />
            </label>

            {error && (
              <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                {humanErrorMessage(error)}
              </p>
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
              {submitting ? t('crews.creating', 'Creando…') : t('crews.create_button', 'Crear cuadrilla')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
