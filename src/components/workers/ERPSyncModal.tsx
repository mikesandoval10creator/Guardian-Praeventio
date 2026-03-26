import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Database, CheckCircle2, Loader2, AlertTriangle, Download, Save } from 'lucide-react';
import { db, collection, addDoc } from '../../services/firebase';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';

interface ERPSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function ERPSyncModal({ isOpen, onClose, projectId }: ERPSyncModalProps) {
  const { addNode } = useZettelkasten();
  const [selectedERP, setSelectedERP] = useState<'BUK' | 'TALANA' | 'SAP' | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [syncResults, setSyncResults] = useState<{ added: number; updated: number; errors: number } | null>(null);

  const handleSync = async () => {
    if (!selectedERP || !apiKey) {
      alert("Por favor, ingresa el Token de Acceso (API Key) para continuar.");
      return;
    }
    setIsSyncing(true);
    
    // Simulate API call to ERP using the provided API Key
    console.log(`Syncing with ${selectedERP} using API Key: ${apiKey.substring(0, 5)}...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Simulate results
    const results = {
      added: Math.floor(Math.random() * 10) + 5,
      updated: Math.floor(Math.random() * 20) + 10,
      errors: Math.floor(Math.random() * 3)
    };
    
    setSyncResults(results);
    setSyncComplete(true);
    setIsSyncing(false);
  };

  const handleSaveReport = () => {
    alert(`Reporte de Sincronización ${selectedERP} guardado en Google Drive exitosamente.`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Sincronización ERP</h2>
                  <p className="text-xs text-zinc-400">Conecta con BUK, TALANA o SAP</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {!syncComplete ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    {(['BUK', 'TALANA', 'SAP'] as const).map((erp) => (
                      <button
                        key={erp}
                        onClick={() => setSelectedERP(erp)}
                        className={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-3 transition-all ${
                          selectedERP === erp 
                            ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                            : 'bg-zinc-800/50 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:border-white/10'
                        }`}
                      >
                        <Database className={`w-8 h-8 ${selectedERP === erp ? 'text-indigo-500' : 'text-zinc-500'}`} />
                        <span className="text-xs font-black uppercase tracking-widest">{erp}</span>
                      </button>
                    ))}
                  </div>

                  <AnimatePresence>
                    {selectedERP && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2 overflow-hidden"
                      >
                        <label className="block text-xs font-black text-zinc-400 uppercase tracking-widest">
                          Token de Acceso (API Key) - {selectedERP}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={`Ingresa el token de ${selectedERP}...`}
                          className="w-full bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Aviso de Simulación</p>
                      <p className="text-[10px] text-amber-200/70 leading-relaxed">
                        Esta es una demostración. En producción, esto requerirá tokens de acceso reales (API Keys) configurados por el administrador para conectar con los endpoints oficiales de cada ERP.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-white/5">
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors text-xs uppercase tracking-widest"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSync}
                      disabled={isSyncing || !selectedERP}
                      className="flex-2 px-4 py-3 rounded-xl bg-indigo-500 text-white font-black hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
                    >
                      {isSyncing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sincronizando...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          <span>Iniciar Sincronización</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center space-y-6">
                  <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Sincronización Exitosa</h3>
                    <p className="text-zinc-400 text-sm">Los datos de {selectedERP} han sido actualizados en la plataforma.</p>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                    <div className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                      <p className="text-2xl font-black text-emerald-500">{syncResults?.added}</p>
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Nuevos</p>
                    </div>
                    <div className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                      <p className="text-2xl font-black text-blue-500">{syncResults?.updated}</p>
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Actualizados</p>
                    </div>
                    <div className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                      <p className="text-2xl font-black text-rose-500">{syncResults?.errors}</p>
                      <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Errores</p>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-center pt-6">
                    <button
                      onClick={onClose}
                      className="px-6 py-3 rounded-xl bg-zinc-800 text-white font-black uppercase tracking-widest text-[10px] hover:bg-zinc-700 transition-colors"
                    >
                      Cerrar
                    </button>
                    <button
                      onClick={handleSaveReport}
                      className="px-6 py-3 rounded-xl bg-indigo-500 text-white font-black uppercase tracking-widest text-[10px] hover:bg-indigo-600 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                    >
                      <Save className="w-4 h-4" />
                      Guardar Reporte en Drive
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
