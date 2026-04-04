import { useState } from 'react';
import { generatePersonalizedSafetyPlan } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, RiskNode } from '../../types';
import { BrainCircuit, Loader2, ShieldCheck, Zap, AlertCircle, Heart, Save, WifiOff } from 'lucide-react';
import { Button } from '../shared/Card';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface PersonalizedSafetyPlanProps {
  worker: RiskNode;
}

export function PersonalizedSafetyPlan({ worker }: PersonalizedSafetyPlanProps) {
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const { nodes } = useUniversalKnowledge();
  const { addNode } = useRiskEngine();
  const isOnline = useOnlineStatus();

  const handleGenerate = async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const history = nodes
        .filter(n => n.type === NodeType.TASK || n.type === NodeType.FINDING)
        .filter(n => n.connections?.includes(worker.id))
        .map(n => `- ${n.title}: ${n.description}`)
        .join('\n');

      const projectRisks = nodes
        .filter(n => n.type === NodeType.RISK)
        .filter(n => n.projectId === worker.projectId)
        .map(n => `- ${n.title}: ${n.description}`)
        .join('\n');

      const result = await generatePersonalizedSafetyPlan(
        worker.title,
        worker.metadata?.role || 'Trabajador',
        history || 'Sin historial previo registrado.',
        projectRisks || 'Sin riesgos específicos de proyecto registrados.'
      );
      setPlan(result);
    } catch (error) {
      console.error('Error generating personalized plan:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !worker.projectId) return;
    setIsSaving(true);
    try {
      // Save to Firestore
      const planRef = await addDoc(collection(db, `projects/${worker.projectId}/personalized_plans`), {
        projectId: worker.projectId,
        workerId: worker.id,
        workerName: worker.title,
        plan: plan,
        createdAt: serverTimestamp()
      });

      // Save to Risk Network
      await addNode({
        type: NodeType.DOCUMENT,
        title: `Plan de Seguridad: ${worker.title}`,
        description: `Plan de seguridad personalizado generado por IA para ${worker.title}.`,
        tags: ['plan', 'seguridad', 'ia', 'personalizado'],
        projectId: worker.projectId,
        connections: [worker.id],
        metadata: {
          planId: planRef.id,
          workerId: worker.id,
          documentType: 'personalized_plan',
          content: plan
        }
      });

      setPlan(null); // Reset after saving
    } catch (error) {
      console.error('Error saving personalized plan:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {!plan ? (
        <div className="text-center py-8 space-y-4">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
            <BrainCircuit className="w-8 h-8 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Plan de Seguridad Personalizado</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              Genera un plan de acción basado en el rol, historial y riesgos actuales de {worker.title}.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={loading || !isOnline}
            className={`px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2 mx-auto ${
              !isOnline 
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-4 h-4" />
                Requiere Conexión
              </>
            ) : loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analizando...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Generar Plan IA
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl border border-emerald-100 dark:border-emerald-500/20 flex items-center gap-4">
            <div className="w-12 h-12 bg-white dark:bg-zinc-900 rounded-xl flex items-center justify-center shadow-sm border border-zinc-200 dark:border-white/5 shrink-0">
              <Heart className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest">Mensaje del Guardián</p>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 italic">"{plan.mensajeMotivador}"</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" />
                Recomendaciones por Rol
              </h4>
              <div className="space-y-2">
                {plan.recomendacionesRol.map((item: string, i: number) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed border-l-2 border-emerald-500">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                <AlertCircle className="w-3 h-3" />
                Medidas Críticas
              </h4>
              <div className="space-y-2">
                {plan.medidasCriticas.map((item: string, i: number) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed border-l-2 border-rose-500">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl border border-indigo-100 dark:border-indigo-500/20">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-2">
              Refuerzo de Capacitación
            </h4>
            <ul className="space-y-2">
              {plan.refuerzoCapacitacion.map((item: string, i: number) => (
                <li key={i} className="text-[11px] text-indigo-800 dark:text-indigo-200 flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4 pt-4 border-t border-zinc-200 dark:border-white/5">
            <Button
              onClick={() => setPlan(null)}
              variant="outline"
              className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-transparent border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Descartar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !isOnline}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                !isOnline 
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-4 h-4" />
                  Requiere Conexión
                </>
              ) : isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar Plan
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
