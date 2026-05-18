// Praeventio Guard — F.13 Repeating Risk Radar hook.
//
// Migrado del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation. La forma pública sigue siendo `useRepeatingRisks(projectId)`
// para que los consumers (RepeatingRisks.tsx + tests) solo cambien el import.

import { useEndpoint } from './_fetchUtils';
import type { RadarReport } from '../services/riskRadar/repeatingRiskRadar';

export interface RepeatingRisksResponse {
  report: RadarReport;
}

export function useRepeatingRisks(projectId: string | null) {
  return useEndpoint<RepeatingRisksResponse>(
    projectId ? `/api/sprint-k/${projectId}/repeating-risks` : null,
  );
}
