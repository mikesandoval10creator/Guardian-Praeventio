import React, { useState } from 'react';
import { ClipboardCheck, Plus, Trash2, Save, Loader2, CheckCircle2, Wand2 } from 'lucide-react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { generateActionPlan } from '../../services/geminiService';
import { motion, AnimatePresence } from 'framer-motion';

interface InspectionItem {
  id: string;
  question: string;
  status: 'Cumple' | 'No Cumple' | 'N/A';
  observation: string;
}

export function SafetyInspection() {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<InspectionItem[]>([
    { id: '1', question: '¿El personal utiliza su EPP completo?', status: 'Cumple', observation: '' },
    { id: '2', question: '¿Las herramientas están en buen estado?', status: 'Cumple', observation: '' },
    { id: '3', question: '¿El área de trabajo está limpia y ordenada?', status: 'Cumple', observation: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const { addNode, addConnection } = useZettelkasten();
  const { selectedProject } = useProject();

  const handleAddItem = () => {
    setItems([...items, { id: Date.now().toString(), question: '', status: 'Cumple', observation: '' }]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleUpdateItem = (id: string, updates: Partial<InspectionItem>) => {
    setItems(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleSave = async () => {
    if (!title) return;
    setLoading(true);
    try {
      // 1. Create Inspection Node
      const inspectionNode = await addNode({
        type: NodeType.AUDIT,
        title: `Inspección: ${title}`,
        description: `Resultados de inspección de seguridad.\n\n${items.map(i => `- ${i.question}: ${i.status} (${i.observation})`).join('\n')}`,
        tags: ['Inspección', 'Seguridad', 'Terreno'],
        metadata: { items, status: 'Completado' },
        projectId: selectedProject?.id,
        connections: []
      });

      if (!inspectionNode) throw new Error("Failed to create inspection node");

      // 2. Generate Action Plans for "No Cumple" items
      const nonCompliantItems = items.filter(i => i.status === 'No Cumple');
      if (nonCompliantItems.length > 0) {
        const context = nonCompliantItems.map(i => `${i.question}: ${i.observation}`).join('\n');
        const plan = await generateActionPlan(context);

        for (const task of plan.tareas) {
          const taskNode = await addNode({
            type: NodeType.TASK,
            title: task.titulo,
            description: task.descripcion,
            tags: ['Acción Correctiva', task.prioridad],
            metadata: {
              status: 'Pendiente',
              priority: task.prioridad,
              deadline: new Date(Date.now() + task.plazoDias * 24 * 60 * 60 * 1000).toISOString(),
              source: 'Inspección AI'
            },
            projectId: selectedProject?.id,
            connections: []
          });

          if (taskNode) {
            await addConnection(inspectionNode.id, taskNode.id);
          }
        }
      }

      setSaved(true);
    } catch (error) {
      console.error('Error saving inspection:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-6 space-y-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white">Nueva Inspección de Seguridad</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Generación Automática de Acciones Correctivas</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={loading || !title || saved}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
            saved ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-900 text-white hover:bg-black'
          }`}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <CheckCircle2 className="w-3 h-3" /> : <Save className="w-3 h-3" />}
          {saved ? 'Guardado' : 'Finalizar Inspección'}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Título de la Inspección / Área</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej: Inspección de Bodega Central - Piso 1"
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Checklist de Verificación</label>
            <button
              onClick={handleAddItem}
              className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Agregar Item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-2xl border border-zinc-100 dark:border-zinc-700 space-y-3">
                <div className="flex items-start gap-4">
                  <input
                    type="text"
                    value={item.question}
                    onChange={(e) => handleUpdateItem(item.id, { question: e.target.value })}
                    placeholder="Pregunta de inspección..."
                    className="flex-1 bg-transparent border-none p-0 text-sm font-bold text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:ring-0"
                  />
                  <div className="flex bg-white dark:bg-zinc-900 rounded-lg p-1 border border-zinc-100 dark:border-zinc-700">
                    {(['Cumple', 'No Cumple', 'N/A'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleUpdateItem(item.id, { status: s })}
                        className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                          item.status === s
                            ? s === 'Cumple' ? 'bg-emerald-500 text-white' : s === 'No Cumple' ? 'bg-red-500 text-white' : 'bg-zinc-500 text-white'
                            : 'text-zinc-400 hover:text-zinc-600'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {item.status === 'No Cumple' && (
                  <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={item.observation}
                        onChange={(e) => handleUpdateItem(item.id, { observation: e.target.value })}
                        placeholder="Describe la desviación observada..."
                        className="w-full bg-white dark:bg-zinc-900 border border-red-100 dark:border-red-900/30 rounded-lg px-3 py-2 text-xs outline-none focus:border-red-500"
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[8px] font-black text-red-500 uppercase tracking-widest">
                      <Wand2 className="w-3 h-3" />
                      Plan IA Activo
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Button({ children, className, ...props }: any) {
  return (
    <button
      className={`transition-all active:scale-95 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
