// Praeventio Guard — §291-295 Annual SGI Review hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type { PreventiveObjective } from '../services/annualReview/annualSgiReview';
import { apiAuthHeader } from '../lib/apiAuth';

export interface AnnualReviewEvidence {
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
  attachedAt: string;
  attachedByUid: string;
}

export interface AnnualReviewSnapshot {
  fiscalYear: number;
  tenantId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  updatedByUid: string;
  objectives: PreventiveObjective[];
  evidences: AnnualReviewEvidence[];
  analysis: string;
  conclusion: string | null;
  signedOffByUid: string | null;
  signedOffByName: string | null;
  concludedAt: string | null;
  isConcluded: boolean;
}

export interface AnnualReviewResponse {
  year: number;
  exists: boolean;
  snapshot: AnnualReviewSnapshot | null;
}

export function useCurrentAnnualReview(
  projectId: string | null,
  opts: { year?: number } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (typeof opts.year === 'number' && Number.isInteger(opts.year)) {
      qs.set('year', String(opts.year));
    }
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/annual-review/current${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<AnnualReviewResponse>(path);
}

async function annualReviewPost<T>(
  projectId: string,
  segment: string,
  payload: Record<string, unknown>,
): Promise<T> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/annual-review/${segment}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export interface SetObjectivesInput {
  year: number;
  objectives: Array<{
    id: string;
    title: string;
    description?: string;
    metric:
      | 'count_reduction'
      | 'count_increase'
      | 'percent_completion'
      | 'percent_reduction';
    baseline: number;
    target: number;
    currentValue?: number;
    deadline: string;
    ownerUid: string;
    status?:
      | 'planned'
      | 'in_progress'
      | 'on_track'
      | 'at_risk'
      | 'achieved'
      | 'missed';
    linkedActionIds?: string[];
    evidenceUrls?: string[];
  }>;
  analysis?: string;
}

export async function setAnnualReviewObjectives(
  projectId: string,
  input: SetObjectivesInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{
    ok: true;
    snapshot: AnnualReviewSnapshot;
  }>(projectId, 'objectives', input as unknown as Record<string, unknown>);
  return json.snapshot;
}

export interface AttachEvidenceInput {
  year: number;
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind?: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
}

export async function attachAnnualReviewEvidence(
  projectId: string,
  input: AttachEvidenceInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{
    ok: true;
    snapshot: AnnualReviewSnapshot;
  }>(projectId, 'evidence', input as unknown as Record<string, unknown>);
  return json.snapshot;
}

export interface ConcludeReviewInput {
  year: number;
  conclusion: string;
  signedOffByUid: string;
  signedOffByName: string;
}

export async function concludeAnnualReview(
  projectId: string,
  input: ConcludeReviewInput,
): Promise<AnnualReviewSnapshot> {
  const json = await annualReviewPost<{
    ok: true;
    snapshot: AnnualReviewSnapshot;
  }>(projectId, 'conclude', input as unknown as Record<string, unknown>);
  return json.snapshot;
}
