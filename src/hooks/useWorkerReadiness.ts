// Praeventio Guard — F.16 Worker Readiness hook.
//
// Migrado del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { useEndpoint } from './_fetchUtils';
import type { ReadinessReport } from '../services/workerReadiness/readinessScore';

export interface WorkerReadinessResponse {
  report: ReadinessReport;
}

export function useWorkerReadiness(
  projectId: string | null,
  workerUid: string | null,
  opts: { taskId?: string } = {},
) {
  let path: string | null = null;
  if (projectId && workerUid) {
    const qs = new URLSearchParams();
    if (opts.taskId) qs.set('taskId', opts.taskId);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/worker-readiness/${workerUid}${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<WorkerReadinessResponse>(path);
}
