// Calm advisory banner: surfaces the headcount-triggered legal obligation a
// project has crossed into (CPHS ≥25 / Departamento de Prevención ≥100).
// Self-contained like PendingInvitesBanner — the Sidebar just renders it.
//
// Tone is amber/advisory, NOT emergency-red: Praeventio recommends, it never
// blocks and never pushes to an organism (the company complies + signs). The
// CTA points at the legal calendar, where the reconcile cron has already
// materialised the obligation. Legal compliance is FREE on every tier (ADR
// 0021); this banner is never tier-gated.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Scale, X } from 'lucide-react';
import { useLegalStatusAlert } from '../../hooks/useLegalStatusAlert';

const DISMISS_PREFIX = 'legal-alert-dismissed';

export function LegalStatusAlert() {
  const { t } = useTranslation();
  const alert = useLegalStatusAlert();
  // Dismissal is scoped per (project, obligation) so a NEW obligation — a
  // different project, or an escalation cphs→dprp — still surfaces even if the
  // previous one was dismissed.
  const dismissKey = alert ? `${DISMISS_PREFIX}-${alert.projectId}-${alert.alertType}` : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(dismissKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  if (!alert || dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    try {
      if (dismissKey) window.localStorage.setItem(dismissKey, '1');
    } catch {
      /* private mode / storage disabled — dismissal is best-effort */
    }
  };

  const isDprp = alert.alertType === 'dprp';
  const title = isDprp
    ? t('legal_alert.dprp_title', 'Departamento de Prevención obligatorio')
    : t('legal_alert.cphs_title', 'Comité Paritario obligatorio');
  const body = isDprp
    ? t('legal_alert.dprp_body', 'Tu faena alcanzó {{workers}} trabajadores: la ley exige un Departamento de Prevención de Riesgos.', {
        workers: alert.workersCount,
      })
    : t('legal_alert.cphs_body', 'Tu faena alcanzó {{workers}} trabajadores: la ley exige constituir un Comité Paritario (CPHS).', {
        workers: alert.workersCount,
      });

  return (
    <div
      role="status"
      className="mx-3 mt-2 mb-0 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 flex items-start gap-3"
    >
      <Scale className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-amber-600 dark:text-amber-400">{title}</p>
        <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-0.5">{body}</p>
        <Link
          to="/legal-calendar"
          className="text-[11px] font-bold text-amber-600 dark:text-amber-400 underline mt-1 inline-block"
        >
          {t('legal_alert.cta', 'Ver calendario legal')}
        </Link>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('legal_alert.dismiss', 'Descartar')}
        className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
