import { useState, useCallback, useMemo } from 'react';
import { analyzeRiskWithAI, generateActionPlan } from '../../services/geminiService';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, RiskNode } from '../../types';
import { Shield, Zap, AlertTriangle, CheckCircle2, Loader2, Save, Plus, BrainCircuit, ListChecks, WifiOff } from 'lucide-react';
import { Card, Button } from '../shared/Card';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface AnalysisResult {
  criticidad: string;
  recomendaciones: string[];
  controles: string[];
  normativa: string;
}

interface IPERCAnalysisProps {
  onClose?: () => void;
}

const getCriticalityColor = (criticidad?: string) => {
  switch (String(criticidad || '').toLowerCase()) {
    case 'crítica': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
    case 'alta': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
    case 'media': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'baja': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
  }
};

export function IPERCAnalysis({ onClose }: IPERCAnalysisProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [actionPlan, setActionPlan] = useState<any[] | null>(null);
  const { addNode, addConnection } = useRiskEngine();
  const { selectedProject } = useProject();
  const { nodes: allNodes } = useUniversalKnowledge();
  const isOnline = useOnlineStatus();

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
      const data = await analyzeRiskWithAI(description, nodesContext, selectedProject?.industry);
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

  const handleSaveToMatrix = async () => {
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
      const eppNodes: RiskNode[] = [];

      for (const control of result.controles) {
        const isEPP = eppKeywords.some(k => String(control || '').toLowerCase().includes(k));
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
      .filter(n => terms.some(t => t.length > 3 && (n.title || '').toLowerCase().includes(t)))
      .slice(0, 3);
  }, [allNodes, description]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 ml-1">
          Descripción de la Tarea o Peligro
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej: Trabajos en altura sobre 1.8m en andamios móviles..."
          className="w-full h-32 p-4 bg-zinc-800/50 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
        />

        {similarRisks.length > 0 && (
          <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-2">
              <BrainCircuit className="w-4 h-4" />
              Conocimiento Similar en la Red Neuronal
            </h4>
            <div className="space-y-3">
              {similarRisks.map((risk) => (
                <div key={risk.id} className="space-y-2">
                  <div className="px-2 py-1 bg-zinc-800 rounded-lg text-xs font-medium text-zinc-300 border border-amber-500/30 inline-block">
                    {risk.title}
                  </div>
                  {risk.metadata?.controles && (
                    <div className="flex flex-wrap gap-1.5">
                      {risk.metadata.controles.slice(0, 2).map((c: string, i: number) => (
                        <span key={i} className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20">
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

        <button
          onClick={handleAnalyze}
          disabled={loading || !description.trim() || !isOnline}
          className={`w-full py-3 rounded-xl font-medium text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
            !isOnline 
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
              : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {!isOnline ? (
            <>
              <WifiOff className="w-5 h-5" />
              <span>Requiere Conexión</span>
            </>
          ) : loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Analizando con IA...</span>
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              <span>Generar Matriz IPERC</span>
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-xl border border-white/5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${getCriticalityColor(result.criticidad)}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Criticidad</span>
                <span className="text-sm font-bold text-white uppercase">{result.criticidad}</span>
              </div>
            </div>
            <button
              onClick={handleSaveToMatrix}
              disabled={saved}
              className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all ${
                saved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10'
              }`}
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Enviado a Revisión</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Sugerir a la Matriz</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <Shield className="w-4 h-4" />
                Controles Sugeridos
              </h4>
              <div className="space-y-2">
                {result.controles.map((control, i) => (
                  <div key={i} className="p-3 bg-zinc-800/30 rounded-xl text-sm text-zinc-300 leading-relaxed border-l-2 border-emerald-500">
                    {control}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <Plus className="w-4 h-4" />
                Recomendaciones
              </h4>
              <div className="space-y-2">
                {result.recomendaciones.map((rec, i) => (
                  <div key={i} className="p-3 bg-zinc-800/30 rounded-xl text-sm text-zinc-300 leading-relaxed border-l-2 border-blue-500">
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2 flex items-center gap-2">
              Normativa Aplicable (Chile)
            </h4>
            <p className="text-sm text-blue-200 leading-relaxed">
              {result.normativa}
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <ListChecks className="w-4 h-4" />
                Plan de Acción IA
              </h4>
              {!actionPlan && (
                <button
                  onClick={handleGenerateActionPlan}
                  disabled={generatingPlan || !isOnline}
                  className={`bg-zinc-800 text-white hover:bg-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors border border-white/10 ${!isOnline ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {!isOnline ? <WifiOff className="w-4 h-4" /> : generatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {!isOnline ? 'Offline' : 'Generar Tareas'}
                </button>
              )}
            </div>

            {actionPlan && (
              <div className="grid grid-cols-1 gap-3">
                {actionPlan.map((task, i) => (
                  <div key={i} className="p-4 bg-zinc-800/50 border border-white/5 rounded-xl flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <h5 className="text-sm font-bold text-white">{task.title}</h5>
                      <p className="text-xs text-zinc-400 leading-relaxed">{task.description}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${
                          task.priority === 'high' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' :
                          task.priority === 'medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' :
                          'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                        }`}>
                          Prioridad: {task.priority}
                        </span>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                          Plazo: {task.deadline}
                        </span>
                      </div>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-1" />
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
