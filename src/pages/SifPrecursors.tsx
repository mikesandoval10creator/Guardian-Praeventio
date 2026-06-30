// Praeventio Guard — OLA 1: SIF precursors dedicated page.
//
// Mounts the previously-orphaned <SIFAlert /> on a real route (`/sif`), fed by
// the worker's project pending-executive-review precursors
// (useSifPendingReview → /api/sprint-k/:projectId/sif/pending-review). Wires the
// two accountability actions to their AUDITED server routes:
//   - executive review  → recordSifExecutiveReview  (POST .../executive-review)
//   - mandante notified  → recordSifMandanteNotification (POST .../notify-mandante)
// Both stamp identity + timestamp server-side (B4). SIF = Serious Injury or
// Fatality precursor review; a life-safety/compliance surface (free, no gating).

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skull, Loader2, AlertTriangle } from 'lucide-react';
import { SIFAlert, type SIFAlertItem } from '../components/sif/SIFAlert';
import { useProject } from '../contexts/ProjectContext';
import {
  useSifPendingReview,
  recordSifExecutiveReview,
  recordSifMandanteNotification,
} from '../hooks/useSif';
import { logger } from '../utils/logger';

export function SifPrecursors() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error, refetch } = useSifPendingReview(projectId);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  const handleReview = useCallback(
    async (p: SIFAlertItem) => {
      if (!projectId || busy) return;
      setBusy(true);
      setFeedback(null);
      try {
        await recordSifExecutiveReview(projectId, p.id, {});
        setFeedback({ kind: 'ok', msg: t('sif_page.reviewed_ok', 'Revisión ejecutiva registrada.') });
        refetch();
      } catch (err) {
        logger.warn('sif_page.review_failed', { err: String(err) });
        setFeedback({
          kind: 'error',
          msg: err instanceof Error ? err.message : t('sif_page.action_failed', 'No se pudo registrar la acción.'),
        });
      } finally {
        setBusy(false);
      }
    },
    [projectId, busy, refetch, t],
  );

  const handleNotifyMandante = useCallback(
    async (p: SIFAlertItem) => {
      if (!projectId || busy) return;
      setBusy(true);
      setFeedback(null);
      try {
        await recordSifMandanteNotification(projectId, p.id);
        setFeedback({ kind: 'ok', msg: t('sif_page.notified_ok', 'Notificación al mandante registrada.') });
        refetch();
      } catch (err) {
        logger.warn('sif_page.notify_failed', { err: String(err) });
        setFeedback({
          kind: 'error',
          msg: err instanceof Error ? err.message : t('sif_page.action_failed', 'No se pudo registrar la acción.'),
        });
      } finally {
        setBusy(false);
      }
    },
    [projectId, busy, refetch, t],
  );

  // StoredSIFPrecursor is a structural superset of SIFAlertItem.
  const precursors = (data?.precursors ?? []) as SIFAlertItem[];

  return (
    <section className="p-4 space-y-4 max-w-2xl mx-auto" data-testid="sifPage.page" aria-label={t('sif_page.title', 'Precursores SIF')}>
      <header className="flex items-center gap-2">
        <Skull className="w-5 h-5 text-rose-600" aria-hidden="true" />
        <h1 className="text-lg font-bold">{t('sif_page.title', 'Precursores SIF')}</h1>
      </header>
      <p className="text-xs text-muted-token">
        {t(
          'sif_page.subtitle',
          'Cuasi-accidentes con potencial de lesión grave o fatal (SIF). Requieren revisión ejecutiva y, si corresponde, notificación al mandante.',
        )}
      </p>

      {feedback && (
        <div
          role="alert"
          data-testid="sifPage.feedback"
          className={`rounded-xl border p-2.5 text-xs ${
            feedback.kind === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {!projectId ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-muted-token dark:border-white/10 dark:bg-zinc-900/60" data-testid="sifPage.noProject">
          {t('sif_page.no_project', 'Seleccioná un proyecto para ver sus precursores SIF.')}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-muted-token" data-testid="sifPage.loading">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200" data-testid="sifPage.error">
          <AlertTriangle className="w-4 h-4 inline mr-1" aria-hidden="true" />
          {t('sif_page.load_failed', 'No se pudieron cargar los precursores SIF.')}
        </div>
      ) : (
        <SIFAlert
          precursors={precursors}
          onReview={(p) => void handleReview(p)}
          onNotifyMandante={(p) => void handleNotifyMandante(p)}
        />
      )}
    </section>
  );
}

export default SifPrecursors;
