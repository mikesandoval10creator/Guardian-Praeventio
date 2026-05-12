// Praeventio Guard — Wire UI: <ExpirationsListPanel />
//
// Lista vencimientos por bucket de severidad.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, AlertTriangle, AlertOctagon, Check } from 'lucide-react';
import {
  scanForExpirations,
  type ExpirableItem,
  type ScanOptions,
  type ExpirationOutcome,
} from '../../services/expirations/expirationScanner.js';

interface ExpirationsListPanelProps {
  items: ExpirableItem[];
  options?: ScanOptions;
  onSelectItem?: (item: ExpirableItem) => void;
}

export function ExpirationsListPanel({
  items,
  options,
  onSelectItem,
}: ExpirationsListPanelProps) {
  const { t } = useTranslation();
  const result = useMemo(() => scanForExpirations(items, options), [items, options]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="expirations-panel"
      aria-label={t('expirations.aria', 'Panel de vencimientos') as string}
    >
      <header className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('expirations.title', 'Vencimientos')}
        </h2>
        <span
          className="ml-auto text-[10px] text-secondary-token"
          data-testid="exp-total"
        >
          {result.totalScanned} {t('expirations.scanned', 'analizados')}
        </span>
      </header>

      <Bucket
        testId="exp-bucket-expired"
        title={t('expirations.expired', 'Vencidos')}
        icon={AlertOctagon}
        iconCls="text-rose-500"
        tone="bad"
        outcomes={result.expired}
        onSelect={onSelectItem}
      />
      <Bucket
        testId="exp-bucket-critical"
        title={t('expirations.critical', 'Críticos')}
        icon={AlertTriangle}
        iconCls="text-orange-500"
        tone="bad"
        outcomes={result.critical}
        onSelect={onSelectItem}
      />
      <Bucket
        testId="exp-bucket-warning"
        title={t('expirations.warning', 'Advertencia')}
        icon={AlertTriangle}
        iconCls="text-amber-500"
        tone="warn"
        outcomes={result.warning}
        onSelect={onSelectItem}
      />

      {result.expired.length === 0 &&
        result.critical.length === 0 &&
        result.warning.length === 0 && (
          <p
            className="text-[11px] text-emerald-600 dark:text-emerald-300 flex items-center gap-1"
            data-testid="exp-empty"
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            {t('expirations.allOk', 'Sin vencimientos próximos')}
          </p>
        )}
    </section>
  );
}

function Bucket({
  testId,
  title,
  icon: Icon,
  iconCls,
  tone,
  outcomes,
  onSelect,
}: {
  testId: string;
  title: string;
  icon: typeof AlertOctagon;
  iconCls: string;
  tone: 'bad' | 'warn';
  outcomes: ExpirationOutcome[];
  onSelect?: (item: ExpirableItem) => void;
}) {
  if (outcomes.length === 0) return null;
  const bgCls =
    tone === 'bad' ? 'bg-rose-500/5' : 'bg-amber-500/5';
  return (
    <div data-testid={testId}>
      <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1 flex items-center gap-1">
        <Icon className={`w-3 h-3 ${iconCls}`} aria-hidden="true" />
        {title} ({outcomes.length})
      </h3>
      <ul className="space-y-1">
        {outcomes.map((o) => (
          <li
            key={`${o.item.kind}:${o.item.id}`}
            data-testid={`exp-row-${o.item.id}`}
            className={`text-[11px] ${bgCls} p-1.5 rounded flex justify-between gap-2`}
          >
            <button
              type="button"
              onClick={() => onSelect?.(o.item)}
              disabled={!onSelect}
              className="text-left flex-1 disabled:cursor-default"
            >
              <span className="font-bold">
                {o.item.label ?? `${o.item.kind}:${o.item.id}`}
              </span>
              <span className="ml-2 opacity-70">[{o.item.kind}]</span>
            </button>
            <span className="font-mono shrink-0">
              {o.daysUntilExpiry < 0
                ? `+${Math.abs(o.daysUntilExpiry)}d`
                : `${o.daysUntilExpiry}d`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
