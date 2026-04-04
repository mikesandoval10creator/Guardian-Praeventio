import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CloudOff, RefreshCw, Trash2, CheckCircle2, AlertCircle, Plus, Edit2, Upload, FileText } from 'lucide-react';
import { getPendingActions, removeSyncedAction, SyncAction, syncWithFirebase } from '../../utils/pwa-offline';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface SyncCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SyncCenterModal({ isOpen, onClose }: SyncCenterModalProps) {
  const [pendingActions, setPendingActions] = useState<SyncAction[]>([]);
  const [failedActions, setFailedActions] = useState<Record<number, string>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const isOnline = useOnlineStatus();

  const loadPendingActions = async () => {
    const actions = await getPendingActions();
    setPendingActions(actions);
  };

  useEffect(() => {
    if (isOpen) {
      loadPendingActions();
    }
    
    const handleSyncFailed = (e: any) => {
      const { action, error } = e.detail;
      if (action.id) {
        let errorMessage = error instanceof Error ? error.message : String(error);
        try {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error) {
            errorMessage = parsed.error;
          }
        } catch (e) {
          // Not JSON, keep original message
        }
        setFailedActions(prev => ({
          ...prev,
          [action.id!]: errorMessage
        }));
      }
    };

    const handleSyncProgress = (e: any) => {
      setSyncProgress(e.detail);
    };

    window.addEventListener('sync-actions-updated', loadPendingActions);
    window.addEventListener('sync-action-failed', handleSyncFailed);
    window.addEventListener('sync-progress', handleSyncProgress);
    return () => {
      window.removeEventListener('sync-actions-updated', loadPendingActions);
      window.removeEventListener('sync-action-failed', handleSyncFailed);
      window.removeEventListener('sync-progress', handleSyncProgress);
    };
  }, [isOpen]);

  const handleSync = async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    setFailedActions({}); // Clear previous errors
    setSyncProgress({ current: 0, total: pendingActions.length });
    try {
      // Trigger the global sync function in OfflineSyncManager
      window.dispatchEvent(new CustomEvent('force-sync'));
      
      // Wait a bit for the global sync manager to process
      setTimeout(async () => {
        await loadPendingActions();
        setIsSyncing(false);
        setSyncProgress({ current: 0, total: 0 });
      }, 2000);
    } catch (error) {
      console.error("Error during manual sync:", error);
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  };

  const handleRetry = async (action: SyncAction) => {
    if (!isOnline) return;
    setIsSyncing(true);
    setFailedActions(prev => {
      const newFailed = { ...prev };
      if (action.id) delete newFailed[action.id];
      return newFailed;
    });
    
    window.dispatchEvent(new CustomEvent('force-sync-single', { detail: { action } }));
    
    setTimeout(async () => {
      await loadPendingActions();
      setIsSyncing(false);
    }, 1500);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar esta acción pendiente? Los datos no se guardarán en la nube.')) {
      await removeSyncedAction(id);
      await loadPendingActions();
    }
  };

  const handleClearAll = async () => {
    if (window.confirm('¿Estás seguro de que deseas eliminar TODAS las acciones pendientes? Perderás todos los cambios realizados sin conexión.')) {
      for (const action of pendingActions) {
        if (action.id) await removeSyncedAction(action.id);
      }
      await loadPendingActions();
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'create': return <Plus className="w-4 h-4 text-emerald-500" />;
      case 'update': return <Edit2 className="w-4 h-4 text-blue-500" />;
      case 'delete': return <Trash2 className="w-4 h-4 text-rose-500" />;
      case 'upload': return <Upload className="w-4 h-4 text-purple-500" />;
      default: return <FileText className="w-4 h-4 text-zinc-500" />;
    }
  };

  const getActionLabel = (action: SyncAction) => {
    const typeMap: Record<string, string> = {
      create: 'Crear',
      update: 'Actualizar',
      delete: 'Eliminar',
      upload: 'Subir Archivo'
    };
    const collectionMap: Record<string, string> = {
      workers: 'Trabajador',
      risks: 'Riesgo',
      findings: 'Hallazgo',
      documents: 'Documento',
      training_sessions: 'Capacitación',
      assets: 'Maquinaria',
      projects: 'Proyecto'
    };

    const type = typeMap[action.type] || action.type;
    const collection = collectionMap[action.collection] || action.collection;

    return `${type} ${collection}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]"
          >
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-orange-600 dark:text-orange-400">
                <CloudOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Centro de Sincronización</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {pendingActions.length} {pendingActions.length === 1 ? 'acción pendiente' : 'acciones pendientes'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendingActions.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                  title="Eliminar todas las acciones"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {isSyncing && syncProgress.total > 0 && (
            <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 border-b border-emerald-100 dark:border-emerald-500/20">
              <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-400 mb-1">
                <span>Sincronizando...</span>
                <span>{syncProgress.current} / {syncProgress.total}</span>
              </div>
              <div className="w-full bg-emerald-200 dark:bg-emerald-900/50 rounded-full h-1.5">
                <div 
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" 
                  style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 bg-zinc-50/50 dark:bg-zinc-900/50">
            {pendingActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-3 opacity-50" />
                <p className="text-zinc-600 dark:text-zinc-400 font-medium">Todo está sincronizado</p>
                <p className="text-sm text-zinc-500 mt-1">No hay acciones pendientes en la cola offline.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {!isOnline && (
                  <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-lg p-3 flex items-start gap-3 mb-4">
                    <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-orange-800 dark:text-orange-300">
                      Estás sin conexión. Las acciones se sincronizarán automáticamente cuando recuperes la señal.
                    </p>
                  </div>
                )}

                {pendingActions.map((action) => (
                  <div 
                    key={action.id} 
                    className={`bg-white dark:bg-zinc-800 border ${action.id && failedActions[action.id] ? 'border-rose-300 dark:border-rose-500/50' : 'border-zinc-200 dark:border-zinc-700'} rounded-lg p-3 flex flex-col gap-2 group transition-all`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                          {getActionIcon(action.type)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-zinc-900 dark:text-white">
                            {getActionLabel(action)}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {new Date(action.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {action.id && failedActions[action.id] && isOnline && (
                          <button
                            onClick={() => handleRetry(action)}
                            className="p-2 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                            title="Reintentar sincronización"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => action.id && handleDelete(action.id)}
                          className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Eliminar acción (no se sincronizará)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {action.id && failedActions[action.id] && (
                      <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 p-2 rounded mt-1 border border-rose-100 dark:border-rose-500/20">
                        <span className="font-semibold">Error:</span> {failedActions[action.id]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Cerrar
            </button>
            <button
              onClick={handleSync}
              disabled={!isOnline || pendingActions.length === 0 || isSyncing}
              className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors ${
                !isOnline || pendingActions.length === 0
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizando...' : 'Forzar Sincronización'}
            </button>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
