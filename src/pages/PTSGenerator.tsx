import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Wand2, Loader2, Save, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { GoogleGenAI, Type } from '@google/genai';

export function PTSGenerator() {
  const { selectedProject } = useProject();
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [normative, setNormative] = useState('DS 594 (Condiciones Sanitarias y Ambientales)');
  const [riskLevel, setRiskLevel] = useState('Medio');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPTS, setGeneratedPTS] = useState<any>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !taskDescription) return;

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: (import.meta as any).env.VITE_GEMINI_API_KEY || '' });
      
      const prompt = `
        Genera un Procedimiento de Trabajo Seguro (PTS) detallado para la siguiente tarea:
        Nombre de la Tarea: ${taskName}
        Descripción: ${taskDescription}
        Nivel de Riesgo Esperado: ${riskLevel}
        Normativa Principal a Cumplir: ${normative}
        
        El PTS debe incluir:
        1. Objetivo
        2. Alcance
        3. Responsabilidades
        4. Equipos de Protección Personal (EPP) requeridos
        5. Riesgos Asociados y Medidas de Control
        6. Paso a paso de la tarea
        
        Asegúrate de que el contenido sea profesional, técnico y cumpla estrictamente con la normativa indicada (${normative}) y sea adecuado para un nivel de riesgo ${riskLevel}.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              objetivo: { type: Type.STRING },
              alcance: { type: Type.STRING },
              responsabilidades: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING } 
              },
              epp: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING } 
              },
              riesgos: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    riesgo: { type: Type.STRING },
                    control: { type: Type.STRING }
                  }
                }
              },
              pasos: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ['objetivo', 'alcance', 'responsabilidades', 'epp', 'riesgos', 'pasos']
          }
        }
      });

      if (response.text) {
        setGeneratedPTS(JSON.parse(response.text));
      }
    } catch (error) {
      console.error('Error generating PTS:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Generador PTS</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Procedimientos de Trabajo Seguro Asistidos por IA
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h2 className="text-lg font-black text-white uppercase tracking-tight mb-6 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500" />
              Datos de la Tarea
            </h2>
            
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Nombre de la Tarea
                </label>
                <input
                  type="text"
                  required
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  placeholder="Ej: Trabajo en Altura - Mantención de Techo"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                  Descripción Detallada
                </label>
                <textarea
                  required
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none h-32"
                  placeholder="Describe los pasos generales, herramientas a usar y el entorno de trabajo..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Nivel de Riesgo
                  </label>
                  <select
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="Bajo">Bajo</option>
                    <option value="Medio">Medio</option>
                    <option value="Alto">Alto</option>
                    <option value="Crítico">Crítico</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Normativa Principal
                  </label>
                  <select
                    value={normative}
                    onChange={(e) => setNormative(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="DS 594 (Condiciones Sanitarias y Ambientales)">DS 594</option>
                    <option value="Ley 16.744 (Accidentes del Trabajo)">Ley 16.744</option>
                    <option value="DS 40 (Prevención de Riesgos)">DS 40</option>
                    <option value="ISO 45001 (Sistemas de Gestión SST)">ISO 45001</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isGenerating || !taskName || !taskDescription}
                className="w-full bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generando PTS...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    Generar con IA
                  </>
                )}
              </button>
            </form>
          </div>
          
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-black text-emerald-500 uppercase tracking-tight mb-2">Nota Importante</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  El PTS generado por IA es un borrador inicial. Debe ser revisado, validado y firmado por un Prevencionista de Riesgos o profesional competente antes de su implementación en terreno.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {generatedPTS ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-8 md:p-12 text-black shadow-2xl relative"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500 rounded-t-3xl" />
              
              <div className="flex justify-between items-start mb-12 border-b border-zinc-200 pb-8">
                <div>
                  <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">Procedimiento de Trabajo Seguro</h2>
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">{taskName}</p>
                </div>
                <div className="flex gap-2">
                  <button className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 hover:text-black transition-colors">
                    <Save className="w-5 h-5" />
                  </button>
                  <button className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors">
                    <Download className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-8">
                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">1</div>
                    Objetivo
                  </h3>
                  <p className="text-zinc-700 leading-relaxed pl-8">{generatedPTS.objetivo}</p>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">2</div>
                    Alcance
                  </h3>
                  <p className="text-zinc-700 leading-relaxed pl-8">{generatedPTS.alcance}</p>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">3</div>
                    Responsabilidades
                  </h3>
                  <ul className="list-disc list-inside text-zinc-700 space-y-2 pl-8">
                    {generatedPTS.responsabilidades.map((resp: string, i: number) => (
                      <li key={i}>{resp}</li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">4</div>
                    Equipos de Protección Personal (EPP)
                  </h3>
                  <div className="flex flex-wrap gap-2 pl-8">
                    {generatedPTS.epp.map((item: string, i: number) => (
                      <span key={i} className="bg-zinc-100 text-zinc-800 px-3 py-1 rounded-lg text-sm font-medium border border-zinc-200">
                        {item}
                      </span>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">5</div>
                    Riesgos y Medidas de Control
                  </h3>
                  <div className="space-y-4 pl-8">
                    {generatedPTS.riesgos.map((item: any, i: number) => (
                      <div key={i} className="bg-zinc-50 rounded-xl p-4 border border-zinc-200">
                        <p className="font-bold text-red-600 mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Riesgo: {item.riesgo}
                        </p>
                        <p className="text-emerald-700 font-medium flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                          Control: {item.control}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">6</div>
                    Paso a Paso
                  </h3>
                  <div className="space-y-4 pl-8">
                    {generatedPTS.pasos.map((paso: string, i: number) => (
                      <div key={i} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold shrink-0">
                          {i + 1}
                        </div>
                        <p className="text-zinc-700 pt-1">{paso}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          ) : (
            <div className="h-full min-h-[600px] bg-zinc-900/30 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center mb-6">
                <FileText className="w-10 h-10 text-zinc-600" />
              </div>
              <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-2">Vista Previa del Documento</h3>
              <p className="text-zinc-500 max-w-md">
                Completa los datos de la tarea y haz clic en "Generar con IA" para crear un Procedimiento de Trabajo Seguro estructurado.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
