import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitMerge, X, AlertTriangle } from 'lucide-react';

interface ConflictEvent {
  collection: string;
  id: string;
  localUpdatedAt: string;
  serverUpdatedAt: string;
  online?: boolean;
  nodeTitle?: string;
}

export function SyncConflictBanner() {
  const [conflicts, setConflicts] = useState<ConflictEvent[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConflictEvent>).detail;
      setConflicts(prev => {
        // Deduplicate by collection+id
        const exists = prev.some(c => c.collection === detail.collection && c.id === detail.id);
        if (exists) return prev;
        return [...prev, detail];
      });
      setDismissed(false);
    };
    window.addEventListener('sync-conflict', handler);
    return () => window.removeEventListener('sync-conflict', handler);
  }, []);

  const collectionLabel = (col: string) => {
    const map: Record<string, string> = {
      nodes: 'Red de Riesgos',
      projects: 'Proyectos',
      workers: 'Trabajadores',
      findings: 'Hallazgos',
    };
    return map[col] ?? col;
  };

  const visible = conflicts.length > 0 && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <GitMerge className="w-3.5 h-3.5 shrink-0" />
            <p className="text-[10px] font-bold flex-1">
              <span className="font-black">{conflicts.length} conflicto{conflicts.length > 1 ? 's' : ''} de sincronización</span>
              {' '}— {conflicts.some(c => c.online)
                ? conflicts.filter(c => c.online).map(c => c.nodeTitle || collectionLabel(c.collection)).slice(0, 2).join(', ')
                : conflicts.slice(0, 2).map(c => collectionLabel(c.collection)).join(', ')}
              {conflicts.length > 2 ? ` y ${conflicts.length - 2} más` : ''}.
              {' '}{conflicts.some(c => c.online) ? 'Otro usuario editó simultáneamente. Se aplicó tu versión.' : 'Se aplicó la última versión del servidor.'}
            </p>
            <button
              onClick={() => setDismissed(true)}
              className="shrink-0 p-1 hover:bg-amber-500/20 rounded-lg transition-colors"
              title="Descartar"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
