// Praeventio Guard — Wire UI #63: <ExceptionsAuditPanel />
//
// Lista excepciones registradas: activas/expiradas/revocadas/cumplidas
// con conteo por dominio + drill-down.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitPullRequestArrow, ShieldOff, Check, X, Clock4 } from 'lucide-react';
import {
  summarize,
  deriveStatus,
  type ExceptionRecord,
  type ExceptionDomain,
} from '../../services/exceptions/exceptionEngine.js';

interface ExceptionsAuditPanelProps {
  records: ExceptionRecord[];
  now?: Date;
  onRevoke?: (record: ExceptionRecord) => void;
}

const DOMAIN_ORDER: ExceptionDomain[] = [
  'training_gap',
  'epp_expired',
  'permit_pending',
  'document_expired',
  'medical_fitness_pending',
  'equipment_inspection',
  'staffing_gap',
  'other',
];

const STATUS_TONE = {
  active: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  expired: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  revoked: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  fulfilled: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
} as const;

export function ExceptionsAuditPanel({
  records,
  now,
  onRevoke,
}: ExceptionsAuditPanelProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarize(records, now), [records, now]);
  const refDate = now ?? new Date();

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="exceptions-audit-panel"
      aria-label={t('exceptions.aria', 'Auditoría de excepciones') as string}
    >
      <header className="flex items-center gap-2">
        <GitPullRequestArrow className="w-4 h-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('exceptions.title', 'Excepciones controladas')}
        </h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums">
          {records.length} {t('exceptions.total', 'total')}
        </span>
      </header>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="bg-amber-500/10 rounded p-2" data-testid="exceptions-active">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('exceptions.active', 'Activas')}
          </p>
          <p className="text-xl font-black tabular-nums text-amber-600">
            {summary.totalActive}
          </p>
        </div>
        <div className="bg-rose-500/10 rounded p-2" data-testid="exceptions-expired">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('exceptions.expired', 'Expiradas')}
          </p>
          <p className="text-xl font-black tabular-nums text-rose-600">
            {summary.totalExpired}
          </p>
        </div>
        <div className="bg-slate-500/10 rounded p-2" data-testid="exceptions-revoked">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('exceptions.revoked', 'Revocadas')}
          </p>
          <p className="text-xl font-black tabular-nums">{summary.totalRevoked}</p>
        </div>
        <div className="bg-emerald-500/10 rounded p-2" data-testid="exceptions-fulfilled">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('exceptions.fulfilled', 'Cumplidas')}
          </p>
          <p className="text-xl font-black tabular-nums text-emerald-600">
            {summary.totalFulfilled}
          </p>
        </div>
      </div>

      <div data-testid="exceptions-by-domain">
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
          {t('exceptions.byDomain', 'Por dominio')}
        </h3>
        <div className="grid grid-cols-2 gap-1">
          {DOMAIN_ORDER.map((dom) => {
            const count = summary.byDomain[dom] ?? 0;
            if (count === 0) return null;
            return (
              <div
                key={dom}
                data-testid={`exceptions-domain-${dom}`}
                className="flex justify-between text-[11px] bg-surface-elevated rounded px-2 py-1"
              >
                <span className="uppercase">{dom}</span>
                <span className="font-bold tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="space-y-2" data-testid="exceptions-list">
        {records.length === 0 && (
          <li className="text-[11px] text-secondary-token italic">
            {t('exceptions.empty', 'Sin excepciones registradas.')}
          </li>
        )}
        {records.map((r) => {
          const status = deriveStatus(r, refDate);
          const Icon =
            status === 'fulfilled'
              ? Check
              : status === 'revoked'
                ? X
                : status === 'expired'
                  ? Clock4
                  : ShieldOff;
          return (
            <li
              key={r.id}
              data-testid={`exceptions-item-${r.id}`}
              className="bg-surface-elevated rounded p-2 flex gap-2 items-start"
            >
              <Icon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_TONE[status]}`}
                  >
                    {status.toUpperCase()}
                  </span>
                  <span className="text-[10px] uppercase text-secondary-token">{r.domain}</span>
                </div>
                <p className="text-[11px]">{r.reason}</p>
                <p className="text-[10px] text-secondary-token mt-0.5 truncate">
                  → {r.alternativeMitigation}
                </p>
              </div>
              {status === 'active' && onRevoke && (
                <button
                  type="button"
                  onClick={() => onRevoke(r)}
                  data-testid={`exceptions-revoke-${r.id}`}
                  className="text-[10px] font-bold text-rose-600 underline shrink-0"
                >
                  {t('exceptions.revoke', 'Revocar')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
