// Praeventio Guard — Wire UI #25: <ContractorRankingTable />
//
// Tabla ejecutiva de contratistas ordenados por riesgo. Use case: vista
// del gerente de contratos antes de renovar acuerdos.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, AlertCircle, ChevronRight } from 'lucide-react';
import {
  rankContractorsByRisk,
  type ContractorPerformance,
  type ContractorRankEntry,
} from '../../services/contractors/contractorKpiService.js';

interface ContractorRankingTableProps {
  performances: ContractorPerformance[];
  onContractorClick?: (id: string) => void;
}

const LEVEL_CLASS: Record<ContractorRankEntry['level'], string> = {
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  yellow: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  red: 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
};

export function ContractorRankingTable({
  performances,
  onContractorClick,
}: ContractorRankingTableProps) {
  const { t } = useTranslation();
  const ranked = useMemo(() => rankContractorsByRisk(performances), [performances]);

  if (ranked.length === 0) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 text-center text-secondary-token"
        data-testid="contractor-ranking-empty"
      >
        <Building2 className="w-6 h-6 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {t('contractors.empty', 'Sin contratistas con datos de desempeño.')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface shadow-mode"
      data-testid="contractor-ranking-table"
      aria-label={t('contractors.aria', 'Ranking de contratistas') as string}
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-default-token">
        <Building2 className="w-4 h-4 text-primary-token" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('contractors.title', 'Ranking de Contratistas')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">{ranked.length}</span>
      </header>

      <ul className="divide-y divide-default-token">
        {ranked.map((c, idx) => (
          <li key={c.contractorId}>
            <button
              type="button"
              onClick={() => onContractorClick?.(c.contractorId)}
              disabled={!onContractorClick}
              data-testid={`contractor-row-${c.contractorId}`}
              className={`w-full px-4 py-2.5 flex items-center gap-3 ${
                onContractorClick ? 'hover:bg-surface-elevated cursor-pointer' : 'cursor-default'
              }`}
            >
              <span className="text-xs font-bold w-6 text-muted-token tabular-nums">
                {idx + 1}
              </span>
              <span
                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${LEVEL_CLASS[c.level]}`}
                data-testid={`contractor-level-${c.contractorId}`}
              >
                {c.level}
              </span>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-semibold text-primary-token truncate">
                  {c.legalName}
                </p>
                <p className="text-[10px] text-secondary-token">
                  {t('contractors.trirLabel', 'TRIR')}: <strong>{c.trir}</strong>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] uppercase text-muted-token">
                  {t('contractors.riskScore', 'Riesgo')}
                </p>
                <p className="text-sm font-black tabular-nums">{c.riskScore}</p>
              </div>
              {c.level === 'red' && (
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" aria-hidden="true" />
              )}
              {onContractorClick && (
                <ChevronRight className="w-3 h-3 text-muted-token shrink-0" aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
