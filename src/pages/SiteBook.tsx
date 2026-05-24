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
import { useTranslation } from 'react-i18next';
import { Book, Plus, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';

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
import {
  signSiteBookEntryWithWebAuthn,
  AlreadySignedError,
  SignCancelledError,
  WebAuthnNotSupportedError,
} from '../services/siteBook/siteBookSigningClient';
import { apiAuthHeader } from '../lib/apiAuth';
import { logger } from '../utils/logger';

// Plan 2026-05-24 §Fase B.6 batch3 — i18n sweep SiteBook (DS 76).
export function SiteBook() {
  const { t } = useTranslation();
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
  const [signingFolio, setSigningFolio] = useState<string | null>(null);

  // Plan 2026-05-24 §D.X — firma electrónica avanzada DS 76 vía
  // WebAuthn ECDSA-P256. El flow completo (issue challenge bound al
  // hash del entry → navigator.credentials.get → server verify) está
  // encapsulado en signSiteBookEntryWithWebAuthn — esta página solo
  // gestiona el feedback al usuario.
  const handleSign = useCallback(
    async (entry: SiteBookEntry) => {
      if (!user || !selectedProject) return;
      setFeedback(null);
      setSigningFolio(entry.folio);
      try {
        const authHeader = await apiAuthHeader();
        if (!authHeader) {
          throw new Error('No auth header — re-iniciar sesión.');
        }
        const signed = await signSiteBookEntryWithWebAuthn(entry, { authHeader });
        // El server ya persistió la entry firmada en Firestore — el
        // subscribeSiteBookEntries detectará el cambio. El setState
        // optimista solo acelera el feedback de UI.
        setEntries((prev) => prev.map((e) => (e.id === signed.id ? signed : e)));
        setFeedback(
          t('site_book.feedback.signed', {
            defaultValue: '{{folio}} firmada con WebAuthn ECDSA-P256.',
            folio: signed.folio,
          }),
        );
      } catch (err) {
        if (err instanceof WebAuthnNotSupportedError) {
          setFeedback(
            t(
              'site_book.feedback.webauthn_unsupported',
              'Este navegador no soporta firma WebAuthn. Usá Chrome / Safari / Edge en device con Touch ID o security key.',
            ),
          );
        } else if (err instanceof SignCancelledError) {
          setFeedback(t('site_book.feedback.sign_cancelled', 'Firma cancelada.'));
        } else if (err instanceof AlreadySignedError) {
          setFeedback(t('site_book.feedback.already_signed', 'La entrada ya estaba firmada.'));
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('site_book sign failed', { err: msg });
          setFeedback(
            t('site_book.feedback.sign_failed', {
              defaultValue: 'No se pudo firmar: {{msg}}',
              msg,
            }),
          );
        }
      } finally {
        setSigningFolio(null);
      }
    },
    [user, selectedProject, t],
  );

  const handleCreate = useCallback(
    async (payload: NewEntryFormPayload) => {
      if (!user || !selectedProject) {
        setFeedback(t('site_book.feedback.need_project', 'Seleccioná un proyecto y autenticación válida.'));
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
        setFeedback(
          t('site_book.feedback.created', {
            defaultValue: 'Entrada {{folio}} registrada.',
            folio: entry.folio,
          }),
        );
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
              <Book className="w-6 h-6 text-amber-600" /> {t('site_book.title', 'Bitácora de obra')}
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              {t(
                'site_book.subtitle',
                'Libro de obra digital con folios consecutivos year-based (DS 76). Entradas inmutables tras firma; correcciones requieren nueva entrada con folio propio que referencia la corregida.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('site_book.cta_new_entry', 'Nueva entrada')}
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            {t('site_book.empty.select_project', 'Seleccioná un proyecto para ver / agregar entradas.')}
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
                  {t('site_book.summary.heading', { defaultValue: 'Resumen ({{count}} entradas)', count: entries.length })}
                </h2>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">{t('site_book.summary.pending_signature', 'Pendientes firma')}</span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-white">
                      {summary.pendingSignatureCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">{t('site_book.summary.signed', 'Firmadas')}</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {summary.signedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-600 dark:text-zinc-400">{t('site_book.summary.corrections', 'Correcciones')}</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      {summary.correctionsCount}
                    </span>
                  </div>
                </div>
                {summary.byKind && Object.keys(summary.byKind).length > 0 && (
                  <>
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-3">
                      {t('site_book.summary.by_kind', 'Por tipo')}
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

              <div className="space-y-4">
                {entries.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                    {t('site_book.empty.no_entries', 'Sin entradas todavía. Crear la primera con "Nueva entrada".')}
                  </div>
                ) : (
                  <>
                    {/* Plan 2026-05-24 §D.X — DS 76 firma electrónica avanzada via WebAuthn. */}
                    {entries.some((e) => e.status === 'open') && (
                      <section className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-2">
                        <h2 className="text-xs font-black text-amber-800 dark:text-amber-200 uppercase tracking-widest flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4" />
                          {t('site_book.sign.heading', 'Pendientes de firma (DS 76)')}
                        </h2>
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          {t(
                            'site_book.sign.hint',
                            'Firma electrónica avanzada vía WebAuthn ECDSA-P256 — clave privada en el TPM/Secure Enclave de tu dispositivo. La firma queda matemáticamente vinculada al texto exacto de la entrada (Ley 19.799 §2.g).',
                          )}
                        </p>
                        <ul className="space-y-1.5">
                          {entries
                            .filter((e) => e.status === 'open')
                            .slice(0, 8)
                            .map((e) => (
                              <li
                                key={e.id}
                                className="rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-zinc-900/60 p-2 text-xs flex items-center gap-2"
                              >
                                <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">
                                  {e.folio}
                                </span>
                                <span className="text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                                  {e.description}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleSign(e)}
                                  disabled={signingFolio !== null}
                                  className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1"
                                >
                                  {signingFolio === e.folio ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="w-3 h-3" />
                                  )}
                                  {t('site_book.sign.cta', 'Firmar')}
                                </button>
                              </li>
                            ))}
                        </ul>
                      </section>
                    )}
                    <SiteBookViewer entries={entries} />
                  </>
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
