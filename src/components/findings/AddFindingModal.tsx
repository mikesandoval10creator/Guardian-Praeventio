import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, MapPin, Tag, Loader2, Shield, Activity, Zap, Sparkles, Camera } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';
import { generateActionPlan, analyzeSafetyImage } from '../../services/geminiService';
import { logAuditAction } from '../../services/auditService';
import { logger } from '../../utils/logger';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../shared/ToastContainer';
import { analytics } from '../../services/analytics';
import type { RiskClass, Severity } from '../../services/analytics';

interface AddFindingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Spanish UI category → catalog `RiskClass` enum (property-glossary).
 * Unknown labels fall back to `mechanical` (the catch-all in the IPER
 * taxonomy) — keeps dashboards consistent rather than emitting bare
 * strings that would explode cardinality.
 */
function mapCategoryToRiskClass(category: string): string {
  switch (category) {
    case 'Salud': return 'ergonomic';
    case 'Higiene': return 'chemical';
    case 'Ergonomía': return 'ergonomic';
    case 'Ambiental': return 'weather';
    case 'Seguridad':
    default: return 'mechanical';
  }
}

/** Spanish UI severity → catalog `Severity` enum. */
function mapSeverityLabel(label: string): string {
  switch (label) {
    case 'Crítica': return 'critical';
    case 'Alta': return 'high';
    case 'Media': return 'medium';
    case 'Baja':
    default: return 'low';
  }
}

