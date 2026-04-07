import React, { useState } from 'react';
import { calculateStructuralLoad } from '../../services/geminiService';
import { Calculator, Wrench, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

export const StructuralCalculator: React.FC = () => {
  const [element, setElement] = useState('Perno (Ej: ASTM A325)');
  const [specs, setSpecs] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!element || !specs) return;

    setIsLoading(true);
    try {
      const response = await calculateStructuralLoad(element, specs);
      setResult(response);
    } catch (error) {
      console.error(error);
      setResult('Error al calcular. Intente nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
          <Calculator className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Calculadora Estructural y de Carga</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Estima la capacidad de carga segura (SWL) para pernos, eslingas y andamios.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleCalculate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Elemento</label>
              <select
                value={element}
                onChange={(e) => setElement(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
                <option value="Perno (Ej: ASTM A325)">Perno Estructural (Ej: ASTM A325, A490)</option>
                <option value="Eslinga de Izaje">Eslinga de Izaje (Poliéster, Acero)</option>
                <option value="Andamio Tubular">Andamio Tubular / Multidireccional</option>
                <option value="Línea de Vida">Línea de Vida (Cable de acero)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Especificaciones Técnicas</label>
              <textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder="Ej: Diámetro 3/4 pulgada, Grado 8.8, sometido a tracción pura..."
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all h-32 resize-none"
                required
              />
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-200/80 leading-relaxed">
                <strong>Advertencia de Seguridad:</strong> Los resultados generados por esta herramienta son estimaciones teóricas basadas en estándares generales. 
                <strong> NUNCA</strong> deben reemplazar el cálculo y firma de un Ingeniero Estructural certificado.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading || !specs}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Wrench className="w-5 h-5" />
              )}
              {isLoading ? 'Calculando Capacidad...' : 'Calcular Capacidad Segura'}
            </button>
          </form>
        </div>

        {/* Results */}
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6 overflow-y-auto max-h-[500px] custom-scrollbar">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 space-y-4 py-12"
              >
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p>Consultando normativas y fórmulas de ingeniería...</p>
              </motion.div>
            ) : result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="prose dark:prose-invert prose-indigo max-w-none"
              >
                <div className="flex items-center gap-2 mb-4 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10 px-3 py-2 rounded-lg border border-emerald-500/20 dark:border-emerald-400/20 w-fit">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Cálculo Teórico Completado</span>
                </div>
                <div className="markdown-body text-sm">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 py-12"
              >
                <Calculator className="w-12 h-12 opacity-20" />
                <p className="text-center max-w-xs">
                  Ingresa las especificaciones del elemento para calcular su capacidad de carga segura.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
