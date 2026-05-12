// Praeventio Guard — Wire UI #49: <LineOfFireValidationCard />
//
// Visualiza el resultado de validar una exposición de línea de fuego.
// Muestra mitigaciones esperadas vs declaradas vs faltantes, con
// indicación clara cuando hay BLOQUEO duro.

import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, AlertOctagon } from 'lucide-react';
import type { LineOfFireValidationResult } from '../../services/lineOfFire/lineOfFireChecker.js';

interface LineOfFireValidationCardProps {
  result: LineOfFireValidationResult;
}

export function LineOfFireValidationCard({ result }: LineOfFireValidationCardProps) {
  const { t } = useTranslation();

  const tone = result.blockTask
    ? {
        Icon: AlertOctagon,
        color: 'text-rose-500',
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
        badgeLabel: t('lineOfFire.block', 'BLOQUEO'),
      }
    : result.passes
      ? {
          Icon: ShieldCheck,
          color: 'text-emerald-500',
          badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
          badgeLabel: t('lineOfFire.ok', 'CUMPLE'),
        }
      : {
          Icon: ShieldAlert,
          color: 'text-amber-500',
          badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          badgeLabel: t('lineOfFire.partial', 'PARCIAL'),
        };

  const { Icon } = tone;

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`lof-card-${result.exposure.kind}`}
      aria-label={t('lineOfFire.aria', 'Validación línea de fuego') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t(`lineOfFire.kind.${result.exposure.kind}`, result.exposure.kind)}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`lof-status-${result.exposure.kind}`}
        >
          {tone.badgeLabel}
        </span>
      </header>

      <p className="text-xs text-secondary-token" data-testid={`lof-message-${result.exposure.kind}`}>
        {result.message}
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-surface-elevated rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token mb-1">
            {t('lineOfFire.proximity', 'Proximidad')}
          </p>
          <p className="font-bold tabular-nums">{result.exposure.proximityMeters} m</p>
        </div>
        <div
          className={`rounded p-2 ${
            result.exposure.personnelInPath ? 'bg-rose-500/10' : 'bg-emerald-500/10'
          }`}
        >
          <p className="text-[10px] uppercase text-secondary-token mb-1">
            {t('lineOfFire.personnelInPath', 'Personas en trayectoria')}
          </p>
          <p className="font-bold">
            {result.exposure.personnelInPath ? t('common.yes', 'Sí') : t('common.no', 'No')}
          </p>
        </div>
      </div>

      {result.missingMitigations.length > 0 && (
        <div data-testid={`lof-missing-${result.exposure.kind}`}>
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            {t('lineOfFire.missing', 'Mitigaciones faltantes')}
          </h3>
          <ul className="space-y-1">
            {result.missingMitigations.map((m, i) => (
              <li
                key={i}
                className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-500/5 p-1.5 rounded"
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details data-testid={`lof-expected-${result.exposure.kind}`}>
        <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
          {t('lineOfFire.expected', 'Esperadas')} ({result.expectedMitigations.length})
        </summary>
        <ul className="mt-1 space-y-0.5 pl-3">
          {result.expectedMitigations.map((m, i) => (
            <li key={i} className="text-[11px] list-disc">
              {m}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
