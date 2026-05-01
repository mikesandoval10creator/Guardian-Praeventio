import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Stethoscope, Brain, Clock, AlertTriangle, ShieldCheck,
  FileText, Loader2, ChevronDown, ChevronUp, Hospital, Image as ImageIcon, Sparkles
} from 'lucide-react';
import { analyzeMedicalInjury, generateMedicalIllustration } from '../../services/geminiService';
import { BodyRegion } from './HumanBodyViewer';

interface MedicalAnalysis {
  anatomicalSystems: string[];
  specialistRequired: string;
  immediateActions: string[];
  ds594References: string[];
  diatCodes: string[];
  estimatedRecovery: string;
  workRestrictions: string[];
  severity: 'leve' | 'moderado' | 'grave' | 'crítico';
  requiresHospitalization: boolean;
}

interface MedicalAnalyzerProps {
  regions: BodyRegion[];
}

const SEVERITY_COLORS = {
  leve:    { bg: 'bg-green-500/10',  text: 'text-green-600 dark:text-green-400',  border: 'border-green-500/20'  },
  moderado:{ bg: 'bg-amber-500/10',  text: 'text-amber-600 dark:text-amber-400',  border: 'border-amber-500/20'  },
  grave:   { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  crítico: { bg: 'bg-rose-500/10',   text: 'text-rose-600 dark:text-rose-400',     border: 'border-rose-500/20'   },
};

export function MedicalAnalyzer({ regions }: MedicalAnalyzerProps) {
  const [analysis, setAnalysis] = useState<MedicalAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [illustration, setIllustration] = useState<string | null>(null);
  const [illustrationLoading, setIllustrationLoading] = useState(false);
  const [illustrationError, setIllustrationError] = useState<string | null>(null);

  const injuredRegions = regions.filter(r => r.severity !== null);

  const runAnalysis = async () => {
    if (injuredRegions.length === 0) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setIllustration(null);
    try {
      const result = await analyzeMedicalInjury(
        injuredRegions.map(r => ({
          id: r.id,
          label: r.label,
          severity: r.severity,
          ds594Article: r.ds594Article,
        }))
      );
      if (result?.error) throw new Error(result.error);
      setAnalysis(result as MedicalAnalysis);
      setExpanded(true);
    } catch (err: any) {
      setError(err?.message ?? 'Error al analizar las lesiones.');
    } finally {
      setLoading(false);
    }
  };

  const runIllustration = async () => {
    if (injuredRegions.length === 0) return;
    setIllustrationLoading(true);
    setIllustrationError(null);
    try {
      const result = await generateMedicalIllustration(
        injuredRegions.map(r => ({ id: r.id, label: r.label, severity: r.severity })),
        analysis?.specialistRequired,
      );
      if (result?.error) throw new Error(result.error);
      if (result?.imageBase64) {
        setIllustration(`data:${result.mimeType ?? 'image/png'};base64,${result.imageBase64}`);
      } else {
        throw new Error('Respuesta sin imagen');
      }
    } catch (err: any) {
      setIllustrationError(err?.message ?? 'Error generando ilustración.');
    } finally {
      setIllustrationLoading(false);
    }
  };

  if (injuredRegions.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 p-5 text-center">
        <Stethoscope className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-2" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Selecciona zonas lesionadas en el visor corporal para obtener análisis médico IA.
        </p>
      </div>
    );
  }

  const sevCfg = analysis ? (SEVERITY_COLORS[analysis.severity] ?? SEVERITY_COLORS.leve) : null;

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200/50 dark:border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10">
            <Brain className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
          </div>
          <div>
            <p className="text-sm font-black text-zinc-900 dark:text-white">Análisis Médico IA</p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {injuredRegions.length} zona{injuredRegions.length !== 1 ? 's' : ''} seleccionada{injuredRegions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {analysis && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
          </button>
        )}
      </div>

      {/* Trigger */}
      {!analysis && (
        <div className="p-5">
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#4db6ac] hover:bg-[#3a9e95] disabled:opacity-60 text-white text-xs font-black uppercase tracking-widest transition-all"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Analizando lesiones...</>
            ) : (
              <><Stethoscope className="w-4 h-4" />Analizar con IA Médica</>
            )}
          </button>
          {error && (
            <p className="mt-3 text-xs text-rose-500 text-center">{error}</p>
          )}
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {analysis && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-5 space-y-4">
              {/* Severity badge + hospitalization warning */}
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${sevCfg!.bg} ${sevCfg!.text} ${sevCfg!.border}`}>
                  {analysis.severity}
                </span>
                {analysis.requiresHospitalization && (
                  <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    <Hospital className="w-3 h-3" />
                    Hospitalización
                  </span>
                )}
              </div>

              {/* Specialist */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-[#4db6ac]/5 dark:bg-[#d4af37]/5 border border-[#4db6ac]/10 dark:border-[#d4af37]/10">
                <Stethoscope className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-0.5">Especialista recomendado</p>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">{analysis.specialistRequired}</p>
                </div>
              </div>

              {/* Anatomical systems */}
              {analysis.anatomicalSystems.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">Sistemas anatómicos afectados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.anatomicalSystems.map(s => (
                      <span key={s} className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-300">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Immediate actions */}
              {analysis.immediateActions.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />Primeros auxilios
                  </p>
                  <ul className="space-y-1.5">
                    {analysis.immediateActions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recovery + restrictions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />Recuperación
                  </p>
                  <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{analysis.estimatedRecovery}</p>
                </div>
                {analysis.workRestrictions.length > 0 && (
                  <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />Restricciones
                    </p>
                    <ul className="space-y-0.5">
                      {analysis.workRestrictions.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400">• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* DS 594 + DIAT */}
              {(analysis.ds594References.length > 0 || analysis.diatCodes.length > 0) && (
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <FileText className="w-3 h-3" />Referencias normativas
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.ds594References.map(r => (
                      <span key={r} className="px-2 py-0.5 rounded bg-[#4db6ac]/10 text-[#2a8a81] dark:text-[#4db6ac] text-[10px] font-bold border border-[#4db6ac]/20">{r}</span>
                    ))}
                    {analysis.diatCodes.map(c => (
                      <span key={c} className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-bold border border-violet-500/20">DIAT {c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Medical illustration (Gemini-generated) */}
              <div className="border-t border-zinc-200/50 dark:border-white/5 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                    <ImageIcon className="w-3 h-3" />Ilustración Anatómica IA
                  </p>
                  {!illustration && !illustrationLoading && (
                    <button
                      onClick={runIllustration}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] text-[10px] font-black uppercase tracking-wider border border-[#4db6ac]/20 dark:border-[#d4af37]/20 hover:bg-[#4db6ac]/20 dark:hover:bg-[#d4af37]/20 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />Generar
                    </button>
                  )}
                </div>
                {illustrationLoading && (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                    <Loader2 className="w-6 h-6 animate-spin text-[#4db6ac] dark:text-[#d4af37]" />
                    <p className="text-xs text-zinc-500">Gemini generando ilustración médica...</p>
                  </div>
                )}
                {illustrationError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <p className="text-xs text-rose-600 dark:text-rose-400">{illustrationError}</p>
                  </div>
                )}
                {illustration && (
                  <div className="relative rounded-xl overflow-hidden bg-white border border-zinc-200/50 dark:border-white/5">
                    <img src={illustration} alt="Ilustración anatómica generada por IA" className="w-full h-auto" />
                    <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-zinc-900/80 text-[9px] font-black uppercase tracking-widest text-white flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-[#d4af37]" />Gemini
                    </div>
                  </div>
                )}
              </div>

              {/* Re-analyze */}
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-200/50 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Recalcular análisis
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
