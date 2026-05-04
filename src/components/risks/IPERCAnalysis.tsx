import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzeRiskWithAI, generateActionPlan } from '../../services/geminiService';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType, RiskNode } from '../../types';
import { Shield, Zap, AlertTriangle, CheckCircle2, Loader2, Save, Plus, BrainCircuit, ListChecks, WifiOff, Camera } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { withGlossary } from '../shared/withGlossary';
import { logger } from '../../utils/logger';
import { calculateIper, type IperInput } from '../../services/protocols/iper';
import { recordIperAssessment } from '../../services/safety/iperAssessments';
import { IPERCMatrix, LEVEL_TO_CRITICIDAD } from './IPERCMatrix';

interface AiAdvice {
  recomendaciones: string[];
  controles: string[];
  normativa: string;
}

interface IPERCAnalysisProps {
  onClose?: () => void;
}

const GlossaryText = withGlossary(({ text }: { text: string }) => <span>{text}</span>);

const INDUSTRY_PREFILL: Record<string, string> = {
  'minería': 'Trabajo en altura física sobre 1.8m en andamios móviles, exposición a polvo en suspensión y ruido continuo >85dB.',
  'construcción': 'Excavación de zanjas profundas (>1.5m) con maquinaria pesada en operación cercana. Riesgo de derrumbe.',
  'agricultura': 'Aplicación de plaguicidas organofosforados con bomba de espalda. Exposición dérmica e inhalatoria.',
};
const DEFAULT_PREFILL = 'Manejo manual de cargas pesadas (>25kg) con posturas forzadas y movimientos repetitivos.';

