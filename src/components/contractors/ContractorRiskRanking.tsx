// Praeventio Guard — Connected risk ranking for contractors.
//
// Makes <ContractorRankingTable /> REAL on screen: it reads the per-contractor
// safety performance from the server hook (TRIR/LTIFR/severity computed
// SERVER-SIDE from REAL incidents + captured man-hours, via
// GET /api/sprint-k/:projectId/contractors/performance) and ranks contractors
// by injury rate. No fabricated rows or rates — when no man-hours are captured
// for the period the roster is genuinely empty and we show an honest empty
// state with a pointer to the capture form above.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContractorPerformance } from '../../hooks/useContractorPerformance';
import {
  rankContractorRowsByInjuryRate,
  type ContractorInjuryRates,
} from '../../services/contractors/contractorKpiService.js';
import { ContractorRankingTable } from './ContractorRankingTable.js';

interface ContractorRiskRankingProps {
  projectId: string | null;
  /** Reporting period as 'YYYY-MM'; defaults to the current month. */
  period?: string;
  onContractorClick?: (id: string) => void;
}

function currentPeriod(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

export function ContractorRiskRanking({
  projectId,
  period,
  onContractorClick,
}: ContractorRiskRankingProps) {
  const { t } = useTranslation();
  const [resolvedPeriod] = useState(() => period ?? currentPeriod());
  const { data, loading, error } = useContractorPerformance(
    projectId,
    period ?? resolvedPeriod,
  );

  const ranked = useMemo(() => {
    const rows: ContractorInjuryRates[] = (data?.contractors ?? []).map((c) => ({
      contractorId: c.contractorId,
      contractorName: c.contractorName,
      trir: c.report.trir,
      severityRate: c.report.severityRate,
    }));
    return rankContractorRowsByInjuryRate(rows);
  }, [data]);

  if (!projectId) {
    return (
      <div
        data-testid="contractor-ranking-no-project"
        className="rounded-2xl border border-dashed border-default-token p-6 text-center text-xs text-secondary-token"
      >
        {t(
          'contractorRanking.noProject',
          'Selecciona un proyecto para ver el ranking de contratistas por riesgo.',
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="contractor-ranking-loading"
        className="rounded-2xl border border-default-token p-6 text-center text-xs text-secondary-token"
      >
        {t('contractorRanking.loading', 'Cargando ranking de contratistas…')}
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="contractor-ranking-error"
        className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-xs text-amber-700 dark:text-amber-400"
      >
        {t('contractorRanking.error', 'No se pudo cargar el ranking')} ({error.message}).
      </div>
    );
  }

  return (
    <ContractorRankingTable ranked={ranked} onContractorClick={onContractorClick} />
  );
}

export default ContractorRiskRanking;
