// Praeventio Guard — Wire UI: <EngineeringInventoryCard />
//
// Surface `buildEngineeringInventoryReport()` del engineeringControlsInventory
// service — controles físicos / barreras / ventilación / interlocks por
// proyecto. Resalta:
//   - Riesgos sin cobertura (gap crítico — jerarquía ISO 45001 dice que
//     los controles físicos van ANTES que admin/EPP)
//   - Controles fuera de servicio (gap operativo inmediato)
//
// Doc usuario §42-44.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, AlertTriangle, ShieldX } from 'lucide-react';
import {
  buildEngineeringInventoryReport,
  type EngineeringControl,
} from '../../services/engineeringControls/engineeringControlsInventory.js';

interface EngineeringInventoryCardProps {
  controls: EngineeringControl[];
  projectRiskCategories: string[];
}

export function EngineeringInventoryCard({
  controls,
  projectRiskCategories,
}: EngineeringInventoryCardProps) {
  const { t } = useTranslation();
  const report = useMemo(
    () => buildEngineeringInventoryReport(controls, projectRiskCategories),
    [controls, projectRiskCategories],
  );

  const hasGap = report.uncoveredRiskCategories.length > 0;
  const hasOutOfService = report.outOfService.length > 0;

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${
        hasGap || hasOutOfService
          ? 'border-rose-500/30 bg-rose-500/5'
          : 'border-default-token bg-surface'
      }`}
      data-testid="engineering-inventory-card"
      aria-label={t('engineering.aria', 'Inventario controles ingeniería') as string}
    >
      <header className="flex items-center gap-2">
        <Wrench className="w-4 h-4 text-teal-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">
          {t('engineering.title', 'Controles de ingeniería')}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums"
          data-testid="engineering-total"
        >
          {report.total} {t('engineering.total', 'instalados')}
        </span>
      </header>

      {hasGap && (
        <div
          className="bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="engineering-uncovered"
        >
          <p className="font-bold flex items-center gap-1">
            <ShieldX className="w-3 h-3" aria-hidden="true" />
            {t('engineering.uncoveredTitle', 'Riesgos sin control físico')}
          </p>
          <p className="mt-1">
            {t(
              'engineering.uncoveredMsg',
              'Estos riesgos del proyecto no tienen barreras físicas operativas. La jerarquía ISO 45001 dice que estos van ANTES del EPP.',
            )}
          </p>
          <ul className="mt-1 list-disc list-inside">
            {report.uncoveredRiskCategories.map((cat) => (
              <li
                key={cat}
                data-testid={`engineering-gap-${cat}`}
                className="font-mono"
              >
                {cat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasOutOfService && (
        <div
          className="bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded text-[11px]"
          data-testid="engineering-out-of-service"
        >
          <p className="font-bold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {t('engineering.outOfServiceTitle', 'Fuera de servicio')} ({report.outOfService.length})
          </p>
          <ul className="mt-1 list-disc list-inside">
            {report.outOfService.slice(0, 5).map((ctrl) => (
              <li
                key={ctrl.id}
                data-testid={`engineering-down-${ctrl.id}`}
              >
                {ctrl.label} — <span className="font-mono">{ctrl.location}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-center">
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid="engineering-covered"
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('engineering.covered', 'Riesgos cubiertos')}
          </p>
          <p className="text-xl font-black tabular-nums text-emerald-600">
            {report.coveredRiskCategories.length}
          </p>
        </div>
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid="engineering-out-count"
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('engineering.outService', 'Fuera de servicio')}
          </p>
          <p
            className={`text-xl font-black tabular-nums ${
              report.outOfService.length > 0 ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {report.outOfService.length}
          </p>
        </div>
      </div>
    </section>
  );
}
