import { useState } from 'react';
import { generatePersonalizedSafetyPlan } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, ZettelkastenNode } from '../../types';
import { BrainCircuit, Loader2, ShieldCheck, Zap, AlertCircle, Heart, Save } from 'lucide-react';
import { Button } from '../shared/Card';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useZettelkasten } from '../../hooks/useZettelkasten';

interface PersonalizedSafetyPlanProps {
  worker: ZettelkastenNode;
}

export function PersonalizedSafetyPlan({ worker }: PersonalizedSafetyPlanProps) {
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const { nodes } = useUniversalKnowledge();
  const { addNode } = useZettelkasten();

  const handleGenerate = async () => {
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

      // Save to Zettelkasten
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
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto">
            <BrainCircuit className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Plan de Seguridad Personalizado</h3>
            <p className="text-sm text-zinc-500 max-w-xs mx-auto">
              Genera un plan de acción basado en el rol, historial y riesgos actuales de {worker.title}.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2 mx-auto"
          >
            {loading ? (
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
          <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800/30 flex items-center gap-4">
            <div className="w-12 h-12 bg-white dark:bg-zinc-800 rounded-xl flex items-center justify-center shadow-sm">
              <Heart className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Mensaje del Guardián</p>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 italic">"{plan.mensajeMotivador}"</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" />
                Recomendaciones por Rol
              </h4>
              <div className="space-y-2">
                {plan.recomendacionesRol.map((item: string, i: number) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl text-[11px] leading-relaxed border-l-4 border-emerald-500">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <AlertCircle className="w-3 h-3" />
                Medidas Críticas
              </h4>
              <div className="space-y-2">
                {plan.medidasCriticas.map((item: string, i: number) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl text-[11px] leading-relaxed border-l-4 border-rose-500">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">
              Refuerzo de Capacitación
            </h4>
            <ul className="space-y-1">
              {plan.refuerzoCapacitacion.map((item: string, i: number) => (
                <li key={i} className="text-[11px] text-blue-800 dark:text-blue-300 flex items-center gap-2">
                  <div className="w-1 h-1 bg-blue-400 rounded-full" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4">
            <Button
              onClick={() => setPlan(null)}
              variant="outline"
              className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest"
            >
              Descartar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              {isSaving ? (
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
