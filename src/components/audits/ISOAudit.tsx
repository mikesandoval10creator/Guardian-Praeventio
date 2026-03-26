import React, { useState } from 'react';
import { ClipboardCheck, Play, Save, Loader2, CheckCircle2, FileText, AlertTriangle, Wand2 } from 'lucide-react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { generateISOAuditChecklist, generateActionPlan } from '../../services/geminiService';
import { motion, AnimatePresence } from 'framer-motion';

interface ISOItem {
  id: string;
  question: string;
  reference: string;
  status: 'Cumple' | 'No Cumple' | 'N/A' | 'Pendiente';
  observation: string;
  workerProposal?: string;
}

export function ISOAudit() {
  const [selectedISO, setSelectedISO] = useState<string>('ISO 45001:2018');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [auditData, setAuditData] = useState<{ title: string; description: string; items: ISOItem[] } | null>(null);
  const [saved, setSaved] = useState(false);
  
  const { nodes, addNode, addConnection } = useZettelkasten();
  const { selectedProject } = useProject();

  const handleGenerateChecklist = async () => {
    setGenerating(true);
    setAuditData(null);
    setSaved(false);
    try {
      // Gather context from Zettelkasten
      const contextNodes = nodes
        .filter(n => !selectedProject || n.projectId === selectedProject.id)
        .slice(0, 30)
        .map(n => `- ${n.title} (${n.type}): ${n.description}`)
        .join('\n');

      const result = await generateISOAuditChecklist(selectedISO, contextNodes);
      
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

      // 1. Create Audit Node
      const auditNode = await addNode({
        type: NodeType.AUDIT,
        title: `Auditoría ${selectedISO}: ${auditData.title}`,
        description: `${auditData.description}\n\nPuntaje de Cumplimiento: ${score}%\n\nResultados:\n${auditData.items.map(i => `- [${i.reference}] ${i.question}: ${i.status} (${i.observation})`).join('\n')}`,
        tags: ['Auditoría ISO', selectedISO.split(':')[0], 'Compliance'],
        metadata: { 
          items: auditData.items, 
          status: 'Completada',
          type: 'Certificación',
          score,
          date: new Date().toISOString(),
          auditor: 'AI Assistant'
        },
        projectId: selectedProject.id,
        connections: []
      });

      if (!auditNode) throw new Error("Failed to create audit node");

      // 2. Generate Action Plans for "No Cumple" items
      const nonCompliantItems = auditData.items.filter(i => i.status === 'No Cumple');
      if (nonCompliantItems.length > 0) {
        for (const item of nonCompliantItems) {
          const context = `[${item.reference}] ${item.question}: ${item.observation}`;
          const plan = await generateActionPlan(`No Conformidades - ${selectedISO}`, context, 'Alta', item.workerProposal);

          for (const task of plan.tareas) {
            const taskNode = await addNode({
              type: NodeType.TASK,
              title: task.titulo,
              description: task.descripcion,
              tags: ['Acción Correctiva', 'No Conformidad', task.prioridad, selectedISO.split(':')[0]],
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
              await addConnection(auditNode.id, taskNode.id);
            }
          }
        }
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
    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-6 space-y-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white">Auditoría ISO Inteligente</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Auditoría Colaborativa y Generación de Checklist</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <select
            value={selectedISO}
            onChange={(e) => setSelectedISO(e.target.value)}
            disabled={generating || loading || !!auditData}
            className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-xs font-bold text-zinc-900 dark:text-white outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="ISO 45001:2018">ISO 45001:2018 (SST)</option>
            <option value="ISO 9001:2015">ISO 9001:2015 (Calidad)</option>
            <option value="ISO 14001:2015">ISO 14001:2015 (Medio Ambiente)</option>
          </select>
          
          {!auditData ? (
            <Button
              onClick={handleGenerateChecklist}
              disabled={generating}
              className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Generar Checklist
            </Button>
          ) : (
            <Button
              onClick={() => setAuditData(null)}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {generating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col items-center justify-center py-12 gap-4"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-xl animate-pulse" />
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin relative z-10" />
            </div>
            <div className="text-center">
              <p className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">Analizando Zettelkasten</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Generando checklist {selectedISO} adaptado a su proyecto...</p>
            </div>
          </motion.div>
        )}

        {auditData && !generating && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl p-4">
              <h4 className="text-sm font-black text-indigo-900 dark:text-indigo-400 uppercase tracking-tight">{auditData.title}</h4>
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">{auditData.description}</p>
            </div>

            <div className="space-y-4">
              {auditData.items.map((item, index) => (
                <div key={item.id} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-700/50 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-black text-zinc-600 dark:text-zinc-400">{index + 1}</span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
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
                            onClick={() => handleUpdateItem(item.id, { status: s })}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                              item.status === s
                                ? s === 'Cumple' ? 'bg-emerald-500 text-white shadow-sm' : s === 'No Cumple' ? 'bg-red-500 text-white shadow-sm' : 'bg-zinc-500 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
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
                          placeholder={item.status === 'No Cumple' ? "Describa la no conformidad (Requerido)..." : "Observaciones adicionales (Opcional)..."}
                          className={`w-full bg-white dark:bg-zinc-900 border rounded-xl px-4 py-2 text-xs outline-none transition-colors ${
                            item.status === 'No Cumple' && !item.observation 
                              ? 'border-red-300 dark:border-red-500/50 focus:border-red-500' 
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
                          placeholder="¿Qué sugiere el equipo para solucionar esta no conformidad?"
                          className="w-full bg-white dark:bg-zinc-900 border border-indigo-100 dark:border-indigo-900/30 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500 resize-none h-20"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                onClick={handleSave}
                disabled={loading || !isComplete || saved || (auditData.items.some(i => i.status === 'No Cumple' && !i.observation))}
                className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                  saved 
                    ? 'bg-emerald-500 text-white' 
                    : isComplete 
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:scale-105' 
                      : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
                }`}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Auditoría Guardada' : 'Finalizar y Generar Plan de Acción'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Button({ children, className, ...props }: any) {
  return (
    <button
      className={`transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