export function IPERCAnalysis(_props: IPERCAnalysisProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  // P×S drive `calculateIper`; the matrix is the only legal classifier
  // (SUSESO DS 40 + ACHS). LLM flow only suggests controls.
  const [probability, setProbability] = useState<IperInput['probability']>(3);
  const [severity, setSeverity] = useState<IperInput['severity']>(3);
  const [controlEffectiveness, setControlEffectiveness] = useState<NonNullable<IperInput['controlEffectiveness']>>('none');
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<AiAdvice | null>(null);
  const [saved, setSaved] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [actionPlan, setActionPlan] = useState<any[] | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addNode, addConnection } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes: allNodes } = useUniversalKnowledge();
  const isOnline = useOnlineStatus();

  // R18(R5): mount timestamp → `durationMin` → `safety.iper.matrix.classified` audit
  // → aggregator → `stats.safeHours`.
  const [openedAtMs] = useState<number>(() => Date.now());

  // Deterministic IPER level computed live from P×S inputs.
  const iperResult = useMemo(() => {
    try {
      return calculateIper({ probability, severity, controlEffectiveness });
    } catch (err) {
      logger.warn('iper_calc_failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [probability, severity, controlEffectiveness]);

  const criticidad = iperResult ? LEVEL_TO_CRITICIDAD[iperResult.level] : null;

  // Pre-fill logic based on industry (El Navegante Asistente)
  useEffect(() => {
    if (selectedProject?.industry && !description) {
      const key = selectedProject.industry.toLowerCase();
      setDescription(INDUSTRY_PREFILL[key] ?? DEFAULT_PREFILL);
    }
  }, [selectedProject?.industry]);

  const nodesContext = useMemo(() => {
    return allNodes
      .filter(n => n.type === NodeType.RISK)
      .map(n => `- ${n.title}: ${n.description} (Criticidad: ${n.metadata?.criticidad})`)
      .join('\n');
  }, [allNodes]);

  // LLM suggests controls + normativa only. Its `criticidad` field is discarded;
  // the deterministic matrix level is passed in as prompt context.
  const handleSuggestControls = async () => {
    if (!description.trim() || !iperResult) return;
    setLoadingAi(true);
    setAiAdvice(null);
    setSaved(false);
    setActionPlan(null);
    setError(null);
    try {
      const data = await analyzeRiskWithAI(
        `${description}\n\nClasificación IPER (matriz P=${probability}, S=${severity}): ${iperResult.level}.`,
        nodesContext,
        selectedProject?.industry,
      );
      setAiAdvice({
        recomendaciones: Array.isArray(data?.recomendaciones) ? data.recomendaciones : [],
        controles: Array.isArray(data?.controles) ? data.controles : [],
        normativa: typeof data?.normativa === 'string' ? data.normativa : '',
      });
    } catch (err) {
      logger.error('Error analyzing risk', err);
      setError(t('iperc.error_ai', 'No se pudieron generar sugerencias con IA. La clasificación IPER ya está disponible.'));
    } finally {
      setLoadingAi(false);
    }
  };

  const handleGenerateActionPlan = async () => {
    if (!iperResult || !description) return;
    setGeneratingPlan(true);
    try {
      const plan = await generateActionPlan(description, criticidad ?? 'media');
      setActionPlan(plan);
    } catch (err) {
      logger.error('Error generating action plan', err);
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSaveToMatrix = async () => {
    if (!iperResult || !description) return;
    if (!user) {
      setError(t('iperc.error_login', 'Debes iniciar sesión para guardar la evaluación.'));
      return;
    }
    if (!selectedProject?.id) {
      setError(t('iperc.error_no_project', 'Seleccioná un proyecto antes de guardar la evaluación IPER.'));
      return;
    }
    setLoadingAi(true);
    setError(null);

    try {
      const projectId = selectedProject.id;
      const aiControls = aiAdvice?.controles ?? [];
      const aiRecomendaciones = aiAdvice?.recomendaciones ?? [];
      const aiNormativa = aiAdvice?.normativa ?? '';

      // 0. Persist deterministic IPER assessment — legally-binding per Ley 16.744 +
      // ISO 45001 §7.5.3. AI controls stored as suggestions, not classifications.
      const durationMin = Math.max(1, Math.ceil((Date.now() - openedAtMs) / 60_000));

      const persisted = await recordIperAssessment({
        description,
        projectId,
        inputs: { probability, severity, controlEffectiveness },
        level: iperResult.level,
        rawScore: iperResult.rawScore,
        recommendation: iperResult.recommendation,
        suggestedControls: aiControls,
        computedAt: new Date().toISOString(),
        authorUid: user.uid,
        durationMin,
      });

      // 1. Create Risk Node mirror in the knowledge graph.
      const riskNodeData = {
        type: NodeType.RISK,
        title: `Riesgo: ${description.slice(0, 30)}...`,
        description: `Análisis de riesgo para: ${description}\n\nClasificación IPER (matriz P=${probability}, S=${severity}): ${iperResult.level}\nRecomendación: ${iperResult.recommendation}${aiNormativa ? `\nNormativa: ${aiNormativa}` : ''}`,
        tags: ['IPERC', 'IPER', iperResult.level, criticidad ?? 'media'],
        metadata: {
          criticidad,
          iperLevel: iperResult.level,
          iperRawScore: iperResult.rawScore,
          probability,
          severity,
          controlEffectiveness,
          recomendaciones: aiRecomendaciones,
          controles: aiControls,
          controlesSource: aiControls.length > 0 ? 'gemini-suggestion' : 'none',
          normativa: aiNormativa,
          originalDescription: description,
          actionPlan,
          assessmentId: persisted.id,
          status: 'pending_approval',
          auditTrail: [{
            timestamp: new Date().toISOString(),
            action: 'CREATE',
            user: user.email ?? 'Sistema Guardián',
            details: `Análisis IPERC clasificado por matriz determinística (level=${iperResult.level}); controles sugeridos por IA.`,
            hash: crypto.randomUUID(),
          }],
        },
        connections: [],
        projectId,
      };

      const riskNode = await addNode(riskNodeData);
      if (!riskNode) throw new Error('Failed to create risk node');

      // Create Task Nodes if action plan exists
      if (actionPlan) {
        for (const task of actionPlan) {
          const taskNode = await addNode({
            type: NodeType.TASK,
            title: task.title,
            description: task.description,
            tags: ['Acción Correctiva', task.priority],
            projectId,
            connections: [riskNode.id],
            metadata: {
              priority: task.priority,
              deadline: task.deadline,
              status: 'pending',
            },
          });
          if (taskNode) {
            await addConnection(riskNode.id, taskNode.id);
          }
        }
      }

      // 2. Create Normative Node (only if AI returned a normativa string).
      let normativeNode: RiskNode | null = null;
      if (aiNormativa) {
        const normativeNodeData = {
          type: NodeType.NORMATIVE,
          title: aiNormativa.split(':')[0] || 'Normativa Aplicable',
          description: aiNormativa,
          tags: ['Legal', 'Chile', 'Seguridad'],
          metadata: { fullText: aiNormativa },
          connections: [],
          projectId,
        };
        normativeNode = await addNode(normativeNodeData);
      }

      // 3. Create EPP Nodes (for each AI-suggested control that looks like an EPP).
      const eppKeywords = ['casco', 'guantes', 'botas', 'lentes', 'arnés', 'protector', 'mascarilla', 'epp'];
      const eppNodes: RiskNode[] = [];

      for (const control of aiControls) {
        const isEPP = eppKeywords.some((k) => String(control || '').toLowerCase().includes(k));
        if (isEPP) {
          const eppNode = await addNode({
            type: NodeType.EPP,
            title: control.slice(0, 40),
            description: control,
            tags: ['Protección', 'EPP'],
            metadata: { source: 'IPERC AI suggestion' },
            connections: [],
            projectId,
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
    } catch (err) {
      logger.error('Error saving nodes', err);
      setError(err instanceof Error ? err.message : t('iperc.error_save', 'No se pudo guardar la matriz IPER.'));
    } finally {
      setLoadingAi(false);
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
          {t('iperc.task_description', 'Descripción de la Tarea o Peligro')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('iperc.task_placeholder', 'Ej: Trabajos en altura sobre 1.8m en andamios móviles...')}
          className="w-full h-32 p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
        />

        {similarRisks.length > 0 && (
          <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-2">
              <BrainCircuit className="w-4 h-4" />
              {t('iperc.similar_knowledge', 'Conocimiento Similar en la Red Neuronal')}
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

        <IPERCMatrix
          probability={probability}
          severity={severity}
          controlEffectiveness={controlEffectiveness}
          onProbabilityChange={setProbability}
          onSeverityChange={setSeverity}
          onControlEffectivenessChange={setControlEffectiveness}
          iperResult={iperResult}
          criticidad={criticidad}
        />

        <div className="flex gap-2">
          <button
            onClick={() => setIsCameraActive(!isCameraActive)}
            className={`p-3 rounded-xl border transition-colors flex items-center justify-center ${
              isCameraActive
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-500'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
            title={t('iperc.capture_environment', 'Capturar Entorno')}
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            onClick={handleSuggestControls}
            disabled={loadingAi || !description.trim() || !isOnline}
            className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
              !isOnline
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
                : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-5 h-5" />
                <span>{t('iperc.requires_connection', 'Requiere Conexión')}</span>
              </>
            ) : loadingAi ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('iperc.suggesting_controls', 'Sugiriendo controles...')}</span>
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                <span>{t('iperc.suggest_with_ai', 'Sugerir controles con IA')}</span>
              </>
            )}
          </button>
        </div>

        {isCameraActive && (
          <div className="relative w-full h-48 bg-black rounded-xl overflow-hidden border border-zinc-800">
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-zinc-500 text-sm">{t('iperc.camera_active', 'Cámara Activa (Simulación)')}</p>
            </div>
            <div className="absolute inset-0 border-2 border-emerald-500/50 rounded-xl pointer-events-none"></div>
            <div className="absolute top-2 right-2 bg-black/50 px-2 py-1 rounded text-[10px] text-emerald-500 font-mono">
              REC
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {iperResult && (
          <div className="flex items-center justify-end">
            <button
              onClick={handleSaveToMatrix}
              disabled={saved || loadingAi}
              className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all ${
                saved
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-white/10 disabled:opacity-50'
              }`}
            >
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('iperc.sent_review', 'Enviado a Revisión')}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{t('iperc.save_to_matrix', 'Guardar IPER en la Matriz')}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {aiAdvice && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <BrainCircuit className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {t('iperc.ai_disclaimer', 'Sugerencias de la IA. La clasificación legal del riesgo (nivel IPER) la determina la matriz P×S, no este modelo.')}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <Shield className="w-4 h-4" />
                {t('iperc.controls_suggested', 'Controles Sugeridos por IA')}
              </h4>
              <div className="space-y-2">
                {aiAdvice.controles.map((control, i) => (
                  <div key={i} className="p-3 bg-zinc-800/30 rounded-xl text-sm text-zinc-300 leading-relaxed border-l-2 border-emerald-500">
                    <GlossaryText text={control} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <Plus className="w-4 h-4" />
                {t('iperc.recommendations', 'Recomendaciones')}
              </h4>
              <div className="space-y-2">
                {aiAdvice.recomendaciones.map((rec, i) => (
                  <div key={i} className="p-3 bg-zinc-800/30 rounded-xl text-sm text-zinc-300 leading-relaxed border-l-2 border-blue-500">
                    <GlossaryText text={rec} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {aiAdvice.normativa && (
            <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2 flex items-center gap-2">
                {t('iperc.applicable_regulation', 'Normativa Aplicable (Chile)')}
              </h4>
              <p className="text-sm text-blue-200 leading-relaxed">
                <GlossaryText text={aiAdvice.normativa} />
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 ml-1">
                <ListChecks className="w-4 h-4" />
                {t('iperc.action_plan', 'Plan de Acción IA')}
              </h4>
              {!actionPlan && (
                <button
                  onClick={handleGenerateActionPlan}
                  disabled={generatingPlan || !isOnline}
                  className={`bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors border border-zinc-200 dark:border-white/10 ${!isOnline ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {!isOnline ? <WifiOff className="w-4 h-4" /> : generatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {!isOnline ? t('iperc.offline', 'Offline') : t('iperc.generate_tasks', 'Generar Tareas')}
                </button>
              )}
            </div>

            {actionPlan && (
              <div className="grid grid-cols-1 gap-3">
                {actionPlan.map((task, i) => (
                  <div key={i} className="p-4 bg-zinc-800/50 border border-white/5 rounded-xl flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <h5 className="text-sm font-bold text-zinc-900 dark:text-white">{task.title}</h5>
                      <p className="text-xs text-zinc-400 leading-relaxed">{task.description}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${
                          task.priority === 'high' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' :
                          task.priority === 'medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' :
                          'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                        }`}>
                          {t('iperc.priority_label', 'Prioridad')}: {task.priority}
                        </span>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                          {t('iperc.deadline_label', 'Plazo')}: {task.deadline}
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
