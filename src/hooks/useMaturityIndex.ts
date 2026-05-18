// Praeventio Guard — F.26 Prevention Maturity hook.
//
// Migrado del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { useEndpoint } from './_fetchUtils';
import type {
  MaturityReport,
  MaturityRecommendation,
  MaturitySignals,
} from '../services/maturity/preventionMaturityIndex';

export interface MaturityIndexResponse {
  insufficientData?: boolean;
  reason?: 'project_too_new' | 'not_enough_signals';
  signalsCount?: number;
  feedsAvailable?: number;
  populatedFeeds?: string[];
  projectAgeDays?: number | null;
  report?: MaturityReport;
  recommendations?: MaturityRecommendation[];
  signals?: MaturitySignals;
  metadata?: {
    signalsCount: number;
    feedsAvailable: number;
    populatedFeeds: string[];
    projectAgeDays: number | null;
    windowMonths: number;
  };
}

export function usePreventionMaturity(projectId: string | null) {
  return useEndpoint<MaturityIndexResponse>(
    projectId ? `/api/sprint-k/${projectId}/maturity-index` : null,
  );
}
