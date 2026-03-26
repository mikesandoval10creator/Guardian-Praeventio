import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { generateTrainingRecommendations } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { ZettelkastenNode, NodeType } from '../../types';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useZettelkasten } from '../../hooks/useZettelkasten';

interface TrainingRecommendationsProps {
  worker: ZettelkastenNode;
}

interface Recommendation {
  title: string;
  description: string;
  priority: 'Alta' | 'Media' | 'Baja';
}

export function TrainingRecommendations({ worker }: TrainingRecommendationsProps) {
  const [loading, setLoading] = useState(false);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const { nodes } = useUniversalKnowledge();
  const { addNode } = useZettelkasten();

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      // Get context from Zettelkasten: risks and history connected to this worker
      const connectedNodes = nodes.filter(n => 
        worker.connections?.includes(n.id) || 
        n.connections?.includes(worker.id)
      );

      const context = connectedNodes
        .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
        .join('\n');

      const result = await generateTrainingRecommendations(
        worker.title,
        worker.metadata?.role || 'Trabajador',
        context || 'Sin historial previo en el sistema.'
      );
      setRecommendations(result);
    } catch (error) {
      console.error('Error fetching training recommendations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, [worker.id]);

  const handleAssign = async (rec: Recommendation, index: number) => {
    if (!worker.projectId) return;
    setAssigningIndex(index);
    try {
      // Save to Firestore
      const trainingRef = await addDoc(collection(db, `projects/${worker.projectId}/trainings`), {
        projectId: worker.projectId,
        workerId: worker.id,
        workerName: worker.title,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        status: 'assigned',
        createdAt: serverTimestamp()
      });

      // Save to Zettelkasten
      await addNode({
        type: NodeType.TRAINING,
        title: `Capacitación: ${rec.title}`,
        description: `Asignada a ${worker.title}. ${rec.description}`,
        tags: ['capacitacion', 'ia', rec.priority.toLowerCase()],
        projectId: worker.projectId,
        connections: [worker.id],
        metadata: {
          trainingId: trainingRef.id,
          workerId: worker.id,
          priority: rec.priority,
          status: 'pending'
        }
      });

      // Remove the assigned recommendation from the list
      setRecommendations(prev => prev.filter((_, i) => i !== index));
    } catch (error) {
      console.error('Error assigning training:', error);
    } finally {
      setAssigningIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Capacitaciones Sugeridas</h3>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Análisis IA de Brechas de Seguridad</p>
          </div>
        </div>
        <button 
          onClick={fetchRecommendations}
          disabled={loading}
          className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500 hover:text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        </button>
      </header>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest animate-pulse">Analizando perfil del trabajador...</p>
        </div>
      ) : recommendations.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {recommendations.map((rec, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-4 bg-zinc-900/50 border border-white/5 rounded-2xl hover:border-indigo-500/30 transition-all group"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <h4 className="font-bold text-white group-hover:text-indigo-400 transition-colors">{rec.title}</h4>
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                  rec.priority === 'Alta' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' :
                  rec.priority === 'Media' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                  'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                }`}>
                  Prioridad {rec.priority}
                </span>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">{rec.description}</p>
              <div className="mt-4 flex items-center justify-end">
                <button 
                  onClick={() => handleAssign(rec, i)}
                  disabled={assigningIndex === i}
                  className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-400 transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  {assigningIndex === i ? (
                    <>Asignando... <Loader2 className="w-3 h-3 animate-spin" /></>
                  ) : (
                    <>Asignar Curso <CheckCircle2 className="w-3 h-3" /></>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center space-y-4 bg-zinc-900/30 rounded-3xl border border-dashed border-white/5">
          <AlertCircle className="w-8 h-8 text-zinc-700 mx-auto" />
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">No se pudieron generar recomendaciones.</p>
        </div>
      )}
    </div>
  );
}
