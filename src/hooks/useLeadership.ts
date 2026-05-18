// Praeventio Guard — §276-277 Leadership Decisions hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  SupervisionDecision,
  SupervisionDecisionKind,
  SupervisorRanking,
} from '../services/leadership/supervisionDecisionTrail';

export type LeadershipPeriod = '30d' | '90d' | 'all';

export interface LeadershipDecisionsResponse {
  decisions: SupervisionDecision[];
}

export interface LeadershipRankingResponse {
  ranking: SupervisorRanking[];
}

export interface LeadershipDecisionPayload {
  id?: string;
  decidedAt?: string;
  kind: SupervisionDecisionKind;
  context: string;
  rationale: string;
  involvedRef?: {
    kind: 'TASK' | 'WORKER' | 'FINDING' | 'EXCEPTION';
    id: string;
  };
  outcome?: {
    positive: boolean;
    description: string;
    recordedAt: string;
  };
}

export function useLeadershipDecisions(
  projectId: string | null,
  opts: { supervisorUid?: string; period?: LeadershipPeriod } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.supervisorUid) qs.set('supervisorUid', opts.supervisorUid);
    if (opts.period) qs.set('period', opts.period);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/leadership/decisions${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<LeadershipDecisionsResponse>(path);
}

export function useLeadershipRanking(
  projectId: string | null,
  period: LeadershipPeriod = '90d',
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    qs.set('period', period);
    path = `/api/sprint-k/${projectId}/leadership/ranking?${qs.toString()}`;
  }
  return useEndpoint<LeadershipRankingResponse>(path);
}

export async function recordLeadershipDecision(
  projectId: string,
  payload: LeadershipDecisionPayload,
): Promise<SupervisionDecision> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/leadership/decisions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as {
    ok: true;
    decision: SupervisionDecision;
  };
  return json.decision;
}
