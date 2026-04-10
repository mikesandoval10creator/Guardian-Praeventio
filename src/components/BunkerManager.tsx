import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Download, CheckCircle2, Loader2, Shield, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { saveBunkerKnowledge, getBunkerKnowledge, isOnline } from '../utils/pwa-offline';
import { Card } from './shared/Card';

export function BunkerManager() {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const online = isOnline();

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    const data = await getBunkerKnowledge('bcn_database');
    if (data) {
      setStatus('ready');
      setLastSync(new Date(data.timestamp).toLocaleString());
    }
  };

  const downloadBunker = async () => {
    if (!online) return;
    
    setStatus('downloading');
    setProgress(0);

    // Simulate downloading large datasets (BCN, 3D Models, etc.)
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      setProgress((i / steps) * 100);
    }

    const bunkerData = {
      id: 'bcn_database',
      timestamp: Date.now(),
      version: '2026.4.1',
      content: {
        laws: ['Ley 16.744', 'DS 594', 'DS 40', 'Ley 21.012'],
        models: ['Andamio_Standard_v2', 'Grua_Torre_X100'],
        protocols: ['Rescate_Mina_S1', 'Evacuacion_Tsunami_L1']
      }
    };

    await saveBunkerKnowledge('bcn_database', bunkerData);
    setStatus('ready');
    setLastSync(new Date().toLocaleString());
  };

  return (
    <Card className="p-6 border-white/5 overflow-hidden relative">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-2xl ${status === 'ready' ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-blue-500/20 border-blue-500/30'} border`}>
            <Database className={`w-6 h-6 ${status === 'ready' ? 'text-emerald-400' : 'text-blue-400'}`} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Búnker de Inteligencia</h3>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Conocimiento Local Inmortal</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${online ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? 'Online' : 'Offline'}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-sm text-zinc-400 leading-relaxed">
          Descarga la base de datos completa de normativas (BCN) y modelos 3D para operar sin conexión en zonas críticas.
        </p>

        {status === 'ready' && (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-400 uppercase">Búnker Sincronizado</p>
              <p className="text-[10px] text-emerald-500/70">Última actualización: {lastSync}</p>
            </div>
          </div>
        )}

        {status === 'downloading' && (
          <div className="space-y-3">
            <div className="flex justify-between text-[10px] font-black text-blue-400 uppercase tracking-widest">
              <span>Descargando Inteligencia...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-blue-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 italic text-center">
              Asegurando leyes, protocolos y modelos 3D en la bóveda local...
            </p>
          </div>
        )}

        {status !== 'downloading' && (
          <button
            onClick={downloadBunker}
            disabled={!online}
            className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
              status === 'ready' 
                ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10' 
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            } disabled:opacity-50`}
          >
            {status === 'ready' ? (
              <>
                <Download className="w-4 h-4" />
                Actualizar Búnker
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Descargar Conocimiento (50MB)
              </>
            )}
          </button>
        )}

        {!online && status !== 'ready' && (
          <div className="flex items-center gap-2 text-[10px] text-amber-500 font-bold uppercase justify-center">
            <AlertTriangle className="w-3 h-3" />
            Requiere conexión para la descarga inicial
          </div>
        )}
      </div>

      {/* Security Seal */}
      <div className="absolute -bottom-4 -right-4 opacity-5 pointer-events-none">
        <Shield className="w-32 h-32 text-white" />
      </div>
    </Card>
  );
}
