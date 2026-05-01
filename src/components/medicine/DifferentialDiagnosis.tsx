import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Loader2, AlertTriangle, FileText, Stethoscope,
  ShieldAlert, ChevronRight, Sparkles, FlaskConical,
} from 'lucide-react';
import { differentialDiagnosis } from '../../services/geminiService';

interface DiagnosisItem {
  condition: string;
  icd10: string;
  probability: 'alta' | 'media' | 'baja';
  rationale: string;
}

interface DiagnosisResult {
  differentialDiagnosis: DiagnosisItem[];
  occupationalRelevance: string;
  recommendedExams: string[];
  recommendedSurveillance: string;
  redFlags: string[];
  suggestedTreatment: string;
  diatRequired: boolean;
  specialistReferral: string | null;
}

const PROB_COLORS = {
  alta: { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' },
  media: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  baja: { bg: 'bg-zinc-500/10', text: 'text-zinc-600 dark:text-zinc-400', border: 'border-zinc-500/30' },
};

export function DifferentialDiagnosis() {
  const [symptoms, setSymptoms] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'O' | ''>('');
  const [occupation, setOccupation] = useState('');
  const [exposures, setExposures] = useState('');
  const [vitals, setVitals] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptoms.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await differentialDiagnosis({
        symptoms: symptoms.trim(),
        age: age ? parseInt(age, 10) : undefined,
        sex: sex || undefined,
        occupation: occupation.trim() || undefined,
        exposures: exposures.trim() || undefined,
        vitals: vitals.trim() || undefined,
      });
      if (res?.error) throw new Error(res.error);
      setResult(res as DiagnosisResult);
    } catch (err: any) {
      setError(err?.message ?? 'Error en análisis IA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10">
          <Brain className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">Diagnóstico Diferencial IA</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Gemini · CIE-10 + Ley 16.744 + DS 594</p>
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 uppercase">
          Médico
        </span>
      </div>

      <form onSubmit={submit} className="p-5 space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5">
            Síntomas / Motivo de consulta *
          </label>
          <textarea
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="Ej: tos persistente con expectoración hace 3 semanas, disnea de esfuerzo, dolor torácico ocasional"
            rows={3}
            required
            className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40 resize-none"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Edad</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="42"
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Sexo</label>
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value as 'M' | 'F' | 'O' | '')}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40"
            >
              <option value="">—</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="O">Otro</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Ocupación</label>
            <input
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              placeholder="Soldador, minero subterráneo, operador grúa…"
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Exposiciones laborales</label>
            <input
              value={exposures}
              onChange={(e) => setExposures(e.target.value)}
              placeholder="Sílice, ruido >85dB, vibración, asbesto…"
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Signos vitales</label>
            <input
              value={vitals}
              onChange={(e) => setVitals(e.target.value)}
              placeholder="PA 130/85, FC 88, SpO2 95%, T° 37.2"
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !symptoms.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#4db6ac] hover:bg-[#3a9e95] disabled:opacity-60 text-white text-xs font-black uppercase tracking-widest transition-all"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Analizando con IA…</>
          ) : (
            <><Sparkles className="w-4 h-4" />Generar diagnóstico diferencial</>
          )}
        </button>

        {error && <p className="text-xs text-rose-500 text-center">{error}</p>}
      </form>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-5 space-y-4 border-t border-zinc-200/50 dark:border-white/5">
              {/* Red flags */}
              {result.redFlags.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />Señales de alarma
                  </p>
                  <ul className="space-y-1">
                    {result.redFlags.map((f, i) => (
                      <li key={i} className="text-xs text-rose-700 dark:text-rose-300">• {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Differential dx list */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">Diagnósticos diferenciales</p>
                <div className="space-y-2">
                  {result.differentialDiagnosis.map((d, i) => {
                    const cfg = PROB_COLORS[d.probability] ?? PROB_COLORS.baja;
                    return (
                      <div key={i} className={`p-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-black text-zinc-900 dark:text-white">{d.condition}</p>
                              <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[9px] font-black tracking-widest border border-violet-500/20">
                                {d.icd10}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                                Prob. {d.probability}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5">{d.rationale}</p>
                          </div>
                          <ChevronRight className={`w-4 h-4 ${cfg.text} shrink-0`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Occupational relevance */}
                <div className="p-3 rounded-xl bg-[#4db6ac]/5 dark:bg-[#d4af37]/5 border border-[#4db6ac]/20 dark:border-[#d4af37]/20">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#2a8a81] dark:text-[#d4af37] mb-1.5 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />Enfermedad profesional
                  </p>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300">{result.occupationalRelevance}</p>
                  {result.diatRequired && (
                    <span className="inline-block mt-2 px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[9px] font-black tracking-widest border border-rose-500/20">
                      DIAT/DIEP REQUERIDO
                    </span>
                  )}
                </div>

                {/* Surveillance program */}
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                    <FlaskConical className="w-3 h-3" />Programa de vigilancia
                  </p>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">{result.recommendedSurveillance}</p>
                </div>
              </div>

              {/* Exams */}
              {result.recommendedExams.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1">
                    <FileText className="w-3 h-3" />Exámenes recomendados
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.recommendedExams.map((e, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-300">{e}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Treatment */}
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                  <Stethoscope className="w-3 h-3" />Tratamiento sugerido
                </p>
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{result.suggestedTreatment}</p>
                {result.specialistReferral && (
                  <p className="text-[10px] mt-2 text-zinc-500">
                    <strong>Referir a:</strong> {result.specialistReferral}
                  </p>
                )}
              </div>

              <p className="text-[9px] text-zinc-400 text-center italic">
                Análisis IA orientativo — NO sustituye juicio clínico del profesional médico.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
