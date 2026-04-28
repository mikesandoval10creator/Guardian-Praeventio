import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cloud, HardDrive, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw, FileText, Lock } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { getPendingActions, SyncAction } from '../utils/pwa-offline';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth } from '../services/firebase';

export function GoogleDriveIntegrationManager() {
  const [isLinked, setIsLinked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingDocs, setPendingDocs] = useState<SyncAction[]>([]);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const loadPendingDocs = async () => {
      const actions = await getPendingActions();
      const docActions = actions.filter(a => a.type === 'upload' && a.collection === 'documents');
      setPendingDocs(docActions);
    };

    loadPendingDocs();
    window.addEventListener('sync-actions-updated', loadPendingDocs);
    return () => window.removeEventListener('sync-actions-updated', loadPendingDocs);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Server posts { type, linked: true } after storing OAuth tokens
      // server-side. No tokens travel through the browser.
      if (event.data?.type === 'DRIVE_AUTH_SUCCESS' && event.data.linked) {
        setIsLinked(true);
        setIsSyncing(false);
        setLastSync(new Date());
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLinkAccount = async () => {
    setIsSyncing(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');
      const response = await fetch('/api/drive/auth/url', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        'google_drive_auth',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Por favor, permite las ventanas emergentes (popups) para conectar Google Drive.');
        setIsSyncing(false);
      }
    } catch (error) {
      console.error('Error connecting to Google Drive:', error);
      setIsSyncing(false);
      alert('Error al iniciar la conexión con Google Drive.');
    }
  };

  const handleSync = () => {
    if (!isLinked || !isOnline) return;
    setIsSyncing(true);
    window.dispatchEvent(new CustomEvent('force-sync'));
    setTimeout(() => {
      setIsSyncing(false);
      setLastSync(new Date());
    }, 2000);
  };

  // Gate: Google Workspace add-on (Drive sync, OAuth-backed corporate folders)
  // ships with the Workspace Native bundle starting at Titanio. The previous
  // route was wide-open; tighten to `canUseGoogleWorkspaceAddon` so only tiers
  // that actually include the add-on can authorize OAuth tokens server-side.
  return (
    <PremiumFeatureGuard
      feature="canUseGoogleWorkspaceAddon"
      featureName="Google Workspace Sync"
      description="La integración con Google Workspace (Drive corporativo, OAuth) está disponible desde el plan Titanio. Actualiza tu plan para sincronizar documentos."
    >
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Cloud className="w-8 h-8 text-blue-500" />
            Workspace Sync
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Sincronización Bidireccional Segura
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-blue-500 bg-blue-500/10 border-blue-500/20">
          <Lock className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            OAuth 2.0 Estricto
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-blue-500" />
            Estado de Conexión
          </h2>

          <div className={`p-6 rounded-2xl border-2 transition-colors ${isLinked ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50'}`}>
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-xl ${isLinked ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                <Cloud className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Google Drive Corporativo</h3>
                <p className="text-sm text-zinc-400">
                  {isLinked ? 'Conectado y Autorizado' : 'No conectado'}
                </p>
              </div>
            </div>
          </div>

          {!isLinked ? (
            <Button 
              className="w-full py-4 text-lg" 
              onClick={handleLinkAccount} 
              disabled={isSyncing}
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  Autorizando...
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5 mr-2" />
                  Vincular Cuenta (OAuth)
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Última Sincronización</p>
                  <p className="text-sm font-bold text-white">
                    {lastSync ? lastSync.toLocaleTimeString() : 'Nunca'}
                  </p>
                </div>
                <Button variant="secondary" onClick={handleSync} disabled={isSyncing || !isOnline}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sincronizar Ahora
                </Button>
              </div>
              <Button variant="danger" className="w-full" onClick={() => setIsLinked(false)}>
                Revocar Acceso
              </Button>
            </div>
          )}
        </Card>

        {/* Sync Status Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-blue-500" />
            Cola de Sincronización
          </h2>

          {!isLinked ? (
            <div className="flex flex-col items-center justify-center h-48 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <ShieldAlert className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Vincula tu cuenta para ver los documentos sincronizados.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3 opacity-50" />
                  <p className="text-sm text-zinc-500">Todos los documentos están sincronizados.</p>
                </div>
              ) : (
                pendingDocs.map((doc, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-zinc-900 border border-white/5 flex items-center justify-between opacity-70">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-zinc-500" />
                      <div>
                        <p className="text-sm font-bold text-zinc-400">{doc.file?.name || doc.data?.documentData?.title || 'Documento'}</p>
                        <p className="text-xs text-zinc-600">Pendiente de subida a la nube</p>
                      </div>
                    </div>
                    <RefreshCw className="w-4 h-4 text-zinc-500" />
                  </div>
                ))
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
    </PremiumFeatureGuard>
  );
}
