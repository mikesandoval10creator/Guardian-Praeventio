// Praeventio Guard — Wire UI #12: <SIFAlert />
//
// Panel dedicado para precursores SIF (Serious Injury or Fatality).
// Distinto de incidentes menores: revisión ejecutiva obligatoria,
// notificación mandante si aplica.

import { useTranslation } from 'react-i18next';
import { Skull, AlertOctagon, CheckCircle2, Bell } from 'lucide-react';
import type {
  SIFPrecursor,
  SIFPotential,
  SIFPrecursorKind,
} from '../../services/sif/sifPrecursorClassifier.js';

export interface SIFAlertItem extends SIFPrecursor {
  id: string;
  occurredAt: string;
  reviewedAt?: string;
  notifiedMandanteAt?: string;
}

interface SIFAlertProps {
  precursors: SIFAlertItem[];
  onReview?: (precursor: SIFAlertItem) => void;
  onNotifyMandante?: (precursor: SIFAlertItem) => void;
}

const KIND_LABEL: Record<SIFPrecursorKind, string> = {
  altura_sin_lesion: 'Caída evitada en altura',
  energia_liberada: 'Energía liberada inesperadamente',
  casi_golpe_movil: 'Casi golpe por equipo móvil',
  perdida_contencion_quimica: 'Pérdida de contención química',
  ingreso_no_autorizado_critico: 'Ingreso no autorizado a zona crítica',
  fuego_explosion_evitada: 'Fuego/explosión evitada',
  colapso_estructural_evitado: 'Colapso estructural evitado',
};

const POTENTIAL_CLASS: Record<SIFPotential, string> = {
  fatal: 'bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300',
  serious: 'bg-orange-500/20 border-orange-500/50 text-orange-700 dark:text-orange-300',
  moderate: 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300',
};

export function SIFAlert({ precursors, onReview, onNotifyMandante }: SIFAlertProps) {
  const { t } = useTranslation();

  if (precursors.length === 0) {
    return (
      <article
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center"
        data-testid="sif-alert-empty"
      >
        <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-600" aria-hidden="true" />
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          {t('sif.noPrecursors', 'Sin precursores SIF en el período')}
        </p>
      </article>
    );
  }

  return (
    <section
      className="rounded-2xl border-2 border-rose-500/40 bg-rose-500/5 p-4 shadow-mode"
      data-testid="sif-alert"
      aria-label={t('sif.aria', 'Precursores SIF (Serious Injury or Fatality)') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Skull className="w-5 h-5 text-rose-600" aria-hidden="true" />
        <h2 className="text-sm font-black text-rose-700 dark:text-rose-300 uppercase tracking-wide">
          {t('sif.title', 'Precursores SIF — Atención Ejecutiva')}
        </h2>
        <span className="ml-auto text-[10px] font-bold bg-rose-500 text-white px-2 py-0.5 rounded-full">
          {precursors.length}
        </span>
      </header>

      <ul className="space-y-3">
        {precursors.map((p) => {
          const needsReview = p.executiveReviewRequired && !p.reviewedAt;
          const needsNotification = p.mandanteNotificationRequired && !p.notifiedMandanteAt;
          return (
            <li
              key={p.id}
              data-testid={`sif-item-${p.id}`}
              className={`rounded-lg border-2 p-3 ${POTENTIAL_CLASS[p.potential]}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-tight">{KIND_LABEL[p.kind]}</p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5">
                    {t('sif.potentialLabel', 'Potencial')}: <strong>{p.potential}</strong>
                  </p>
                </div>
                <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              </div>

              <ul className="text-[11px] opacity-85 leading-snug space-y-0.5 mb-2">
                {p.rationale.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2 mt-2">
                {needsReview && (
                  <button
                    type="button"
                    onClick={() => onReview?.(p)}
                    disabled={!onReview}
                    data-testid={`sif-review-${p.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-white/40 dark:bg-black/30 text-xs font-bold hover:brightness-110 disabled:opacity-50"
                  >
                    {t('sif.requestReview', 'Requiere revisión ejecutiva')}
                  </button>
                )}
                {needsNotification && (
                  <button
                    type="button"
                    onClick={() => onNotifyMandante?.(p)}
                    disabled={!onNotifyMandante}
                    data-testid={`sif-notify-${p.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-white/40 dark:bg-black/30 text-xs font-bold hover:brightness-110 disabled:opacity-50"
                  >
                    <Bell className="w-3 h-3" aria-hidden="true" />
                    {t('sif.notifyMandante', 'Notificar mandante')}
                  </button>
                )}
                {!needsReview && p.executiveReviewRequired && (
                  <span className="inline-flex items-center gap-1 text-[10px] opacity-70">
                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                    {t('sif.reviewed', 'Revisado')}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
