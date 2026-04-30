import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Calendar, User, Loader2, Shield, ChevronRight, ChevronLeft, BarChart3 } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';

interface AddPsychosocialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RESPONSE_OPTIONS = ['Nunca', 'Pocas veces', 'Algunas veces', 'Muchas veces', 'Siempre'];

const DIMENSIONS = [
  {
    id: 'exigencias',
    label: 'Exigencias Psicológicas',
    color: 'rose',
    items: [
      '¿Tiene que trabajar muy rápido?',
      '¿La distribución de tareas es irregular y provoca que se le acumule el trabajo?',
      '¿Le cuesta olvidar los problemas del trabajo?',
      '¿Su trabajo requiere que esconda sus emociones?',
    ],
    reversed: false,
  },
  {
    id: 'trabajo_activo',
    label: 'Trabajo Activo y Desarrollo',
    color: 'blue',
    items: [
      '¿Tiene influencia sobre la cantidad de trabajo que le asignan?',
      '¿Su trabajo le permite aplicar sus habilidades y conocimientos?',
      '¿Tiene influencia sobre cómo realiza su trabajo?',
      '¿Tiene influencia sobre las decisiones que afectan su trabajo?',
    ],
    reversed: true,
  },
  {
    id: 'apoyo_social',
    label: 'Apoyo Social y Liderazgo',
    color: 'indigo',
    items: [
      '¿Sabe con exactitud qué margen de autonomía tiene en su trabajo?',
      '¿Recibe ayuda y apoyo de su jefe o superior inmediato?',
      '¿Su jefe inmediato resuelve bien los conflictos?',
      '¿Se distribuye bien el trabajo en su equipo?',
    ],
    reversed: true,
  },
  {
    id: 'compensaciones',
    label: 'Compensaciones',
    color: 'amber',
    items: [
      '¿Está preocupado por si le despiden o no le renuevan el contrato?',
      '¿Está preocupado por si le cambian el turno u horario?',
      '¿Está contento con el prestigio y estima que le dan en su trabajo?',
      '¿La empresa le trata con el respeto que merece?',
    ],
    reversed: false,
  },
  {
    id: 'doble_presencia',
    label: 'Doble Presencia',
    color: 'purple',
    items: [
      'Cuando está en el trabajo, ¿piensa en las exigencias domésticas y familiares?',
      '¿Hay situaciones en que tendría que estar en el trabajo y en casa a la vez?',
      '¿Siente que el trabajo le consume tanta energía que perjudica sus tareas domésticas?',
      '¿Siente que el trabajo le ocupa tanto tiempo que perjudica sus tareas domésticas?',
    ],
    reversed: false,
  },
];

type Scores = Record<string, number[]>;

function scoreToRisk(score: number): 'low' | 'medium' | 'high' {
  if (score <= 5) return 'low';
  if (score <= 10) return 'medium';
  return 'high';
}

