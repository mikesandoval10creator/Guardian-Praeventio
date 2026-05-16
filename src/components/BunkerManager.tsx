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

  // Antes esta función simulaba descarga con `setTimeout(500ms) × 10` y
  // guardaba un objeto literal hardcoded (`laws: ['Ley 16.744', ...]`)
  // como si fuera la base de datos BCN real.
  //
  // 2026-05-15: ahora consume `/api/bcn/snapshot` (endpoint NUEVO en este
  // PR — ver src/server/routes/bcn.ts) que fetcha las 8 leyes críticas
  // desde la Biblioteca del Congreso Nacional REAL vía
  // `bcnService.fetchLawFromBCN()`. Persiste el snapshot completo (con
  // texto íntegro de cada ley) en IndexedDB para operación offline.
  //
  // Cache server-side de 1h evita hammering al servidor BCN.
  const downloadBunker = async () => {
    if (!online) return;

    setStatus('downloading');
    setProgress(0);

    try {
      // BCN snapshot endpoint — fetcha leyes reales del backend
      const res = await fetch('/api/bcn/snapshot', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      setProgress(50);

      if (!res.ok) {
        // 502 = BCN está caído upstream. NO persistimos datos hardcoded —
        // mostramos error real para que el user reintente más tarde.
        setStatus('error');
        return;
      }

      const snapshot = await res.json();
      setProgress(90);

      // Persistimos el snapshot REAL (leyes BCN íntegras, no objeto literal).
      const bunkerData = {
        id: 'bcn_database',
        timestamp: Date.now(),
        version: snapshot?.version ?? 'unknown',
        content: snapshot?.content ?? null,
        source: 'bcn-api',
        lawsCount: snapshot?.content?.citationsCount ?? 0,
        totalSizeBytes: snapshot?.content?.totalSizeBytes ?? 0,
      };
      await saveBunkerKnowledge('bcn_database', bunkerData);
      setProgress(100);
      setStatus('ready');
      setLastSync(new Date().toLocaleString());
    } catch (err) {
      // Error de red — honesto, no fake-success.
      setStatus('error');
    }
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
          <div className="space-y-3" data-testid="bunker-downloading">
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

        {status === 'error' && (
          <div
            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3"
            data-testid="bunker-error"
          >
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold text-amber-400 uppercase">
                BCN temporalmente inaccesible
              </p>
              <p className="text-amber-200/80 mt-1">
                No pudimos conectar con la Biblioteca del Congreso Nacional
                (servidor BCN caído o sin conectividad). Reintenta en unos
                minutos. El bunker conservará la última versión válida que
                hayas descargado previamente.
              </p>
              <button
                onClick={downloadBunker}
                className="mt-3 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] uppercase tracking-wider"
              >
                Reintentar descarga
              </button>
            </div>
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
