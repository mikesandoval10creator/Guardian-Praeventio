import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitMerge, X, AlertTriangle, ExternalLink, RotateCcw, Check } from 'lucide-react';

interface ConflictEvent {
  collection: string;
  id: string;
  localUpdatedAt: string;
  serverUpdatedAt: string;
  online?: boolean;
  nodeTitle?: string;
  /** Snapshot of the server doc captured at conflict-detection time, used by "restore" */
  serverData?: unknown;
}

export interface SyncConflictBannerProps {
  /**
   * Router-aware navigator wired up by the parent layout (RootLayout owns the
   * mapping from Firestore collection names to in-app routes via
   * `react-router-dom`'s `useNavigate`). The mapping itself lives in the
   * shared `routeForCollection` helper at
   * `src/components/shared/syncConflictRoutes.ts` so it can be unit-tested
   * without a router. When omitted, the "Abrir registro" button stays hidden
   * — the banner is route-agnostic by design and never imports
   * `react-router-dom` itself, which keeps it usable in storybook / isolated
   * tests.
   *
   * Contract: callers receive the raw Firestore collection name (e.g.
   * "nodes", "audits", "workers") and the document id. They are responsible
   * for picking the correct destination route and calling `navigate(...)`.
   */
  onOpenRecord?: (collection: string, docId: string) => void;
  /**
   * Optional callback to restore the server version, replacing the local
   * (already-applied) overwrite. The parent should wire this to
   * SyncManager.restoreServerVersion. If omitted, the button is hidden.
   */
  onRestoreServerVersion?: (collection: string, docId: string, serverData: unknown) => void | Promise<void>;
}

export function SyncConflictBanner({ onOpenRecord, onRestoreServerVersion }: SyncConflictBannerProps = {}) {
  const [conflicts, setConflicts] = useState<ConflictEvent[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  // Honest copy: the local write was applied (LWW), so the peer's edit was
  // overwritten. We say so directly rather than implying the conflict was
  // automatically resolved.
  const headline = conflicts.length === 1
    ? 'Conflicto de edición: tu versión sobrescribió la del servidor.'
    : `${conflicts.length} conflictos de edición: tus versiones sobrescribieron las del servidor.`;

  const dismissOne = (idx: number) => {
    setConflicts(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <GitMerge className="w-3.5 h-3.5 shrink-0" />
              <p className="text-[10px] font-bold flex-1">
                <span className="font-black">{headline}</span>
                {' '}
                {conflicts.slice(0, 2).map(c => c.nodeTitle || collectionLabel(c.collection)).join(', ')}
                {conflicts.length > 2 ? ` y ${conflicts.length - 2} más` : ''}.
              </p>
              <button
                onClick={() => setExpanded(v => !v)}
                className="shrink-0 px-2 py-0.5 text-[10px] font-bold hover:bg-amber-500/20 rounded transition-colors"
                title="Ver detalles"
              >
                {expanded ? 'Ocultar' : 'Ver detalles'}
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="shrink-0 p-1 hover:bg-amber-500/20 rounded-lg transition-colors"
                title="Descartar"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {expanded && (
              <ul className="flex flex-col gap-1 pl-6">
                {conflicts.map((c, idx) => (
                  <li key={`${c.collection}:${c.id}`} className="flex items-center gap-2 text-[10px]">
                    <span className="font-bold flex-1 truncate">
                      {c.nodeTitle || collectionLabel(c.collection)}
                      <span className="opacity-70"> — {c.id}</span>
                    </span>

                    <button
                      onClick={() => dismissOne(idx)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                      title="Mantener mi versión (ya aplicada)"
                    >
                      <Check className="w-3 h-3" />
                      Mantener mi versión
                    </button>

                    {onRestoreServerVersion && (
                      <button
                        onClick={() => {
                          // Fire-and-forget; consumer is responsible for surfacing errors.
                          void onRestoreServerVersion(c.collection, c.id, c.serverData);
                          dismissOne(idx);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                        title="Restaurar versión del servidor"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restaurar versión del servidor
                      </button>
                    )}

                    {onOpenRecord && (
                      <button
                        onClick={() => onOpenRecord(c.collection, c.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-500/20 transition-colors"
                        title="Abrir registro"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Abrir registro
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// `onOpenRecord` is wired from the consumer side (RootLayout) via the shared
// `routeForCollection` helper at `./syncConflictRoutes.ts`. See the JSDoc on
// `SyncConflictBannerProps.onOpenRecord` for the prop contract — this
// component intentionally stays router-agnostic.
