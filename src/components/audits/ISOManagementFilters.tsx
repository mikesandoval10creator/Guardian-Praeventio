import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ISODocumentEstado = 'Vigente' | 'Obsoleto' | 'En revisión';

export interface ISODocumentFormState {
  nombre: string;
  tipo: string;
  version: string;
  fecha: string;
  estado: ISODocumentEstado;
}

export interface ISOManagementFiltersProps {
  show: boolean;
  saving: boolean;
  form: ISODocumentFormState;
  onChange: (form: ISODocumentFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const TEAL = '#4db6ac';

/**
 * ISOManagementFilters
 * Inline form (search/category/status/date inputs + dropdowns) used by the
 * Documentos tab to add new ISO documents. Extracted from ISOManagement.tsx
 * (F-C14, Sprint 20 second wave). The shape mirrors a typical filters bar:
 * a primary text input ("nombre"), category/version inputs, a date picker,
 * and a status dropdown (Vigente / En revisión / Obsoleto).
 */
export function ISOManagementFilters({
  show,
  saving,
  form,
  onChange,
  onCancel,
  onSubmit,
}: ISOManagementFiltersProps) {
  const { t } = useTranslation();
  const update = <K extends keyof ISODocumentFormState>(key: K, value: ISODocumentFormState[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="bg-white/80 dark:bg-zinc-900/80 rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: TEAL }}>{t('audits.docs_new_title', 'Nuevo Documento ISO')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{t('audits.docs_field_name', 'Nombre *')}</label>
                <input
                  value={form.nombre}
                  onChange={e => update('nombre', e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/30"
                  placeholder={t('audits.docs_field_name_placeholder', 'Manual de Seguridad ISO 45001...')}
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{t('audits.docs_field_type', 'Tipo')}</label>
                <input
                  value={form.tipo}
                  onChange={e => update('tipo', e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                  placeholder={t('audits.docs_field_type_placeholder', 'Manual / Procedimiento...')}
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{t('audits.docs_field_version', 'Versión')}</label>
                <input
                  value={form.version}
                  onChange={e => update('version', e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                  placeholder="1.0"
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{t('audits.docs_field_date', 'Fecha')}</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={e => update('fecha', e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1">{t('audits.docs_field_status', 'Estado')}</label>
                <select
                  value={form.estado}
                  onChange={e => update('estado', e.target.value as ISODocumentEstado)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700 focus:outline-none"
                >
                  <option value="Vigente">{t('audits.docs_status_active', 'Vigente')}</option>
                  <option value="En revisión">{t('audits.docs_status_review', 'En revisión')}</option>
                  <option value="Obsoleto">{t('audits.docs_status_obsolete', 'Obsoleto')}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={onCancel}
                className="px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                onClick={onSubmit}
                disabled={saving || !form.nombre.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: TEAL }}
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {t('common.save', 'Guardar')}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