function worstRisk(risks: ('low' | 'medium' | 'high')[]): 'low' | 'medium' | 'high' {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

const RISK_LABEL: Record<string, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-rose-400',
};
const DIM_COLOR: Record<string, string> = {
  rose: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  indigo: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

export function AddPsychosocialModal({ isOpen, onClose }: AddPsychosocialModalProps) {
  const [loading, setLoading] = useState(false);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const [step, setStep] = useState<'meta' | number | 'summary'>('meta');
  const [meta, setMeta] = useState({ title: '', department: '', date: new Date().toISOString().split('T')[0] });
  const [scores, setScores] = useState<Scores>(() =>
    Object.fromEntries(DIMENSIONS.map(d => [d.id, Array(4).fill(-1)]))
  );

  const dimScores = useMemo(() =>
    DIMENSIONS.map(dim => {
      const raw = scores[dim.id];
      const total = raw.reduce((sum, v) => sum + (v === -1 ? 0 : dim.reversed ? 4 - v : v), 0);
      return { id: dim.id, label: dim.label, color: dim.color, score: total, risk: scoreToRisk(total) };
    }), [scores]);

  const globalRisk = useMemo(() => worstRisk(dimScores.map(d => d.risk)), [dimScores]);

  const currentDimIndex = typeof step === 'number' ? step : -1;
  const currentDim = currentDimIndex >= 0 ? DIMENSIONS[currentDimIndex] : null;
  const currentDimScores = currentDim ? scores[currentDim.id] : [];

  const isDimComplete = (dimId: string) => scores[dimId].every(v => v >= 0);
  const allComplete = DIMENSIONS.every(d => isDimComplete(d.id));

  const setItemScore = (itemIdx: number, value: number) => {
    if (!currentDim) return;
    setScores(prev => ({
      ...prev,
      [currentDim.id]: prev[currentDim.id].map((v, i) => i === itemIdx ? value : v),
    }));
  };

  const handleSubmit = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const dimensionResults = dimScores.map(d => ({ id: d.id, label: d.label, score: d.score, risk: d.risk }));
      await addNode({
        type: NodeType.PSYCHOSOCIAL,
        title: meta.title,
        description: `Evaluación ISTAS21 — ${meta.department}. Dimensión más afectada: ${dimScores.sort((a,b) => b.score - a.score)[0].label}.`,
        tags: ['ISTAS21', meta.department, `riesgo-${globalRisk}`],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          department: meta.department,
          date: meta.date,
          riskLevel: globalRisk,
          dimensionScores: dimensionResults,
          status: 'Completada',
          createdAt: new Date().toISOString(),
        },
      });
      handleClose();
    } catch (error) {
      console.error('Error saving ISTAS21 evaluation:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('meta');
    setMeta({ title: '', department: '', date: new Date().toISOString().split('T')[0] });
    setScores(Object.fromEntries(DIMENSIONS.map(d => [d.id, Array(4).fill(-1)])));
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div onClick={handleClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-rose-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-500">
                  <Brain className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Nueva Evaluación ISTAS21</h2>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-widest">
                    {step === 'meta' ? 'Datos de identificación' :
                     step === 'summary' ? 'Resultados' :
                     `Dimensión ${(step as number) + 1}/5`}
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-zinc-800 shrink-0">
              <motion.div
                className="h-full bg-rose-500"
                animate={{ width: step === 'meta' ? '10%' : step === 'summary' ? '100%' : `${((step as number) + 1) / 5 * 90 + 10}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
              {/* Step: Meta */}
              {step === 'meta' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Título</label>
                    <input
                      type="text"
                      required
                      value={meta.title}
                      onChange={e => setMeta(p => ({ ...p, title: e.target.value }))}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 px-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                      placeholder="Ej: Evaluación ISTAS21 — Operaciones Q2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Departamento</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="text"
                          required
                          value={meta.department}
                          onChange={e => setMeta(p => ({ ...p, department: e.target.value }))}
                          className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-9 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                          placeholder="Operaciones"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Fecha</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="date"
                          required
                          value={meta.date}
                          onChange={e => setMeta(p => ({ ...p, date: e.target.value }))}
                          className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-9 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      El cuestionario SUSESO/ISTAS21 evalúa 5 dimensiones de riesgo psicosocial con 4 preguntas cada una (20 ítems en total). El nivel de riesgo se calcula automáticamente.
                    </p>
                  </div>
                </div>
              )}

              {/* Step: Dimension questions */}
              {typeof step === 'number' && currentDim && (
                <div className="space-y-4">
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold ${DIM_COLOR[currentDim.color]}`}>
                    <BarChart3 className="w-3.5 h-3.5" />
                    {currentDim.label}
                  </div>
                  {currentDim.items.map((item, idx) => (
                    <div key={idx} className="space-y-2">
                      <p className="text-xs text-zinc-300 leading-relaxed">{idx + 1}. {item}</p>
                      <div className="grid grid-cols-5 gap-1">
                        {RESPONSE_OPTIONS.map((label, val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setItemScore(idx, val)}
                            className={`py-2 px-1 rounded-lg text-[10px] font-bold text-center transition-all ${
                              currentDimScores[idx] === val
                                ? 'bg-rose-500 text-white'
                                : 'bg-zinc-800/50 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Step: Summary */}
              {step === 'summary' && (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl border text-center ${globalRisk === 'high' ? 'bg-rose-500/10 border-rose-500/30' : globalRisk === 'medium' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                    <p className="text-xs text-zinc-400 mb-1">Nivel de Riesgo Global</p>
                    <p className={`text-2xl font-black uppercase ${RISK_COLOR[globalRisk]}`}>{RISK_LABEL[globalRisk]}</p>
                  </div>
                  <div className="space-y-2">
                    {dimScores.map(d => (
                      <div key={d.id} className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/50 border border-white/5">
                        <span className="text-xs text-zinc-300">{d.label}</span>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${d.risk === 'high' ? 'bg-rose-500' : d.risk === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(d.score / 16) * 100}%` }} />
                          </div>
                          <span className={`text-[10px] font-black uppercase w-12 text-right ${RISK_COLOR[d.risk]}`}>{RISK_LABEL[d.risk]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div className="p-5 border-t border-white/5 flex gap-3 shrink-0">
              {step !== 'meta' && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 'summary') setStep(DIMENSIONS.length - 1);
                    else if (step === 0) setStep('meta');
                    else setStep((step as number) - 1);
                  }}
                  className="px-4 py-3 rounded-xl font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </button>
              )}
              <button
                type="button"
                disabled={
                  (step === 'meta' && (!meta.title.trim() || !meta.department.trim())) ||
                  (typeof step === 'number' && !isDimComplete(DIMENSIONS[step].id)) ||
                  (step === 'summary' && loading)
                }
                onClick={() => {
                  if (step === 'meta') setStep(0);
                  else if (typeof step === 'number') {
                    if (step < DIMENSIONS.length - 1) setStep(step + 1);
                    else setStep('summary');
                  } else {
                    handleSubmit();
                  }
                }}
                className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-rose-500 hover:bg-rose-600 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {step === 'summary' ? (
                  <><Shield className="w-4 h-4" /> Guardar Evaluación</>
                ) : (
                  <>Continuar <ChevronRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
