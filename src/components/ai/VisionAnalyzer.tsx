import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, Shield, AlertTriangle, Loader2, X, CheckCircle2, Info, Sparkles, Save } from 'lucide-react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { analyzeVisionImage } from '../../services/geminiService';

interface AnalysisResult {
  eppDetected: string[];
  risksDetected: string[];
  recommendations: string[];
  summary: string;
}

export function VisionAnalyzer() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addNode } = useZettelkasten();
  const { selectedProject } = useProject();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setSaved(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setSaved(false);
    try {
      const base64Image = image.split(',')[1];
      
      const analysis = await analyzeVisionImage(base64Image);
      setResult(analysis);
    } catch (err) {
      console.error('Error analyzing image:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!result || !selectedProject) return;
    setIsSaving(true);
    try {
      await addNode({
        type: NodeType.FINDING,
        title: `Hallazgo IA: ${result.risksDetected[0]?.slice(0, 30) || 'Análisis de Visión'}...`,
        description: `Análisis de visión artificial realizado sobre imagen.\n\nResumen: ${result.summary}\n\nRiesgos: ${result.risksDetected.join(', ')}\n\nEPP: ${result.eppDetected.join(', ')}`,
        tags: ['Visión AI', 'Hallazgo', 'EPP', ...result.eppDetected],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          type: 'Vision Analysis',
          result: result,
          timestamp: new Date().toISOString()
        }
      });
      setSaved(true);
    } catch (error) {
      console.error('Error saving vision finding:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 overflow-hidden">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
          <Camera className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Análisis de Visión AI</h2>
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Detección de EPP y Riesgos en tiempo real</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Section */}
        <div className="space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`aspect-video rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden relative ${
              image ? 'border-emerald-500/50' : 'border-white/10 hover:border-blue-500/50 bg-zinc-800/30'
            }`}
          >
            {image ? (
              <>
                <img src={image || undefined} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <p className="text-white text-sm font-bold">Cambiar Imagen</p>
                </div>
              </>
            ) : (
              <div className="text-center p-6">
                <Upload className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Sube una foto o captura desde la cámara</p>
                <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-widest font-bold">JPG, PNG hasta 10MB</p>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>

          <button
            onClick={analyzeImage}
            disabled={!image || isAnalyzing}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analizando con Gemini...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                <span>Iniciar Análisis AI</span>
              </>
            )}
          </button>
        </div>

        {/* Results Section */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    EPP Detectado
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {result.eppDetected.map((item, i) => (
                      <span key={i} className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-emerald-500/20">
                        {item}
                      </span>
                    ))}
                    {result.eppDetected.length === 0 && <span className="text-zinc-500 text-xs italic">No se detectó EPP</span>}
                  </div>
                </div>

                <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-rose-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Riesgos Identificados
                  </h3>
                  <ul className="space-y-2">
                    {result.risksDetected.map((risk, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                        {risk}
                      </li>
                    ))}
                    {result.risksDetected.length === 0 && <li className="text-zinc-500 text-xs italic">No se detectaron riesgos críticos</li>}
                  </ul>
                </div>

                <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4">
                  <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Recomendaciones
                  </h3>
                  <ul className="space-y-2">
                    {result.recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={handleSave}
                  disabled={isSaving || saved || !selectedProject}
                  className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                    saved 
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                      : 'bg-zinc-800 text-white hover:bg-zinc-700 border border-white/10'
                  }`}
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : saved ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{saved ? 'Guardado en Red Neuronal' : 'Guardar Hallazgo'}</span>
                </button>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/5 rounded-3xl bg-zinc-800/20">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-zinc-600" />
                </div>
                <h3 className="text-white font-bold mb-2">Esperando Análisis</h3>
                <p className="text-xs text-zinc-500 max-w-[200px]">Sube una imagen para que el Guardián AI analice el entorno y detecte elementos de seguridad.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
