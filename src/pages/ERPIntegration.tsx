import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw, Server, ArrowRightLeft, Lock } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { auth } from '../services/firebase';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';

export function ERPIntegration() {
  const { t } = useTranslation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<string | null>(null);
  const [syncReason, setSyncReason] = useState<string | null>(null);
  const { toasts, show: showToast, dismiss } = useToast();

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMode(null);
    setSyncReason(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      // Sprint 39 fix — el backend ahora distingue modos honestamente.
      // El erpType viene de env (ERP_ADAPTER). Aquí solicitamos 'mock' por
      // default; en prod, el admin debe setear ERP_ADAPTER=sap|buk|talana
      // y el server route lo elige (ignorando este request si el override
      // no es válido).
      const response = await fetch('/api/erp/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          erpType: 'mock',
          action: 'manual_sync'
        })
      });

      const data = await response.json();
      // Capturar el modo HONESTAMENTE — el backend reporta si fue real,
      // mock, no configurado, o stub.
      const mode: string | undefined = data?.mode;
      const reason: string | undefined = data?.reason;
      const timestamp: string | undefined = data?.timestamp;
      setSyncMode(mode ?? null);
      setSyncReason(reason ?? null);

      if (response.status === 503 && mode === 'not_configured') {
        showToast(
          'ERP no está configurado en este servidor. Contacta al administrador.',
          'warning',
        );
      } else if (response.status === 503 && mode === 'missing_credentials') {
        showToast(
          'El adapter ERP requiere credenciales no configuradas. Revisa env vars.',
          'warning',
        );
      } else if (response.status === 501 && mode === 'not_implemented') {
        showToast(
          'Adapter declarado pero la acción aún no está implementada (stub honesto).',
          'info',
        );
      } else if (mode === 'mock') {
        showToast(
          'Sincronización en modo MOCK — no se conectó a ERP real.',
          'info',
        );
      } else if (response.ok && mode === 'real') {
        showToast('Sincronización real con ERP completada.', 'success');
      } else {
        showToast('Sincronización terminó con error. Ver detalles.', 'error');
      }

      if (timestamp) setLastSync(new Date(timestamp).toLocaleString());
    } catch (error) {
      logger.error('Error syncing ERP:', error);
      showToast('Error al sincronizar con el ERP. Verifica la conexión con el servidor.', 'error');
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
            {t('erpIntegration.title', 'Integración ERP / RRHH')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('erpIntegration.subtitle', 'API-First: Sincronización con SAP, Buk, Talana')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-blue-500 bg-blue-500/10 border-blue-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {t('erpIntegration.tierBadge', 'Nivel: Enterprise')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-blue-500" />
            {t('erpIntegration.syncSection', 'Sincronización de Datos')}
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

          {/* Sprint 39 — surface honesto del modo de la última sync. */}
          {syncMode && (
            <div
              data-testid="erp-sync-mode-banner"
              className={`text-center text-xs px-3 py-2 rounded ${
                syncMode === 'real'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : syncMode === 'mock'
                    ? 'bg-blue-500/10 text-blue-400'
                    : syncMode === 'not_configured' ||
                        syncMode === 'missing_credentials' ||
                        syncMode === 'not_implemented'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-rose-500/10 text-rose-400'
              }`}
            >
              <p className="font-bold uppercase tracking-wider">Modo: {syncMode}</p>
              {syncReason && <p className="mt-1 opacity-80">{syncReason}</p>}
            </div>
          )}

          {lastSync && (
            <div className="text-center">
              <p className="text-xs text-zinc-500">Último intento: {lastSync}</p>
            </div>
          )}
        </Card>

        {/* API Config Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            {t('erpIntegration.apiConfigSection', 'Configuración API REST')}
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
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
