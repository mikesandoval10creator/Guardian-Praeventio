import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Upload, Shield, AlertTriangle, Loader2, X, CheckCircle2, Sparkles, User, Save } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { Worker, EPPItem, NodeType } from '../../types';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { verifyEPPWithAI } from '../../services/geminiService';

interface EPPVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  workers: Worker[];
  eppItems: EPPItem[];
}

interface VerificationResult {
  isCompliant: boolean;
  detectedEPP: string[];
  missingEPP: string[];
  recommendations: string[];
  confidence: number;
}

export function EPPVerificationModal({ isOpen, onClose, workers, eppItems }: EPPVerificationModalProps) {
  const { selectedProject } = useProject();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addNode } = useRiskEngine();

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);

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

  const verifyEPP = async () => {
    if (!image || !selectedWorker) return;
    setIsAnalyzing(true);
    try {
      const base64Image = image.split(',')[1];
      
      // Get required EPP for this worker
      const requiredEPP = selectedWorker.requiredEPP && selectedWorker.requiredEPP.length > 0 
        ? selectedWorker.requiredEPP 
        : eppItems.filter(item => item.required).map(item => item.name);
      
      const analysis = await verifyEPPWithAI(base64Image, selectedWorker.name, requiredEPP);
      setResult(analysis);
    } catch (err) {
      console.error('Error verifying EPP:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!result || !selectedWorker || !selectedProject) return;
    setIsSaving(true);
    try {
      // Save to Firestore
      const verificationRef = await addDoc(collection(db, `projects/${selectedProject.id}/epp_verifications`), {
        projectId: selectedProject.id,
        workerId: selectedWorker.id,
        workerName: selectedWorker.name,
        isCompliant: result.isCompliant,
        detectedEPP: result.detectedEPP,
        missingEPP: result.missingEPP,
        recommendations: result.recommendations,
        confidence: result.confidence,
        createdAt: serverTimestamp()
      });

      // Save to Risk Network
      await addNode({
        type: NodeType.EPP,
        title: `Verificación EPP: ${selectedWorker.name}`,
        description: result.isCompliant 
          ? `Cumplimiento total de EPP verificado por IA.` 
          : `Incumplimiento detectado. Faltan: ${result.missingEPP.join(', ')}`,
        tags: ['epp', 'verificacion', 'ia', result.isCompliant ? 'cumple' : 'incumple'],
        projectId: selectedProject.id,
        connections: [selectedWorker.id],
        metadata: {
          verificationId: verificationRef.id,
          workerId: selectedWorker.id,
          isCompliant: result.isCompliant,
          confidence: result.confidence
        }
      });

      onClose();
      setResult(null);
      setImage(null);
      setSelectedWorkerId('');
    } catch (error) {
      console.error('Error saving verification:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Verificación de EPP con IA</h2>
                  <p className="text-xs font-medium text-emerald-500">Visión Artificial El Guardián</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Input */}
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1">Seleccionar Trabajador</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                      <select
                        value={selectedWorkerId}
                        onChange={(e) => setSelectedWorkerId(e.target.value)}
                        className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none transition-all"
                      >
                        <option value="">Seleccione un trabajador...</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>{w.name} - {w.role}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`aspect-video rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center overflow-hidden relative ${
                      image ? 'border-emerald-500/50' : 'border-white/10 hover:border-emerald-500/50 bg-zinc-800/30'
                    }`}
                  >
                    {image ? (
                      <>
                        <img src={image} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <p className="text-white text-sm font-medium flex items-center gap-2">
                            <Camera className="w-4 h-4" />
                            Cambiar Imagen
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-6">
                        <Upload className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
                        <p className="text-sm text-zinc-300 font-medium">Sube una foto del trabajador</p>
                        <p className="text-xs text-zinc-500 mt-1">Captura en tiempo real</p>
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
                    onClick={verifyEPP}
                    disabled={!image || !selectedWorkerId || isAnalyzing}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-xl font-medium text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:shadow-none"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Verificando con IA...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Iniciar Verificación</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Right: Results */}
                <div className="space-y-6">
                  {result ? (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="space-y-6"
                    >
                      <div className={`p-5 rounded-xl border flex items-center gap-4 ${
                        result.isCompliant 
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' 
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                      }`}>
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                          result.isCompliant ? 'bg-emerald-500/20' : 'bg-rose-500/20'
                        }`}>
                          {result.isCompliant ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">
                            {result.isCompliant ? 'Cumplimiento Total' : 'Incumplimiento Detectado'}
                          </h3>
                          <p className="text-xs font-medium opacity-80 mt-0.5">
                            Confianza del Análisis: {(result.confidence * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        <div className="bg-zinc-800/50 border border-white/5 rounded-xl p-4">
                          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            EPP Detectado
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {result.detectedEPP.map((item, i) => (
                              <span key={i} className="bg-emerald-500/10 text-emerald-400 text-xs font-medium px-2.5 py-1 rounded-lg border border-emerald-500/20">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>

                        {result.missingEPP.length > 0 && (
                          <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4">
                            <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              EPP Faltante
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {result.missingEPP.map((item, i) => (
                                <span key={i} className="bg-rose-500/10 text-rose-400 text-xs font-medium px-2.5 py-1 rounded-lg border border-rose-500/20">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4">
                          <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            Recomendaciones
                          </h4>
                          <ul className="space-y-2">
                            {result.recommendations.map((rec, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                                <span className="leading-relaxed">{rec}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/10 rounded-xl bg-zinc-800/20 min-h-[300px]">
                      <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mb-4 border border-white/5">
                        <Sparkles className="w-8 h-8 text-zinc-500" />
                      </div>
                      <h3 className="text-white font-bold text-lg mb-2">Esperando Verificación</h3>
                      <p className="text-sm text-zinc-400 max-w-[250px] leading-relaxed">
                        Selecciona un trabajador y sube su fotografía para realizar la validación automática de EPP.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/5 bg-zinc-900 shrink-0 flex justify-end gap-3">
              <button 
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-white font-medium text-sm hover:bg-zinc-700 transition-colors"
              >
                Cerrar
              </button>
              {result && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Guardar Verificación
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
