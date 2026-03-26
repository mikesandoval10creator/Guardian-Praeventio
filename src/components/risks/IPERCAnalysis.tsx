import { useState, useCallback, useMemo } from 'react';
import { analyzeRiskWithAI, generateActionPlan } from '../../services/geminiService';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, ZettelkastenNode } from '../../types';
import { Shield, Zap, AlertTriangle, CheckCircle2, Loader2, Save, Plus, BrainCircuit, ListChecks } from 'lucide-react';
import { Card, Button } from '../shared/Card';

interface AnalysisResult {
  criticidad: string;
  recomendaciones: string[];
  controles: string[];
  normativa: string;
}

interface IPERCAnalysisProps {
  onClose?: () => void;
}

export function IPERCAnalysis({ onClose }: IPERCAnalysisProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [actionPlan, setActionPlan] = useState<any[] | null>(null);
  const { addNode, addConnection } = useZettelkasten();
  const { selectedProject } = useProject();
  const { nodes: allNodes } = useUniversalKnowledge();

  const nodesContext = useMemo(() => {
    return allNodes
      .filter(n => n.type === NodeType.RISK)
      .map(n => `- ${n.title}: ${n.description} (Criticidad: ${n.metadata?.criticidad})`)
      .join('\n');
  }, [allNodes]);

  const handleAnalyze = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setResult(null);
    setSaved(false);
    setActionPlan(null);
    try {
      const data = await analyzeRiskWithAI(description, nodesContext);
      setResult(data);
    } catch (error) {
      console.error('Error analyzing risk:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateActionPlan = async () => {
    if (!result || !description) return;
    setGeneratingPlan(true);
    try {
      const plan = await generateActionPlan(description, result.criticidad);
      setActionPlan(plan);
    } catch (error) {
      console.error('Error generating action plan:', error);
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSaveToZettelkasten = async () => {
    if (!result || !description) return;
    setLoading(true);
    
    try {
      const projectId = selectedProject?.id;

      // 1. Create Risk Node
      const riskNodeData = {
        type: NodeType.RISK,
        title: `Riesgo: ${description.slice(0, 30)}...`,
        description: `Análisis de riesgo para: ${description}\n\nCriticidad: ${result.criticidad}\nNormativa: ${result.normativa}`,
        tags: ['IPERC', 'IA', result.criticidad],
        metadata: {
          criticidad: result.criticidad,
          recomendaciones: result.recomendaciones,
          controles: result.controles,
          normativa: result.normativa,
          originalDescription: description,
          actionPlan: actionPlan,
          status: 'pending_approval'
        },
        connections: [],
        projectId: projectId
      };

      const riskNode = await addNode(riskNodeData);
      if (!riskNode) throw new Error("Failed to create risk node");

      // Create Task Nodes if action plan exists
      if (actionPlan) {
        for (const task of actionPlan) {
          const taskNode = await addNode({
            type: NodeType.TASK,
            title: task.title,
            description: task.description,
            tags: ['Acción Correctiva', task.priority],
            projectId: projectId,
            connections: [riskNode.id],
            metadata: {
              priority: task.priority,
              deadline: task.deadline,
              status: 'pending'
            }
          });
          if (taskNode) {
            await addConnection(riskNode.id, taskNode.id);
          }
        }
      }

      // 2. Create Normative Node
      const normativeNodeData = {
        type: NodeType.NORMATIVE,
        title: result.normativa.split(':')[0] || 'Normativa Aplicable',
        description: result.normativa,
        tags: ['Legal', 'Chile', 'Seguridad'],
        metadata: { fullText: result.normativa },
        connections: [],
        projectId: projectId
      };
      const normativeNode = await addNode(normativeNodeData);

      // 3. Create EPP Nodes (for each control that looks like an EPP)
      const eppKeywords = ['casco', 'guantes', 'botas', 'lentes', 'arnés', 'protector', 'mascarilla', 'epp'];
      const eppNodes: ZettelkastenNode[] = [];

      for (const control of result.controles) {
        const isEPP = eppKeywords.some(k => control.toLowerCase().includes(k));
        if (isEPP) {
          const eppNode = await addNode({
            type: NodeType.EPP,
            title: control.slice(0, 40),
            description: control,
            tags: ['Protección', 'EPP'],
            metadata: { source: 'IPERC AI' },
            connections: [],
            projectId: projectId
          });
          if (eppNode) eppNodes.push(eppNode);
        }
      }

      // 4. Create Sinapses (Connections)
      if (normativeNode) {
        await addConnection(riskNode.id, normativeNode.id);
      }

      for (const epp of eppNodes) {
        await addConnection(riskNode.id, epp.id);
      }

      setSaved(true);
    } catch (error) {
      console.error('Error saving nodes:', error);
    } finally {
      setLoading(false);
    }
  };

  const similarRisks = useMemo(() => {
    if (!description.trim()) return [];
    const terms = description.toLowerCase().split(' ');
    return allNodes
      .filter(n => n.type === NodeType.RISK)
      .filter(n => terms.some(t => t.length > 3 && n.title.toLowerCase().includes(t)))
      .slice(0, 3);
  }, [allNodes, description]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
          Descripción de la Tarea o Peligro
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej: Trabajos en altura sobre 1.8m en andamios móviles..."
          className="w-full h-32 p-4 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-100 dark:border-zinc-700 rounded-3xl text-sm outline-none focus:border-emerald-500 transition-colors resize-none"
        />

        {similarRisks.length > 0 && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-800/30 space-y-3">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-2">
              <BrainCircuit className="w-3 h-3" />
              Conocimiento Similar en la Red Neuronal
            </h4>
            <div className="space-y-3">
              {similarRisks.map((risk) => (
                <div key={risk.id} className="space-y-2">
                  <div className="px-2 py-1 bg-white dark:bg-zinc-800 rounded-lg text-[10px] font-bold text-zinc-600 border border-amber-200 dark:border-amber-800/50 inline-block">
                    {risk.title}
                  </div>
                  {risk.metadata?.controles && (
                    <div className="flex flex-wrap gap-1">
                      {risk.metadata.controles.slice(0, 2).map((c: string, i: number) => (
                        <span key={i} className="text-[9px] text-amber-700 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/40 px-2 py-0.5 rounded-md">
                          • {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          onClick={handleAnalyze}
          disabled={loading || !description.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analizando con IA...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Generar Matriz IPERC
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800 rounded-2xl border border-zinc-100 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${
                result.criticidad === 'Crítica' ? 'bg-red-100 text-red-600' :
                result.criticidad === 'Alta' ? 'bg-orange-100 text-orange-600' :
                'bg-emerald-100 text-emerald-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Criticidad</span>
                <span className="text-sm font-black uppercase">{result.criticidad}</span>
              </div>
            </div>
            <Button
              onClick={handleSaveToZettelkasten}
              disabled={saved}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                saved ? 'bg-amber-100 text-amber-600' : 'bg-zinc-900 text-white hover:bg-black'
              }`}
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Enviado a Revisión
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  Sugerir a la Matriz
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <Shield className="w-3 h-3" />
                Controles Sugeridos
              </h4>
              <div className="space-y-2">
                {result.controles.map((control, i) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl text-[11px] leading-relaxed border-l-4 border-emerald-500">
                    {control}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <Plus className="w-3 h-3" />
                Recomendaciones
              </h4>
              <div className="space-y-2">
                {result.recomendaciones.map((rec, i) => (
                  <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl text-[11px] leading-relaxed border-l-4 border-blue-500">
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2">
              Normativa Aplicable (Chile)
            </h4>
            <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed font-medium">
              {result.normativa}
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                <ListChecks className="w-3 h-3" />
                Plan de Acción IA
              </h4>
              {!actionPlan && (
                <Button
                  onClick={handleGenerateActionPlan}
                  disabled={generatingPlan}
                  className="bg-zinc-800 text-white hover:bg-zinc-700 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-2"
                >
                  {generatingPlan ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Generar Tareas
                </Button>
              )}
            </div>

            {actionPlan && (
              <div className="grid grid-cols-1 gap-3">
                {actionPlan.map((task, i) => (
                  <div key={i} className="p-4 bg-zinc-800/50 border border-white/5 rounded-2xl flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h5 className="text-[11px] font-black text-white uppercase tracking-tight">{task.title}</h5>
                      <p className="text-[10px] text-zinc-400 leading-relaxed">{task.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${
                          task.priority === 'high' ? 'bg-red-500/10 text-red-500' :
                          task.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-blue-500/10 text-blue-500'
                        }`}>
                          Prioridad: {task.priority}
                        </span>
                        <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">
                          Plazo: {task.deadline}
                        </span>
                      </div>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