export function AddFindingModal({ isOpen, onClose }: AddFindingModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [generateAIPlan, setGenerateAIPlan] = useState(true);
  const { addNode, addConnection } = useRiskEngine();
  const { selectedProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toasts, show: showToast, dismiss } = useToast();
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    severity: 'Baja',
    category: 'Seguridad',
    tags: ''
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingImage(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result as string;
        const base64Image = base64Data.split(',')[1];
        const mimeType = file.type;

        const analysis = await analyzeSafetyImage(base64Image, mimeType, `Proyecto: ${selectedProject?.name}`);
        
        let newDescription = analysis.description;
        if (analysis.unsafeConditions && analysis.unsafeConditions.length > 0) {
          newDescription += `\n\nCondiciones Inseguras:\n${analysis.unsafeConditions.map((c: string) => `- ${c}`).join('\n')}`;
        }
        if (analysis.missingEPP && analysis.missingEPP.length > 0) {
          newDescription += `\n\nEPP Faltante:\n${analysis.missingEPP.map((e: string) => `- ${e}`).join('\n')}`;
        }
        if (analysis.immediateAction) {
          newDescription += `\n\nAcción Inmediata: ${analysis.immediateAction}`;
        }

        setFormData(prev => ({
          ...prev,
          title: analysis.title || prev.title,
          description: newDescription,
          severity: analysis.severity || prev.severity,
          category: analysis.category || prev.category,
          tags: analysis.tags ? analysis.tags.join(', ') : prev.tags
        }));
      };
      reader.readAsDataURL(file);
    } catch (error) {
      logger.error('Error analyzing image:', error);
      showToast(t('findings.toast_image_error', 'Error al analizar la imagen con IA.'), 'error');
    } finally {
      setIsAnalyzingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      // 1. Create Finding Node
      const findingNode = await addNode({
        type: NodeType.FINDING,
        title: formData.title,
        description: formData.description,
        tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          location: formData.location,
          severity: formData.severity,
          category: formData.category,
          status: 'Abierto',
          createdAt: new Date().toISOString()
        }
      });

      if (findingNode) {
        await logAuditAction(
          'CREATE_FINDING',
          'Findings',
          {
            findingId: findingNode.id,
            title: formData.title,
            severity: formData.severity,
            category: formData.category,
            location: formData.location
          },
          selectedProject.id
        );

        // Wave-9 analytics: a finding == a manually-reported risk in the
        // tracking-plan taxonomy (TRACKING_PLAN §5 / event-catalog "Riesgos"
        // — risk.reported.manual). Map the Spanish UI category/severity
        // labels to the closed-set RiskClass / Severity enums; unknown
        // values collapse to safe defaults so dashboard cardinality is
        // bounded.
        try {
          analytics.track('risk.reported.manual', {
            risk_id: findingNode.id,
            risk_class: mapCategoryToRiskClass(formData.category) as RiskClass,
            severity: mapSeverityLabel(formData.severity) as Severity,
          });
        } catch { /* analytics must never break user flow */ }
      }

      if (findingNode && generateAIPlan) {
        // 2. Generate Action Plan with AI
        const plan = await generateActionPlan(formData.title, formData.description, formData.severity);
        
        // 3. Create Task Nodes for each action
        for (const tarea of plan.tareas) {
          const taskNode = await addNode({
            type: NodeType.TASK,
            title: tarea.titulo,
            description: tarea.descripcion,
            tags: ['Acción Correctiva', 'IA', tarea.prioridad],
            projectId: selectedProject.id,
            connections: [],
            metadata: {
              findingId: findingNode.id,
              plazoDias: tarea.plazoDias,
              prioridad: tarea.prioridad,
              status: 'Pendiente'
            }
          });

          if (taskNode) {
            // 4. Connect Task to Finding
            await addConnection(findingNode.id, taskNode.id);
          }
        }
      }

      onClose();
      setFormData({
        title: '',
        description: '',
        location: '',
        severity: 'Baja',
        category: 'Seguridad',
        tags: ''
      });
    } catch (error) {
      logger.error('Error adding finding:', error);
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-amber-500/30 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl shadow-amber-500/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                  <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">{t('findings.modal_new_title', 'Nuevo Hallazgo')}</h3>
                  <p className="text-[10px] text-amber-300 font-bold uppercase tracking-widest truncate">{t('findings.modal_new_subtitle', 'Registrar observación o no conformidad')}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1">
              <div className="p-6 border-b border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-amber-500/30 rounded-2xl bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                  />
                  {isAnalyzingImage ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                      <p className="text-xs font-bold text-amber-500 uppercase tracking-widest text-center">{t('findings.image_analyzing', 'Analizando imagen con IA...')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <Camera className="w-6 h-6 text-amber-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-amber-500 uppercase tracking-widest">{t('findings.image_inspection_title', 'Inspección Visual IA')}</p>
                        <p className="text-[10px] text-zinc-400 mt-1">{t('findings.image_inspection_hint', 'Sube o toma una foto para autocompletar el hallazgo')}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <form id="add-finding-form" onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_title', 'Título del Hallazgo')}</label>
                  <input
                    required
                    aria-label={t('findings.field_title', 'Título del Hallazgo')}
                    type="text"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    placeholder={t('findings.field_title_placeholder', 'Ej: Falta de señalética en zona de carga')}
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_severity', 'Severidad')}</label>
                    <select
                      value={formData.severity}
                      onChange={e => setFormData({ ...formData, severity: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all appearance-none"
                    >
                      <option value="Baja">{t('findings.severity_low', 'Baja')}</option>
                      <option value="Media">{t('findings.severity_medium', 'Media')}</option>
                      <option value="Alta">{t('findings.severity_high', 'Alta')}</option>
                      <option value="Crítica">{t('findings.severity_critical', 'Crítica')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_category', 'Categoría')}</label>
                    <select
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all appearance-none"
                    >
                      <option value="Seguridad">{t('findings.category_safety', 'Seguridad')}</option>
                      <option value="Salud">{t('findings.category_health', 'Salud')}</option>
                      <option value="Higiene">{t('findings.category_hygiene', 'Higiene')}</option>
                      <option value="Ergonomía">{t('findings.category_ergonomics', 'Ergonomía')}</option>
                      <option value="Ambiental">{t('findings.category_environment', 'Ambiental')}</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_location', 'Ubicación / Área')}</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      required
                      type="text"
                      maxLength={200}
                      value={formData.location}
                      onChange={e => setFormData({ ...formData, location: e.target.value.trimStart() })}
                      placeholder={t('findings.field_location_placeholder', 'Ej: Bodega Central, Sector B')}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_description', 'Descripción Detallada')}</label>
                  <textarea
                    required
                    aria-label={t('findings.field_description', 'Descripción Detallada')}
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('findings.field_description_placeholder', 'Describe lo observado y el riesgo potencial...')}
                    rows={5}
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{t('findings.field_tags', 'Etiquetas (separadas por coma)')}</label>
                  <div className="relative">
                    <Tag className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="text"
                      value={formData.tags}
                      onChange={e => setFormData({ ...formData, tags: e.target.value })}
                      placeholder={t('findings.field_tags_placeholder', 'epp, señaletica, riesgo-caida')}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                    />
                  </div>
                </div>

                <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-900 dark:text-white">{t('findings.ai_plan_title', 'Plan de Acción IA')}</p>
                      <p className="text-[8px] text-zinc-500 font-medium">{t('findings.ai_plan_subtitle', 'Generar tareas correctivas automáticamente')}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGenerateAIPlan(!generateAIPlan)}
                    className={`w-12 h-6 rounded-full transition-all relative ${generateAIPlan ? 'bg-amber-500' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${generateAIPlan ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
              </form>
            </div>
            
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-zinc-900 dark:text-white bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                {t('findings.btn_cancel', 'Cancelar')}
              </button>
              <button
                type="submit"
                form="add-finding-form"
                disabled={loading || isAnalyzingImage}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-black bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('findings.btn_registering', 'Registrando...')}</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    <span>{t('findings.btn_register', 'Registrar Hallazgo')}</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </AnimatePresence>
  );
}
