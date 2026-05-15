// Praeventio Guard — Wire UI: <PrivacyRegimeCard />
//
// Surface `getActiveRegimes()` + `strictestDeadlineDays()` + `complianceMatrix()`
// del privacy/registry service. Para una jurisdicción dada (ISO 3166-1
// alpha-2 + opcional dataResidency), muestra:
//
//   - Régimes activos (GDPR-EU, LGPD-BR, Ley-19628-CL, PIPL-CN, ...)
//   - Deadline más estricto aplicable a Data Subject Access Requests
//   - Matriz: qué derecho soporta qué régimen (access, erasure, portability...)
//   - Flag data residency (¿los datos deben residir físicamente en el país?)
//
// Audit cycle 2026-05-05 multi-tenant + Sprint 31 MM (privacy regimes).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Globe, Clock, MapPin } from 'lucide-react';
import {
  getActiveRegimes,
  complianceMatrix,
  strictestDeadlineDays,
  type ActiveRegimesContext,
} from '../../services/privacy/registry.js';

interface PrivacyRegimeCardProps {
  context: ActiveRegimesContext;
}

export function PrivacyRegimeCard({ context }: PrivacyRegimeCardProps) {
  const { t } = useTranslation();
  const regimes = useMemo(() => getActiveRegimes(context), [context]);
  const deadline = useMemo(() => strictestDeadlineDays(regimes), [regimes]);
  const matrix = useMemo(() => complianceMatrix(regimes), [regimes]);

  const residencyRequired = regimes.some((r) => r.dataResidencyRequired === true);

  if (regimes.length === 0) {
    return (
      <section
        className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-mode"
        data-testid="privacy-regime-empty"
      >
        <p className="text-[12px] text-amber-700 dark:text-amber-300">
          {t(
            'privacy.unknownCountry',
            'No tenemos régimen privacidad mapeado para esta jurisdicción.',
          )}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="privacy-regime-card"
      aria-label={t('privacy.aria', 'Régimen de privacidad aplicable') as string}
    >
      <header className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">
          {t('privacy.title', 'Régimen privacidad')}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums"
          data-testid="privacy-regime-count"
        >
          {regimes.length} {t('privacy.activeRegimes', 'régimes')}
        </span>
      </header>

      <div className="flex flex-wrap gap-1" data-testid="privacy-regime-list">
        {regimes.map((r) => (
          <span
            key={r.code}
            data-testid={`privacy-regime-${r.code}`}
            className="text-[10px] font-mono bg-surface-elevated px-2 py-0.5 rounded border border-default-token"
            title={r.citation}
          >
            {r.code}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-surface-elevated rounded p-2" data-testid="privacy-deadline">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {t('privacy.strictest', 'Deadline más estricto')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {deadline}d
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-2" data-testid="privacy-residency">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {t('privacy.residency', 'Data residency')}
          </p>
          <p
            className={`text-sm font-black ${
              residencyRequired ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {residencyRequired ? t('privacy.required', 'Requerido') : t('privacy.optional', 'Flexible')}
          </p>
        </div>
      </div>

      <div data-testid="privacy-rights-matrix" className="space-y-1">
        <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token">
          <Globe className="w-3 h-3" aria-hidden="true" />
          {t('privacy.rightsTitle', 'Derechos data subject soportados')}
        </h3>
        <ul className="space-y-1">
          {matrix
            .filter((row) => row.supportedBy.length > 0)
            .map((row) => (
              <li
                key={row.right}
                data-testid={`privacy-right-${row.right}`}
                className="flex items-center justify-between bg-surface-elevated rounded px-2 py-1 text-[11px]"
              >
                <span className="capitalize">{row.right.replace(/_/g, ' ')}</span>
                <span className="text-[10px] text-secondary-token tabular-nums">
                  {row.supportedBy.length}× •{' '}
                  {Math.min(...row.supportedBy.map((s) => s.deadlineDays))}d
                </span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
