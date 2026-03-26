import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, MapPin, Tag, Loader2, Shield, Activity, Zap, Sparkles, Camera } from 'lucide-react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';
import { generateActionPlan, analyzeSafetyImage } from '../../services/geminiService';

interface AddFindingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddFindingModal({ isOpen, onClose }: AddFindingModalProps) {
  const [loading, setLoading] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [generateAIPlan, setGenerateAIPlan] = useState(true);
  const { addNode, addConnection } = useZettelkasten();
  const { selectedProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
      console.error('Error analyzing image:', error);
      alert('Error al analizar la imagen con IA.');
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
      console.error('Error adding finding:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-transparent sticky top-0 z-10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white uppercase tracking-tight">Nuevo Hallazgo</h3>
                  <p className="text-xs text-zinc-500 font-medium">Registrar observación o no conformidad</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <div className="p-6 border-b border-white/5 bg-zinc-800/50">
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
                    <p className="text-xs font-bold text-amber-500 uppercase tracking-widest text-center">Analizando imagen con IA...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-amber-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-amber-500 uppercase tracking-widest">Inspección Visual IA</p>
                      <p className="text-[10px] text-zinc-400 mt-1">Sube o toma una foto para autocompletar el hallazgo</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Título del Hallazgo</label>
                <input
                  required
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej: Falta de señalética en zona de carga"
                  className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Severidad</label>
                  <select
                    value={formData.severity}
                    onChange={e => setFormData({ ...formData, severity: e.target.value })}
                    className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  >
                    <option>Baja</option>
                    <option>Media</option>
                    <option>Alta</option>
                    <option>Crítica</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Categoría</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  >
                    <option>Seguridad</option>
                    <option>Salud</option>
                    <option>Higiene</option>
                    <option>Ergonomía</option>
                    <option>Ambiental</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Ubicación / Área</label>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    required
                    type="text"
                    value={formData.location}
                    onChange={e => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Ej: Bodega Central, Sector B"
                    className="w-full bg-zinc-800 border border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Descripción Detallada</label>
                <textarea
                  required
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe lo observado y el riesgo potencial..."
                  rows={5}
                  className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Etiquetas (separadas por coma)</label>
                <div className="relative">
                  <Tag className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    value={formData.tags}
                    onChange={e => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="epp, señaletica, riesgo-caida"
                    className="w-full bg-zinc-800 border border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">Plan de Acción IA</p>
                    <p className="text-[8px] text-zinc-500 font-medium">Generar tareas correctivas automáticamente</p>
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

              <button
                type="submit"
                disabled={loading || isAnalyzingImage}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 uppercase tracking-widest text-xs mt-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    Registrar Hallazgo
                  </>
                )}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
