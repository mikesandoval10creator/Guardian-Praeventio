import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Heart, Stethoscope, User, Calendar, Loader2 } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { logger } from '../../utils/logger';

interface AddMedicineModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

// NOTE: Data values are kept in Spanish as canonical identifiers persisted in
// metadata (status mapping checks for 'Pendiente'). UI labels are localised
// separately via the `examTypeLabel` / `resultLabel` helpers below.
const examTypes = [
  'Pre-ocupacional',
  'Periódico',
  'Retiro',
  'Post-incapacidad',
  'Vigilancia Epidemiológica',
];

const results = [
  'Apto',
  'Apto con restricción',
  'No Apto',
  'Pendiente',
];

export function AddMedicineModal({ isOpen, onClose, projectId }: AddMedicineModalProps) {
  const { t } = useTranslation();
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);

  const examTypeLabel = (value: string) => {
    switch (value) {
      case 'Pre-ocupacional': return t('medicine.exam_pre_occupational', value);
      case 'Periódico': return t('medicine.exam_periodic', value);
      case 'Retiro': return t('medicine.exam_retirement', value);
      case 'Post-incapacidad': return t('medicine.exam_post_disability', value);
      case 'Vigilancia Epidemiológica': return t('medicine.exam_epidemiological', value);
      default: return value;
    }
  };

  const resultLabel = (value: string) => {
    switch (value) {
      case 'Apto': return t('medicine.result_fit', value);
      case 'Apto con restricción': return t('medicine.result_fit_with_restriction', value);
      case 'No Apto': return t('medicine.result_unfit', value);
      case 'Pendiente': return t('medicine.result_pending', value);
      default: return value;
    }
  };
  const [formData, setFormData] = useState({
    patient: '',
    type: examTypes[0],
    date: new Date().toISOString().split('T')[0],
    result: results[0],
    observations: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addNode({
        type: NodeType.MEDICINE,
        title: `Examen ${formData.type} - ${formData.patient}`,
        description: `Examen médico de tipo ${formData.type} para el trabajador ${formData.patient}. Resultado: ${formData.result}. Observaciones: ${formData.observations}`,
        tags: ['medicina', String(formData.type || '').toLowerCase(), String(formData.result || '').toLowerCase().replace(' ', '-')],
        metadata: {
          patient: formData.patient,
          examType: formData.type,
          date: formData.date,
          result: formData.result,
          observations: formData.observations,
          status: formData.result === 'Pendiente' ? 'scheduled' : 'completed'
        },
        connections: [],
        projectId: projectId
      });

      onClose();
      setFormData({
        patient: '',
        type: examTypes[0],
        date: new Date().toISOString().split('T')[0],
        result: results[0],
        observations: '',
      });
    } catch (error) {
      logger.error('Error adding medicine node:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-rose-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400">
                  {/* Sprint 17c — Bioicons stethoscope decorates the consult modal header. */}
                  <MedicalIcon name="stethoscope" size={28} alt={t('medicine.icon_alt_consultation', 'Consulta médica')} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    {t('medicine.modal_new_title', 'Nueva Consulta')}
                    <MedicalIcon name="pill" size={18} alt={t('medicine.icon_alt_pill', 'Pastilla')} />
                    <MedicalIcon name="syringe" size={18} alt={t('medicine.icon_alt_syringe', 'Inyección')} />
                    <MedicalIcon name="iv-bag" size={18} alt={t('medicine.icon_alt_iv_bag', 'Suero')} />
                  </h2>
                  <p className="text-xs text-zinc-400">{t('medicine.modal_new_subtitle', 'Registro de salud ocupacional')}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{t('medicine.field_patient', 'Paciente / Trabajador')}</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    required
                    type="text"
                    value={formData.patient}
                    onChange={(e) => setFormData({ ...formData, patient: e.target.value })}
                    placeholder={t('medicine.field_patient_placeholder', 'Nombre completo')}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{t('medicine.field_exam_type', 'Tipo de Examen')}</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                  >
                    {examTypes.map(value => (
                      <option key={value} value={value}>{examTypeLabel(value)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{t('medicine.field_date', 'Fecha')}</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      required
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{t('medicine.field_result', 'Resultado')}</label>
                <select
                  value={formData.result}
                  onChange={(e) => setFormData({ ...formData, result: e.target.value })}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                >
                  {results.map(r => (
                    <option key={r} value={r}>{resultLabel(r)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">{t('medicine.field_observations', 'Observaciones')}</label>
                <textarea
                  value={formData.observations}
                  onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                  placeholder={t('medicine.field_observations_placeholder', 'Detalles adicionales...')}
                  rows={3}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm resize-none"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors"
                >
                  {t('common.cancel', 'Cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('medicine.submit_saving', 'Guardando...')}</span>
                    </>
                  ) : (
                    <span>{t('medicine.submit_save', 'Guardar')}</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
