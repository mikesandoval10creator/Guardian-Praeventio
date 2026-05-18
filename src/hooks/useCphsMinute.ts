// Praeventio Guard — F.7 CPHS Minute hook.
//
// Migrado del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { useEndpoint } from './_fetchUtils';
import type { MinuteDraft } from '../services/cphs/cphsMinuteAutogenerator';

export interface CphsDraftMinuteResponse {
  draft: MinuteDraft;
}

export function useCphsDraftMinute(projectId: string | null) {
  return useEndpoint<CphsDraftMinuteResponse>(
    projectId ? `/api/sprint-k/${projectId}/cphs/draft-minute` : null,
  );
}
