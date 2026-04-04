import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Loader2, AlertCircle, CheckCircle2, Zap, WifiOff } from 'lucide-react';
import { generateTrainingRecommendations } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { RiskNode, NodeType } from '../../types';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface TrainingRecommendationsProps {
  worker: RiskNode;
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
  const { addNode } = useRiskEngine();
  const isOnline = useOnlineStatus();

  const fetchRecommendations = async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      // Get context from Risk Network: risks and history connected to this worker
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
      if (!isOnline) {
        import('../../utils/pwa-offline').then(async ({ saveForSync }) => {
          await saveForSync({
            type: 'create',
            collection: `projects/${worker.projectId}/trainings`,
            data: {
              projectId: worker.projectId,
              workerId: worker.id,
              workerName: worker.title,
              title: rec.title,
              description: rec.description,
              priority: rec.priority,
              status: 'assigned',
              createdAt: new Date().toISOString(),
              createNode: true,
              nodeData: {
                type: NodeType.TRAINING,
                title: `Capacitación: ${rec.title}`,
                description: `Capacitación asignada a ${worker.title}: ${rec.description}`,
                tags: ['capacitacion', rec.priority, 'asignada'],
                projectId: worker.projectId,
                connections: [worker.id],
                metadata: {
                  workerId: worker.id,
                  priority: rec.priority,
                  status: 'assigned'
                }
              }
            }
          });
          setRecommendations(prev => prev.filter((_, i) => i !== index));
          alert('Asignación guardada para sincronización cuando haya conexión.');
        });
      } else {
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

        // Save to Risk Network
        await addNode({
          type: NodeType.TRAINING,
          title: `Capacitación: ${rec.title}`,
          description: `Asignada a ${worker.title}. ${rec.description}`,
          tags: ['capacitacion', 'ia', String(rec.priority || '').toLowerCase()],
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
      }
    } catch (error) {
      console.error('Error assigning training:', error);
    } finally {
      setAssigningIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-500/5 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-500/10">
        <div>
          <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">Capacitaciones Sugeridas</h3>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest">Análisis IA de Brechas de Seguridad</p>
        </div>
        <button 
          onClick={fetchRecommendations}
          disabled={loading || !isOnline}
          className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50 flex items-center gap-2"
          title={!isOnline ? "Requiere conexión a internet" : "Actualizar recomendaciones"}
        >
          {!isOnline ? <WifiOff className="w-4 h-4" /> : loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
          <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest animate-pulse">Analizando perfil del trabajador...</p>
        </div>
      ) : recommendations.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {recommendations.map((rec, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-4 bg-white dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-2xl hover:border-indigo-500/30 dark:hover:border-indigo-500/30 transition-all group shadow-sm"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <h4 className="font-bold text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{rec.title}</h4>
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${
                  rec.priority === 'Alta' ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-500 border border-rose-200 dark:border-rose-500/20' :
                  rec.priority === 'Media' ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-200 dark:border-amber-500/20' :
                  'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border border-emerald-200 dark:border-emerald-500/20'
                }`}>
                  Prioridad {rec.priority}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{rec.description}</p>
              <div className="mt-4 flex items-center justify-end">
                <button 
                  onClick={() => handleAssign(rec, i)}
                  disabled={assigningIndex === i || !isOnline}
                  className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  title={!isOnline ? "Requiere conexión a internet" : "Asignar curso"}
                >
                  {!isOnline ? (
                    <>Requiere Conexión <WifiOff className="w-3 h-3" /></>
                  ) : assigningIndex === i ? (
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
        <div className="py-12 text-center space-y-4 bg-zinc-50 dark:bg-zinc-800/20 rounded-3xl border border-dashed border-zinc-200 dark:border-white/5">
          <AlertCircle className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mx-auto" />
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">No se pudieron generar recomendaciones.</p>
        </div>
      )}
    </div>
  );
}
