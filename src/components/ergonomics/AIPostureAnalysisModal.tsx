import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Upload, Loader2, AlertTriangle, Activity, CheckCircle2, ScanFace, BrainCircuit } from 'lucide-react';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';
import { analyzePostureWithAI } from '../../services/geminiService';

interface AIPostureAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function AIPostureAnalysisModal({ isOpen, onClose, projectId }: AIPostureAnalysisModalProps) {
  const { addNode } = useZettelkasten();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [workstation, setWorkstation] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setImagePreview(base64String);
        
        // Extract base64 data and mime type
        const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          setImageMimeType(matches[1]);
          setImageBase64(matches[2]);
        }
        setAnalysisResult(null); // Reset previous analysis
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!imageBase64 || !imageMimeType) return;
    
    setLoading(true);
    try {
      const result = await analyzePostureWithAI(imageBase64, imageMimeType);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error analyzing posture:', error);
      alert('Hubo un error al analizar la imagen. Por favor, intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!analysisResult || !workstation) return;
    
    setSaving(true);
    try {
      const riskLevel = analysisResult.score >= 7 ? 'high' : analysisResult.score >= 4 ? 'medium' : 'low';
      
      await addNode({
        type: NodeType.ERGONOMICS,
        title: `Análisis IA - ${workstation}`,
        description: `Evaluación postural asistida por IA en el puesto ${workstation}. Puntuación de riesgo: ${analysisResult.score}/10. Hallazgos: ${analysisResult.findings.join(', ')}`,
        tags: ['ergonomia', 'ia', 'postura', riskLevel],
        metadata: {
          workstation: workstation,
          assessmentType: 'Evaluación IA (RULA/REBA)',
          risk: riskLevel,
          observations: `Hallazgos: ${analysisResult.findings.join('. ')}\n\nRecomendaciones: ${analysisResult.recommendations.join('. ')}\n\nEstado Corporal:\n- Cuello: ${analysisResult.bodyParts.neck}\n- Tronco: ${analysisResult.bodyParts.trunk}\n- Brazos: ${analysisResult.bodyParts.arms}\n- Piernas: ${analysisResult.bodyParts.legs}`,
          status: 'completed',
          date: new Date().toISOString().split('T')[0],
          aiScore: analysisResult.score
        },
        connections: [],
        projectId: projectId
      });

      handleClose();
    } catch (error) {
      console.error('Error saving AI ergonomics node:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setImagePreview(null);
    setImageBase64(null);
    setImageMimeType(null);
    setAnalysisResult(null);
    setWorkstation('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl my-8"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <BrainCircuit className="w-6 h-6 text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Bio-Análisis IA</h2>
                  <p className="text-xs text-zinc-400">Evaluación postural mediante Computer Vision</p>
                </div>
              </div>
              <button 
                onClick={handleClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {!imagePreview ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center gap-4 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera className="w-8 h-8 text-zinc-400 group-hover:text-indigo-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">Sube una foto del trabajador</p>
                    <p className="text-sm text-zinc-500 mt-1">Formatos soportados: JPG, PNG</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-white/10">
                    <img 
                      src={imagePreview} 
                      alt="Preview" 
                      className="max-w-full max-h-full object-contain"
                    />
                    {!analysisResult && !loading && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute top-4 right-4 bg-black/50 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/70 transition-colors border border-white/10"
                      >
                        Cambiar Imagen
                      </button>
                    )}
                  </div>

                  {!analysisResult ? (
                    <button
                      onClick={handleAnalyze}
                      disabled={loading}
                      className="w-full py-4 rounded-xl bg-indigo-500 text-white font-bold uppercase tracking-widest text-sm hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Analizando Postura...</span>
                        </>
                      ) : (
                        <>
                          <ScanFace className="w-5 h-5" />
                          <span>Iniciar Bio-Análisis</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-6"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/5">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Puntuación de Riesgo</h3>
                          <div className="flex items-end gap-2">
                            <span className={`text-4xl font-black ${
                              analysisResult.score >= 7 ? 'text-rose-500' : 
                              analysisResult.score >= 4 ? 'text-amber-500' : 'text-emerald-500'
                            }`}>
                              {analysisResult.score}
                            </span>
                            <span className="text-zinc-500 mb-1 font-medium">/ 10</span>
                          </div>
                        </div>
                        
                        <div className="bg-zinc-800/50 rounded-xl p-4 border border-white/5">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Puesto de Trabajo</h3>
                          <input
                            type="text"
                            value={workstation}
                            onChange={(e) => setWorkstation(e.target.value)}
                            placeholder="Ej: Operador de Grúa"
                            className="w-full bg-zinc-900 border border-white/10 rounded-lg py-2 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            Hallazgos
                          </h3>
                          <ul className="space-y-2">
                            {analysisResult.findings.map((finding: string, i: number) => (
                              <li key={i} className="text-sm text-zinc-400 bg-zinc-800/30 p-2.5 rounded-lg border border-white/5">
                                {finding}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            Recomendaciones
                          </h3>
                          <ul className="space-y-2">
                            {analysisResult.recommendations.map((rec: string, i: number) => (
                              <li key={i} className="text-sm text-zinc-400 bg-zinc-800/30 p-2.5 rounded-lg border border-white/5">
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="bg-zinc-800/30 rounded-xl p-4 border border-white/5 space-y-3">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Activity className="w-4 h-4 text-indigo-500" />
                          Análisis Segmentado
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Cuello</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.neck}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Tronco</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.trunk}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Brazos</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.arms}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-500 uppercase">Piernas</span>
                            <p className="text-sm text-zinc-300 mt-1">{analysisResult.bodyParts.legs}</p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleSave}
                        disabled={saving || !workstation}
                        className="w-full py-4 rounded-xl bg-emerald-500 text-white font-bold uppercase tracking-widest text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                      >
                        {saving ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Guardando...</span>
                          </>
                        ) : (
                          <span>Guardar Evaluación</span>
                        )}
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/jpeg, image/png"
        className="hidden"
      />
    </AnimatePresence>
  );
}
