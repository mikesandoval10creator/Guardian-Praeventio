import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, 
  Brain, 
  Play, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  Lightbulb,
  Shield,
  Zap,
  Loader2
} from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { generateSafetyCapsule } from '../../services/geminiService';

export function SafetyCapsules() {
  const { nodes } = useUniversalKnowledge();
  const { user } = useFirebase();
  const [capsule, setCapsule] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const workerContext = useMemo(() => {
    if (!user) return '';
    // Get nodes connected to the user or relevant to their role/project
    return nodes
      .filter(n => n.connections?.includes(user.uid) || n.projectId)
      .slice(0, 15)
      .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
      .join('\n');
  }, [nodes, user]);

  const handleGenerate = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await generateSafetyCapsule(
        user.displayName || 'Trabajador',
        'Operador', // Default role
        workerContext
      );
      setCapsule(result);
    } catch (error) {
      console.error('Error generating capsule:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && nodes.length > 0 && !capsule) {
      handleGenerate();
    }
  }, [user, nodes]);

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
            <Lightbulb className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">Cápsulas de Seguridad</h3>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Micro-entrenamiento Personalizado IA</p>
          </div>
        </div>
        <button 
          onClick={handleGenerate}
          disabled={loading}
          className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500 hover:text-white"
        >
          <Zap className={`w-5 h-5 ${loading ? 'animate-pulse text-amber-500' : ''}`} />
        </button>
      </header>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-12 flex flex-col items-center gap-4"
          >
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest animate-pulse">Destilando conocimiento...</p>
          </motion.div>
        ) : capsule ? (
          <motion.div
            key="capsule"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="p-6 bg-gradient-to-br from-amber-500/10 to-transparent rounded-2xl border border-amber-500/20">
              <div className="flex items-center justify-between mb-4">
                <span className="px-2 py-0.5 bg-amber-500 text-black text-[8px] font-black uppercase tracking-widest rounded">Nuevo para ti</span>
                <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
                  <Clock className="w-3 h-3" />
                  <span>{capsule.duration}</span>
                </div>
              </div>
              <h4 className="text-2xl font-black text-white uppercase tracking-tighter mb-4 leading-tight">
                {capsule.title}
              </h4>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6 italic">
                "{capsule.content}"
              </p>
              <div className="flex items-center gap-4">
                <button className="flex-1 bg-white text-black py-3 rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-amber-400 transition-all active:scale-95">
                  <Play className="w-4 h-4 fill-current" />
                  Escuchar Cápsula
                </button>
                <button className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                  <CheckCircle2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 bg-black/20 rounded-2xl border border-white/5 flex items-start gap-4">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tip Clave del Guardián</p>
                <p className="text-xs text-white font-medium">{capsule.keyTip}</p>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="pt-4 border-t border-white/5">
        <button className="w-full flex items-center justify-between text-zinc-500 hover:text-white transition-colors group">
          <span className="text-[10px] font-black uppercase tracking-widest">Ver historial de cápsulas</span>
          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </section>
  );
}
