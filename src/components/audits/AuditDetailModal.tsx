import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ClipboardCheck, Calendar, User, Loader2, Save, CheckCircle2, FileText, Wand2, AlertTriangle, WifiOff } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType, RiskNode } from '../../types';
import { useProject } from '../../contexts/ProjectContext';
import { generateISOAuditChecklist, generateActionPlan } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import confetti from 'canvas-confetti';

interface AuditDetailModalProps {
  audit: RiskNode | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ISOItem {
  id: string;
  question: string;
  reference: string;
  status: 'Cumple' | 'No Cumple' | 'N/A' | 'Pendiente';
  observation: string;
  workerProposal?: string;
}

export function AuditDetailModal({ audit, isOpen, onClose }: AuditDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [auditData, setAuditData] = useState<{ title: string; description: string; items: ISOItem[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const isOnline = useOnlineStatus();
  
  const { nodes, updateNode, addNode, addConnection } = useRiskEngine();
  const { selectedProject } = useProject();

  // Reset state when modal opens/closes or audit changes
  React.useEffect(() => {
    if (audit?.metadata.items) {
      setAuditData({
        title: audit.title,
        description: audit.description,
        items: audit.metadata.items
      });
      setSaved(audit.metadata.status === 'Completada' || audit.metadata.status === 'Completado');
    } else {
      setAuditData(null);
      setSaved(false);
    }
    setGenerating(false);
    setLoading(false);
  }, [audit, isOpen]);

  if (!audit) return null;

  const isPlanned = audit.metadata.status === 'Planificada';
  const isCompleted = audit.metadata.status === 'Completada' || audit.metadata.status === 'Completado';

  const handleGenerateChecklist = async () => {
    setGenerating(true);
    setAuditData(null);
    setSaved(false);
    try {
      // Determine which standard/topic to use based on tags or title
      const isoTag = audit.tags.find(t => t.includes('ISO'));
      const auditTopic = isoTag || audit.title;
      
      // Gather context from Risk Network
      const contextNodes = nodes
        .filter(n => !selectedProject || n.projectId === selectedProject.id)
        .slice(0, 30)
        .map(n => `- ${n.title} (${n.type}): ${n.description}`)
        .join('\n');

      const result = await generateISOAuditChecklist(auditTopic, contextNodes);
      
      const itemsWithStatus = result.items.map((item: any) => ({
        ...item,
        status: 'Pendiente',
        observation: '',
        workerProposal: ''
      }));

      setAuditData({
        title: result.title,
        description: result.description,
        items: itemsWithStatus
      });
    } catch (error) {
      console.error('Error generating ISO checklist:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateItem = (id: string, updates: Partial<ISOItem>) => {
    if (!auditData) return;
    setAuditData({
      ...auditData,
      items: auditData.items.map(item => item.id === id ? { ...item, ...updates } : item)
    });
  };

  const handleSave = async () => {
    if (!auditData || !selectedProject) return;
    setLoading(true);
    try {
      // Calculate score
      const applicableItems = auditData.items.filter(i => i.status !== 'N/A' && i.status !== 'Pendiente');
      const compliantItems = applicableItems.filter(i => i.status === 'Cumple');
      const score = applicableItems.length > 0 ? Math.round((compliantItems.length / applicableItems.length) * 100) : 0;

      // 1. Update existing Audit Node
      await updateNode(audit.id, {
        description: `${auditData.description}\n\nPuntaje de Cumplimiento: ${score}%\n\nResultados:\n${auditData.items.map(i => `- [${i.reference}] ${i.question}: ${i.status} (${i.observation})`).join('\n')}`,
        metadata: { 
          ...audit.metadata,
          items: auditData.items, 
          status: 'Completada',
          score,
          completedAt: new Date().toISOString()
        }
      });

      // 2. Generate Action Plans for "No Cumple" items
      const nonCompliantItems = auditData.items.filter(i => i.status === 'No Cumple');
      if (nonCompliantItems.length > 0) {
        for (const item of nonCompliantItems) {
          const context = `[${item.reference}] ${item.question}: ${item.observation}`;
          const plan = await generateActionPlan(`No Conformidades - ${audit.title}`, context, 'Alta', item.workerProposal);

          for (const task of plan.tareas) {
            const taskNode = await addNode({
              type: NodeType.TASK,
              title: task.titulo,
              description: task.descripcion,
              tags: ['Acción Correctiva', 'No Conformidad', task.prioridad],
              metadata: {
                status: 'Pendiente',
                priority: task.prioridad,
                deadline: new Date(Date.now() + task.plazoDias * 24 * 60 * 60 * 1000).toISOString(),
                source: 'Auditoría ISO AI',
                workerProposal: item.workerProposal
              },
              projectId: selectedProject.id,
              connections: []
            });

            if (taskNode) {
              await addConnection(audit.id, taskNode.id);
            }
          }
        }
      } else if (score === 100) {
        // Zero findings! Recompensas Dopaminérgicas Elegantes
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.5 },
          colors: ['#4f46e5', '#818cf8', '#c7d2fe'], // Indigo colors for ISO
          disableForReducedMotion: true
        });
      }

      setSaved(true);
    } catch (error) {
      console.error('Error saving ISO audit:', error);
    } finally {
      setLoading(false);
    }
  };

  const isComplete = auditData?.items.every(i => i.status !== 'Pendiente');

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
            className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-blue-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <ClipboardCheck className="w-6 h-6 text-blue-600 dark:text-blue-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-tight">{audit.title}</h3>
                  <p className="text-xs text-zinc-500 font-medium flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                      isCompleted ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {audit.metadata.status}
                    </span>
                    {audit.metadata.type} • {audit.metadata.date ? new Date(audit.metadata.date).toLocaleDateString('es-CL') : 'Sin fecha'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* If planned, show generate button */}
              {isPlanned && !auditData && !generating && (
                <div className="flex flex-col items-center justify-center py-12 gap-4 bg-zinc-50 dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/10">
                  <Wand2 className="w-12 h-12 text-indigo-500 dark:text-indigo-400" />
                  <div className="text-center">
                    <h4 className="text-zinc-900 dark:text-white font-bold text-lg">Generar Checklist con IA</h4>
                    <p className="text-zinc-400 text-sm mt-1 max-w-md">
                      El sistema analizará el contexto del proyecto y generará un checklist específico para esta auditoría.
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateChecklist}
                    disabled={!isOnline}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all mt-2 ${!isOnline ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                  >
                    {!isOnline ? <WifiOff className="w-4 h-4" /> : <Wand2 className="w-4 h-4" />}
                    {!isOnline ? 'Requiere Conexión' : 'Generar Checklist'}
                  </button>
                </div>
              )}

              {generating && (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-xl animate-pulse" />
                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin relative z-10" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Analizando Red Neuronal</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Generando checklist adaptado a su proyecto...</p>
                  </div>
                </div>
              )}

              {auditData && !generating && (
                <div className="space-y-6">
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4">
                    <h4 className="text-sm font-black text-indigo-400 uppercase tracking-tight">{auditData.title}</h4>
                    <p className="text-xs text-indigo-300 mt-1">{auditData.description}</p>
                  </div>

                  <div className="space-y-4">
                    {auditData.items.map((item, index) => (
                      <div key={item.id} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700/50 space-y-4">
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-black text-zinc-500 dark:text-zinc-400">{index + 1}</span>
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                                Ref: {item.reference}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-zinc-900 dark:text-white leading-relaxed">{item.question}</p>
                          </div>
                        </div>

                        <div className="pl-12 flex flex-col gap-4">
                          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                            <div className="flex bg-white dark:bg-zinc-900 rounded-xl p-1 border border-zinc-200 dark:border-zinc-700 shrink-0">
                              {(['Cumple', 'No Cumple', 'N/A'] as const).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => !isCompleted && handleUpdateItem(item.id, { status: s })}
                                  disabled={isCompleted}
                                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                    item.status === s
                                      ? s === 'Cumple' ? 'bg-emerald-500 text-white shadow-sm' : s === 'No Cumple' ? 'bg-red-500 text-white shadow-sm' : 'bg-zinc-500 text-white shadow-sm'
                                      : 'text-zinc-400 hover:text-zinc-200 disabled:opacity-50'
                                  }`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                            
                            <div className="flex-1">
                              <input
                                type="text"
                                value={item.observation}
                                onChange={(e) => handleUpdateItem(item.id, { observation: e.target.value })}
                                disabled={isCompleted}
                                placeholder={item.status === 'No Cumple' ? "Describa la no conformidad (Requerido)..." : "Observaciones adicionales (Opcional)..."}
                                className={`w-full bg-white dark:bg-zinc-900 border rounded-xl px-4 py-2 text-xs outline-none transition-colors disabled:opacity-70 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 ${
                                  item.status === 'No Cumple' && !item.observation 
                                    ? 'border-red-500/50 focus:border-red-500' 
                                    : 'border-zinc-200 dark:border-zinc-700 focus:border-indigo-500'
                                }`}
                              />
                            </div>
                          </div>
                          {item.status === 'No Cumple' && (
                            <div className="animate-in fade-in slide-in-from-top-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Propuesta de Mejora (Trabajador)</label>
                              <textarea
                                value={item.workerProposal || ''}
                                onChange={(e) => handleUpdateItem(item.id, { workerProposal: e.target.value })}
                                disabled={isCompleted}
                                placeholder="¿Qué sugiere el equipo para solucionar esta no conformidad?"
                                className="w-full bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-900/30 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500 resize-none h-20 disabled:opacity-70 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {auditData && !isCompleted && (
              <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900 shrink-0 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={loading || !isComplete || saved || (auditData.items.some(i => i.status === 'No Cumple' && !i.observation)) || !isOnline}
                  className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                    !isOnline
                      ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : saved 
                        ? 'bg-emerald-500 text-white' 
                        : isComplete 
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:scale-105' 
                          : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  {!isOnline ? <WifiOff className="w-4 h-4" /> : loading ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {!isOnline ? 'Requiere Conexión' : saved ? 'Auditoría Guardada' : 'Finalizar y Generar Plan de Acción'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
