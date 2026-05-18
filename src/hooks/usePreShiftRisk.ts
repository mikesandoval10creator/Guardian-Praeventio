// Praeventio Guard — F.21 Pre-Shift Risk hook.
//
// Migrado del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { useEndpoint } from './_fetchUtils';
import type {
  ShiftRiskReport,
  ShiftPeriod,
} from '../services/shiftRiskPanel/preShiftRiskComposer';

export interface PreShiftRiskResponse {
  panel: ShiftRiskReport;
}

export interface PreShiftRiskOptions {
  /** YYYY-MM-DD. Defaults to today (server-side). */
  date?: string;
  /** Defaults to 'day' (server-side). */
  shift?: ShiftPeriod;
}

export function usePreShiftRisk(
  projectId: string | null,
  opts: PreShiftRiskOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.date) qs.set('date', opts.date);
    if (opts.shift) qs.set('shift', opts.shift);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/pre-shift-risk${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<PreShiftRiskResponse>(path);
}
