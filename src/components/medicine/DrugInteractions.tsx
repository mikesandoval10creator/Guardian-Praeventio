import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Pill, Plus, X, AlertTriangle, AlertCircle, CheckCircle,
  Loader2, Info, Sparkles, ShieldAlert
} from 'lucide-react';
import { checkDrugInteractions } from '../../services/geminiService';
import { MedicalIcon } from '../medical/MedicalIcon';

interface InteractionResult {
  drugs: string[];
  interactions: Array<{
    drugs: [string, string];
    severity: 'leve' | 'moderada' | 'grave' | 'contraindicado';
    mechanism: string;
    clinicalEffect: string;
    recommendation: string;
    atcCodes?: string[];
  }>;
  generalWarnings?: string[];
  safeToAdminister?: boolean;
  summary?: string;
}

const SEVERITY_CONFIG = {
  leve: { label: 'Leve', color: 'text-[#4db6ac]', bg: 'bg-[#4db6ac]/10 border-[#4db6ac]/20', icon: Info },
  moderada: { label: 'Moderada', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', icon: AlertCircle },
  grave: { label: 'Grave', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', icon: AlertTriangle },
  contraindicado: { label: 'Contraindicado', color: 'text-red-600', bg: 'bg-red-600/10 border-red-600/30', icon: ShieldAlert },
};

const EXAMPLE_DRUGS = ['Ibuprofeno', 'Atenolol', 'Metformina', 'Omeprazol', 'Paracetamol', 'Aspirina'];

export function DrugInteractions() {
  const [drugInput, setDrugInput] = useState('');
  const [drugs, setDrugs] = useState<string[]>([]);
  const [patientContext, setPatientContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InteractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addDrug = (name?: string) => {
    const v = (name ?? drugInput).trim();
    if (!v || drugs.includes(v)) return;
    setDrugs(prev => [...prev, v]);
    setDrugInput('');
    setResult(null);
  };

  const removeDrug = (d: string) => {
    setDrugs(prev => prev.filter(x => x !== d));
    setResult(null);
  };

  const analyze = async () => {
    if (drugs.length < 2) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const raw = await checkDrugInteractions(drugs, patientContext || undefined);
      if (raw?.error) throw new Error(raw.error);
      const parsed: InteractionResult = typeof raw === 'string' ? JSON.parse(raw) : (raw?.result ?? raw);
      setResult({ ...parsed, drugs });
    } catch (err: any) {
      setError(err?.message ?? 'Error al analizar interacciones');
    } finally {
      setLoading(false);
    }
  };

  const highestSeverity = result?.interactions?.reduce<keyof typeof SEVERITY_CONFIG | null>((max, i) => {
    const order = ['leve', 'moderada', 'grave', 'contraindicado'] as const;
    if (!max) return i.severity;
    return order.indexOf(i.severity) > order.indexOf(max) ? i.severity : max;
  }, null);

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10">
          <Pill className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">Interacciones Farmacológicas IA</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Análisis clínico por Gemini — ATC codes · mecanismo · recomendación</p>
        </div>
        {/* Sprint 17c — Bioicons pharma glyphs (pill / syringe / IV bag). */}
        <div className="hidden sm:flex items-center gap-1.5 text-[#2a8a81] dark:text-[#d4af37]" aria-hidden="true">
          <MedicalIcon name="pill" size={20} alt="Pastilla" />
          <MedicalIcon name="syringe" size={20} alt="Inyectable" />
          <MedicalIcon name="iv-bag" size={20} alt="Suero IV" />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 uppercase">
          Gemini IA
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Drug input */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">Medicamentos a analizar</p>
          <div className="flex gap-2">
            <input
              value={drugInput}
              onChange={e => setDrugInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDrug(); } }}
              placeholder="Ej: Ibuprofeno, Enalapril…"
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40 dark:focus:ring-[#d4af37]/40"
            />
            <button
              type="button"
              onClick={() => addDrug()}
              disabled={!drugInput.trim()}
              className="px-4 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 hover:bg-[#4db6ac]/20 dark:hover:bg-[#d4af37]/20 transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Quick-add examples */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLE_DRUGS.filter(d => !drugs.includes(d)).map(d => (
              <button
                key={d}
                onClick={() => addDrug(d)}
                className="px-2.5 py-1 rounded-lg text-[9px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 hover:bg-zinc-200 dark:hover:bg-zinc-700/50 transition-colors"
              >
                + {d}
              </button>
            ))}
          </div>

          {/* Added drugs */}
          {drugs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {drugs.map(d => (
                <span key={d} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 border border-[#4db6ac]/20 dark:border-[#d4af37]/20 text-[#2a8a81] dark:text-[#d4af37] text-xs font-bold">
                  <Pill className="w-3 h-3" />
                  {d}
                  <button onClick={() => removeDrug(d)} className="hover:text-rose-500 transition-colors ml-1">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Patient context */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">Contexto del paciente (opcional)</p>
          <input
            value={patientContext}
            onChange={e => setPatientContext(e.target.value)}
            placeholder="Ej: 65 años, insuficiencia renal leve, embarazo 2T…"
            className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/40 dark:focus:ring-[#d4af37]/40"
          />
        </div>

        {/* Analyze button */}
        <button
          onClick={analyze}
          disabled={drugs.length < 2 || loading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#4db6ac] hover:bg-[#3a9e95] dark:bg-[#d4af37]/80 dark:hover:bg-[#d4af37] text-white dark:text-zinc-900 text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-[#4db6ac]/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Analizando interacciones…' : `Analizar ${drugs.length < 2 ? '(mín. 2 fármacos)' : `${drugs.length} fármacos`}`}
        </button>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
            {error}
          </div>
        )}

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              {/* Safe-to-administer banner */}
              {result.safeToAdminister !== undefined && (
                <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                  result.safeToAdminister
                    ? 'bg-[#4db6ac]/10 border-[#4db6ac]/20'
                    : 'bg-rose-500/10 border-rose-500/20'
                }`}>
                  {result.safeToAdminister
                    ? <CheckCircle className="w-5 h-5 text-[#4db6ac] flex-shrink-0" />
                    : <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />}
                  <p className={`text-sm font-bold ${result.safeToAdminister ? 'text-[#2a8a81] dark:text-[#4db6ac]' : 'text-rose-600 dark:text-rose-400'}`}>
                    {result.safeToAdminister ? 'Combinación generalmente segura con precauciones' : 'Se detectaron interacciones significativas — revisar con especialista'}
                  </p>
                </div>
              )}

              {/* Summary */}
              {result.summary && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed bg-zinc-50 dark:bg-zinc-800/30 p-3 rounded-xl border border-zinc-200 dark:border-white/5">
                  {result.summary}
                </p>
              )}

              {/* Interactions */}
              {result.interactions?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                    {result.interactions.length} interacción{result.interactions.length !== 1 ? 'es' : ''} detectada{result.interactions.length !== 1 ? 's' : ''}
                  </p>
                  {result.interactions.map((inter, i) => {
                    const sev = SEVERITY_CONFIG[inter.severity] ?? SEVERITY_CONFIG.leve;
                    const SevIcon = sev.icon;
                    return (
                      <div key={i} className={`rounded-xl border p-3 space-y-2 ${sev.bg}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <SevIcon className={`w-4 h-4 ${sev.color} flex-shrink-0`} />
                            <span className={`text-xs font-black ${sev.color}`}>
                              {inter.drugs[0]} ↔ {inter.drugs[1]}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${sev.bg} ${sev.color}`}>
                            {sev.label}
                          </span>
                        </div>
                        {inter.mechanism && (
                          <p className="text-[10px] text-zinc-600 dark:text-zinc-400">
                            <span className="font-bold">Mecanismo: </span>{inter.mechanism}
                          </p>
                        )}
                        {inter.clinicalEffect && (
                          <p className="text-[10px] text-zinc-600 dark:text-zinc-400">
                            <span className="font-bold">Efecto clínico: </span>{inter.clinicalEffect}
                          </p>
                        )}
                        {inter.recommendation && (
                          <p className={`text-[10px] font-bold ${sev.color}`}>
                            ▶ {inter.recommendation}
                          </p>
                        )}
                        {inter.atcCodes && inter.atcCodes.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {inter.atcCodes.map(c => (
                              <span key={c} className="px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-700/60 text-[9px] font-mono text-zinc-600 dark:text-zinc-400">{c}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* General warnings */}
              {result.generalWarnings && result.generalWarnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Advertencias generales</p>
                  {result.generalWarnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-amber-700 dark:text-amber-300 flex gap-1.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{w}
                    </p>
                  ))}
                </div>
              )}

              <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
                <Info className="w-3 h-3" />
                Análisis orientativo — siempre verificar con Vademécum oficial (ISP Chile)
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
