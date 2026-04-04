import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Upload, Loader2, ShieldAlert, CheckCircle2, AlertTriangle, ScanFace } from 'lucide-react';
import { verifyEPPWithAI } from '../../services/geminiService';
import { eppCatalog } from '../../data/epp';

interface AIEPPScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workerName: string;
  onApply: (detectedEppIds: string[]) => void;
}

export function AIEPPScannerModal({ isOpen, onClose, workerName, onApply }: AIEPPScannerModalProps) {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;
    setLoading(true);
    try {
      // Extract base64 data
      const base64Data = image.split(',')[1];
      
      // Pass the entire catalog names as required EPP so Gemini knows what to look for
      const requiredEPP = eppCatalog.map(e => e.name);
      
      const analysis = await verifyEPPWithAI(base64Data, workerName, requiredEPP);
      
      // Map detected EPP names back to catalog IDs
      const detectedIds = analysis.detectedEPP.map((name: string) => {
        // Simple fuzzy match or exact match
        const found = eppCatalog.find(e => String(e.name || '').toLowerCase().includes(String(name || '').toLowerCase()) || String(name || '').toLowerCase().includes(String(e.name || '').toLowerCase()));
        return found?.id;
      }).filter(Boolean) as string[];

      setResult({ ...analysis, detectedIds });
    } catch (error) {
      console.error("Error analyzing image:", error);
      // Handle error (could show a toast)
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (result && result.detectedIds) {
      onApply(result.detectedIds);
      onClose();
    }
  };

  // Reset state when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setImage(null);
      setResult(null);
      setLoading(false);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-indigo-500/30 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl shadow-indigo-500/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-indigo-50 dark:bg-gradient-to-r dark:from-indigo-500/10 dark:to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
                  <ScanFace className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Inspección Visual IA</h2>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold uppercase tracking-widest truncate">Escaneando a: {workerName}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar bg-white dark:bg-zinc-900">
              {!image ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-500/50 rounded-3xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all bg-zinc-50 dark:bg-zinc-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/5 group"
                >
                  <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 rounded-full flex items-center justify-center mb-6 transition-colors">
                    <Camera className="w-10 h-10 text-zinc-400 dark:text-zinc-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors" />
                  </div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">Tomar Foto o Subir Imagen</h3>
                  <p className="text-sm text-zinc-500 text-center max-w-sm">
                    Sube una foto clara del trabajador para que Gemini Vision analice su equipamiento de seguridad.
                  </p>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-white/10 aspect-[3/4] bg-zinc-100 dark:bg-black">
                      <img src={image} alt="Worker" className="w-full h-full object-cover" />
                      {loading && (
                        <div className="absolute inset-0 bg-white/60 dark:bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                          <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-500 animate-spin mb-4" />
                          <p className="text-indigo-700 dark:text-indigo-400 font-bold animate-pulse text-sm uppercase tracking-widest">Analizando EPP...</p>
                        </div>
                      )}
                    </div>
                    {!loading && !result && (
                      <div className="flex gap-3">
                        <button 
                          onClick={() => setImage(null)}
                          className="flex-1 py-3 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm"
                        >
                          Cambiar Foto
                        </button>
                        <button 
                          onClick={analyzeImage}
                          className="flex-1 py-3 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 text-sm flex items-center justify-center gap-2"
                        >
                          <ScanFace className="w-4 h-4" />
                          Analizar
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col h-full">
                    {result ? (
                      <div className="flex-1 space-y-6">
                        <div className={`p-4 rounded-2xl border ${result.isCompliant ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30'}`}>
                          <div className="flex items-center gap-3 mb-2">
                            {result.isCompliant ? (
                              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <ShieldAlert className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                            )}
                            <h3 className={`text-lg font-bold ${result.isCompliant ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                              {result.isCompliant ? 'EPP Completo' : 'Falta EPP'}
                            </h3>
                          </div>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            Confianza del análisis: {(result.confidence * 100).toFixed(0)}%
                          </p>
                        </div>

                        <div>
                          <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                            Detectado ({result.detectedEPP.length})
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {result.detectedEPP.map((item: string, i: number) => (
                              <span key={i} className="px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-lg text-xs font-medium">
                                {item}
                              </span>
                            ))}
                            {result.detectedEPP.length === 0 && <span className="text-xs text-zinc-500">Ninguno detectado</span>}
                          </div>
                        </div>

                        {result.missingEPP.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-500" />
                              Faltante ({result.missingEPP.length})
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {result.missingEPP.map((item: string, i: number) => (
                                <span key={i} className="px-3 py-1.5 bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 rounded-lg text-xs font-medium">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {result.recommendations.length > 0 && (
                          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
                            <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Recomendaciones IA</h4>
                            <ul className="space-y-2">
                              {result.recommendations.map((rec: string, i: number) => (
                                <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300 flex items-start gap-2">
                                  <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">•</span>
                                  {rec}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-zinc-200 dark:border-white/5 rounded-3xl bg-zinc-50 dark:bg-zinc-900/30">
                        <ScanFace className="w-12 h-12 text-zinc-400 dark:text-zinc-700 mb-4" />
                        <h3 className="text-zinc-600 dark:text-zinc-400 font-medium mb-2">Esperando Análisis</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-600">
                          Haz clic en "Analizar" para procesar la imagen con Gemini Vision y detectar el EPP automáticamente.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 flex gap-3 shrink-0">
                <button
                  onClick={() => { setImage(null); setResult(null); }}
                  className="flex-1 px-4 py-3 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm"
                >
                  Escanear de Nuevo
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 text-sm flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Aplicar EPP Detectado
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
