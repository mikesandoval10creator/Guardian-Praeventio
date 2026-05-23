// Praeventio Guard — Sprint K wire UI (2026-05-23) — Bitácora de Obra (DS 76).
//
// Page `/site-book`. Service `siteBookService.ts` (createEntry +
// buildFolio + signEntry + filterEntries + summarizeSiteBook) + components
// `NewEntryForm.tsx` + `SiteBookViewer.tsx` existían sin page consumidor.
//
// UX:
//   - Lista entradas del proyecto en orden descendente (más recientes primero)
//   - Botón "Nueva entrada" abre form (NewEntryForm) con 12 kinds DS 76
//   - Folio auto-asignado vía counter atómico year-based (SB-2026-000001)
//   - Status open → signed (inmutable; correcciones requieren nueva entrada
//     marcada con correctsEntryFolio + correctionReason)
//   - Resumen lateral: total por kind, por status

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Book, Plus, Loader2, AlertTriangle } from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { NewEntryForm, type NewEntryFormPayload } from '../components/siteBook/NewEntryForm';
import { SiteBookViewer } from '../components/siteBook/SiteBookViewer';
import {
  createEntry,
  summarizeSiteBook,
  type SiteBookEntry,
} from '../services/siteBook/siteBookService';
import {
  nextSequenceForYear,
  saveSiteBookEntry,
  subscribeSiteBookEntries,
} from '../services/siteBook/siteBookStore';
import { logger } from '../utils/logger';

export function SiteBook() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [entries, setEntries] = useState<SiteBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setEntries([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeSiteBookEntries(
      projectId,
      (list) => {
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('site_book_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const summary = useMemo(() => summarizeSiteBook(entries), [entries]);

  const handleCreate = useCallback(
    async (payload: NewEntryFormPayload) => {
      if (!user || !selectedProject) {
        setFeedback('Seleccioná un proyecto y autenticación válida.');
        return;
      }
      try {
        const year = new Date().getFullYear();
        const sequenceNumber = await nextSequenceForYear(selectedProject.id, year);
        const entry = createEntry({
          projectId: selectedProject.id,
          year,
          sequenceNumber,
          kind: payload.kind,
          occurredAt: payload.occurredAt,
          recordedByUid: payload.recordedByUid,
          recordedByRole: payload.recordedByRole,
          description: payload.description,
          location: payload.location,
          involvedWorkerUids: payload.involvedWorkerUids,
        });
        await saveSiteBookEntry(selectedProject.id, entry);
        setFeedback(`Entrada ${entry.folio} registrada.`);
        setShowForm(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('site_book create failed', { err: msg });
        setFeedback(msg);
        throw err;
      }
    },
    [user, selectedProject],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <Book className="w-6 h-6 text-amber-600" /> Bitácora de obra
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Libro de obra digital con folios consecutivos year-based (DS 76).
              Entradas inmutables tras firma; correcciones requieren nueva
              entrada con folio propio que referencia la corregida.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nueva entrada
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para ver / agregar entradas.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {showForm && user && (
              <section className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4">
                <NewEntryForm
                  projectId={selectedProject.id}
                  recordedByUid={user.uid}
                  recordedByRole="supervisor"
                  onSubmit={handleCreate}
                  onCancel={() => setShowForm(false)}
                />
              </section>
            )}

            {/* Resumen lateral + viewer principal */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <aside className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-3 space-y-3">
                <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  Resumen ({entries.length} entradas)
                </h2>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Pendientes firma</span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-white">
                      {summary.pendingSignatureCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Firmadas</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {summary.signedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">Correcciones</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      {summary.correctionsCount}
                    </span>
                  </div>
                </div>
                {summary.byKind && Object.keys(summary.byKind).length > 0 && (
                  <>
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-3">
                      Por tipo
                    </h3>
                    <ul className="space-y-1 text-[11px]">
                      {Object.entries(summary.byKind)
                        .sort(([, a], [, b]) => b - a)
                        .map(([kind, count]) => (
                          <li key={kind} className="flex items-center justify-between text-zinc-600 dark:text-zinc-400">
                            <span className="truncate">{kind}</span>
                            <span className="font-mono">{count}</span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </aside>

              <div>
                {entries.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                    Sin entradas todavía. Crear la primera con "Nueva entrada".
                  </div>
                ) : (
                  <SiteBookViewer entries={entries} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SiteBook;
