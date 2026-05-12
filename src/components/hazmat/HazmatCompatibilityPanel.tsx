// Praeventio Guard — Wire UI #62: <HazmatCompatibilityPanel />
//
// Audita compatibilidad química de items almacenados juntos.
// Lista issues con nivel incompatible/caution.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, AlertOctagon, AlertTriangle } from 'lucide-react';
import {
  auditStorageLocation,
  type HazmatItem,
} from '../../services/hazmat/hazmatInventory.js';

interface HazmatCompatibilityPanelProps {
  items: HazmatItem[];
  locationLabel?: string;
}

export function HazmatCompatibilityPanel({
  items,
  locationLabel,
}: HazmatCompatibilityPanelProps) {
  const { t } = useTranslation();
  const issues = useMemo(() => auditStorageLocation(items), [items]);
  const incompatibles = issues.filter((i) => i.level === 'incompatible');
  const cautions = issues.filter((i) => i.level === 'caution');

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="hazmat-compat-panel"
      aria-label={t('hazmat.compatAria', 'Compatibilidad química') as string}
    >
      <header className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-orange-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('hazmat.compatTitle', 'Compatibilidad química')}
        </h2>
        {locationLabel && (
          <span className="ml-auto text-[10px] text-secondary-token truncate">
            {locationLabel}
          </span>
        )}
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface-elevated rounded p-2" data-testid="hazmat-compat-items">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('hazmat.items', 'Items')}
          </p>
          <p className="text-xl font-black tabular-nums">{items.length}</p>
        </div>
        <div className="bg-rose-500/10 rounded p-2" data-testid="hazmat-compat-incompat">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('hazmat.incompatible', 'Incompatibles')}
          </p>
          <p className="text-xl font-black tabular-nums text-rose-600">
            {incompatibles.length}
          </p>
        </div>
        <div className="bg-amber-500/10 rounded p-2" data-testid="hazmat-compat-caution">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('hazmat.caution', 'Precaución')}
          </p>
          <p className="text-xl font-black tabular-nums text-amber-600">{cautions.length}</p>
        </div>
      </div>

      {issues.length === 0 ? (
        <p
          className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-2 rounded font-bold text-center"
          data-testid="hazmat-compat-clean"
        >
          {t('hazmat.allCompatible', 'Almacenamiento compatible — sin issues detectados.')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="hazmat-compat-list">
          {issues.map((iss, i) => {
            const Icon = iss.level === 'incompatible' ? AlertOctagon : AlertTriangle;
            const tone =
              iss.level === 'incompatible'
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
            return (
              <li
                key={i}
                data-testid={`hazmat-issue-${i}`}
                className={`flex gap-2 p-2 rounded ${tone}`}
              >
                <Icon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1 text-[11px]">
                  <p className="font-bold">
                    {iss.itemA.name} ↔ {iss.itemB.name}
                  </p>
                  <p className="opacity-80">{iss.reason}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
