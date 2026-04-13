import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw, Server, ArrowRightLeft, Lock } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { auth } from '../services/firebase';

export function ERPIntegration() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/erp/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          erpType: 'SAP/Buk',
          action: 'manual_sync'
        })
      });

      if (!response.ok) throw new Error('Error en la sincronización');
      
      const data = await response.json();
      setLastSync(new Date(data.data.timestamp).toLocaleString());
    } catch (error) {
      console.error('Error syncing ERP:', error);
      alert('Error al sincronizar con el ERP. Verifica la conexión con el servidor.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Server className="w-8 h-8 text-blue-500" />
            Integración ERP / RRHH
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            API-First: Sincronización con SAP, Buk, Talana
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-blue-500 bg-blue-500/10 border-blue-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-blue-500" />
            Sincronización de Datos
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-blue-500" />
                <div>
                  <h3 className="text-sm font-bold text-white">SAP SuccessFactors</h3>
                  <p className="text-xs text-zinc-400">Estructura Organizacional</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-zinc-500">Conectado</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-indigo-500" />
                <div>
                  <h3 className="text-sm font-bold text-white">Buk / Talana</h3>
                  <p className="text-xs text-zinc-400">Nómina y Asistencia</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-zinc-500">Conectado</span>
              </div>
            </div>
          </div>

          <Button 
            className="w-full py-4 text-lg" 
            onClick={handleSync} 
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Sincronizando Vía API REST...
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-5 h-5 mr-2" />
                Forzar Sincronización Manual
              </>
            )}
          </Button>

          {lastSync && (
            <div className="text-center">
              <p className="text-xs text-zinc-500">Última sincronización exitosa: {lastSync}</p>
            </div>
          )}
        </Card>

        {/* API Config Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Configuración API REST
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Endpoint Base</p>
              <div className="flex items-center justify-between bg-black p-2 rounded border border-zinc-800">
                <code className="text-xs text-blue-400">https://api.praeventio.net/v1</code>
                <Button variant="secondary" className="px-2 py-1 h-auto text-[10px]">Copiar</Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">API Key (Bearer Token)</p>
              <div className="flex items-center justify-between bg-black p-2 rounded border border-zinc-800">
                <code className="text-xs text-zinc-500">sk_live_***************************</code>
                <Button variant="secondary" className="px-2 py-1 h-auto text-[10px]">Rotar Key</Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="flex gap-2">
                <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">
                  La API REST utiliza autenticación basada en JWT y está protegida por rate limiting (1000 req/min) y filtrado de IP.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
