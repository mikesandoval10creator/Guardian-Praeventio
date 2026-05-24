// Praeventio Guard — Sprint K wire UI (2026-05-23) — Document read confirm.
//
// Page `/document-read`. Service `readReceiptService.ts` (deriveStatus +
// acknowledgeReceipt + summarizeReceipts) + card `DocumentReadConfirmCard.tsx`
// existían sin page consumidor.
//
// UX:
//   - Supervisor crea documentos con audience (allWorkers, roles, etc.)
//     + readDeadlineDays. Lista todos los docs publicados + coverage.
//   - Worker ve documentos pendientes para él → acknowledge button.
//   - El sistema deriva pending → overdue cuando deadlineAt pasa.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  FileText,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { DocumentReadConfirmCard } from '../components/readReceipts/DocumentReadConfirmCard';
import {
  acknowledgeReceipt,
  buildInitialReceipts,
  type DocumentForRead,
  type ReadReceipt,
  type WorkerForRead,
} from '../services/readReceipts/readReceiptService';
import {
  saveDocumentForRead,
  saveReceipt,
  acknowledgeReceiptInFirestore,
  subscribeDocumentsForRead,
  subscribeReceiptsForDocument,
} from '../services/readReceipts/readReceiptStore';
import { logger } from '../utils/logger';

export function DocumentReadConfirm() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [documents, setDocuments] = useState<DocumentForRead[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReadReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state.
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setDocuments([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeDocumentsForRead(
      projectId,
      (list) => {
        setDocuments(list);
        if (list.length > 0 && !selectedDocId) {
          setSelectedDocId(list[0].id);
        }
        setLoading(false);
      },
      (err) => {
        logger.warn('docs_for_read_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  // Receipts subscription per documento seleccionado.
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId || !selectedDocId) {
      setReceipts([]);
      return undefined;
    }
    const unsub = subscribeReceiptsForDocument(
      projectId,
      selectedDocId,
      (list) => setReceipts(list),
      (err) => logger.warn('receipts_sub_error', { err: String(err) }),
    );
    return () => unsub();
  }, [selectedProject?.id, selectedDocId]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId],
  );

  const myReceipt = useMemo(
    () => receipts.find((r) => r.workerUid === user?.uid) ?? null,
    [receipts, user],
  );

  const handleCreate = async () => {
    if (!selectedProject) {
      setFeedback('Seleccioná un proyecto.');
      return;
    }
    if (!title.trim()) {
      setFeedback('Título obligatorio.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const document: DocumentForRead = {
        id: docId,
        version: 1,
        title: title.trim(),
        audience: { allWorkers: true },
        publishedAt: new Date().toISOString(),
        readDeadlineDays: Math.max(1, Math.min(deadlineDays, 90)),
      };
      await saveDocumentForRead(selectedProject.id, document);

      // Si el user actual es worker (o admin que también lee), genera
      // un receipt inicial para él. Workers reales se sumarán al
      // subscribe; este path inicial sirve para que el supervisor que
      // creó el doc lo pueda confirmar también.
      if (user?.uid) {
        const myselfAsWorker: WorkerForRead = {
          uid: user.uid,
          role: 'supervisor',
          projectIds: [selectedProject.id],
          activeTrainings: [],
          isActive: true,
        };
        const initial = buildInitialReceipts(document, [myselfAsWorker]);
        for (const r of initial) {
          await saveReceipt(selectedProject.id, r);
        }
      }
      setFeedback(`Documento publicado (${docId.slice(0, 12)}). Workers verán el aviso de lectura.`);
      setSelectedDocId(docId);
      setShowForm(false);
      setTitle('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('create document failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledge = useCallback(async () => {
    if (!user || !selectedProject || !selectedDoc) return;
    try {
      const existing = receipts.find((r) => r.workerUid === user.uid);
      const target = existing ?? {
        documentId: selectedDoc.id,
        documentVersion: selectedDoc.version,
        workerUid: user.uid,
        acknowledgedAt: null,
        deadlineAt: new Date(
          Date.parse(selectedDoc.publishedAt) + selectedDoc.readDeadlineDays * 86_400_000,
        ).toISOString(),
        status: 'pending' as const,
      };
      const acked = acknowledgeReceipt(target);
      if (existing) {
        await acknowledgeReceiptInFirestore(
          selectedProject.id,
          selectedDoc.id,
          user.uid,
          acked.acknowledgedAt ?? undefined,
        );
      } else {
        await saveReceipt(selectedProject.id, acked);
      }
      setFeedback('Lectura confirmada.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('acknowledge failed', { err: msg });
      setFeedback(msg);
    }
  }, [user, selectedProject, selectedDoc, receipts]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <FileText className="w-6 h-6 text-sky-500" /> Confirmación de lectura
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Documentos críticos (protocolos, RIOHS, procedimientos nuevos)
              cuya lectura por parte del personal debe quedar trazada. El
              sistema marca como <em>overdue</em> los receipts no confirmados
              tras el deadline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Publicar documento
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para gestionar confirmaciones de lectura.
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

            {showForm && (
              <section className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-900/10 p-4 space-y-3">
                <h2 className="text-sm font-black text-sky-700 dark:text-sky-300 uppercase tracking-widest">
                  Publicar documento
                </h2>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">Título</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Procedimiento nuevo trabajo en altura — v2"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Días para confirmar lectura (1-90)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(parseInt(e.target.value, 10) || 7)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <p className="text-[10px] text-zinc-500">
                  Audiencia default: todos los workers activos del proyecto.
                  Para audiencias específicas (roles, training, etc.), usá el
                  API server-side directo.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={submitting || !title.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Publicar
                  </button>
                </div>
              </section>
            )}

            {documents.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                Aún no hay documentos publicados.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
                {/* Lista de documentos */}
                <aside className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-3 space-y-1 max-h-[600px] overflow-y-auto">
                  <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                    Documentos ({documents.length})
                  </h2>
                  <ul className="space-y-1">
                    {documents.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedDocId(d.id)}
                          className={`w-full text-left p-2 rounded-lg text-xs ${
                            d.id === selectedDocId
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                              : 'hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <p className="font-bold truncate">{d.title}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            v{d.version} · {d.readDeadlineDays}d · {new Date(d.publishedAt).toLocaleDateString('es-CL')}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>

                {/* Card del documento seleccionado */}
                <div className="space-y-3">
                  {selectedDoc ? (
                    <>
                      <DocumentReadConfirmCard
                        doc={selectedDoc}
                        receipts={receipts}
                        currentWorkerUid={user?.uid}
                        onAcknowledge={handleAcknowledge}
                      />
                      {myReceipt?.status !== 'acknowledged' && user && (
                        <button
                          type="button"
                          onClick={handleAcknowledge}
                          className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Confirmo lectura
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                      Seleccioná un documento.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DocumentReadConfirm;
