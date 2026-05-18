// Praeventio Guard — §104 Panel de Confianza de Datos hooks.
//
// Pareja cliente de `src/server/routes/dataConfidence.ts`. Migrado del
// monolito `useSprintK.ts` (2026-05-17) — Sprint K reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type DataConfidenceSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DataConfidenceDomain =
  | 'workers'
  | 'incidents'
  | 'training'
  | 'epp'
  | 'permits'
  | 'audits';

export interface DataConfidenceIssue {
  id: string;
  domain: DataConfidenceDomain;
  collection: string;
  severity: DataConfidenceSeverity;
  count: number;
  description: string;
  dismissed: boolean;
  dismissedByUid?: string | null;
  dismissedAt?: string | null;
}

export interface DataConfidenceDomainScore {
  name: DataConfidenceDomain;
  score: number;
  observed: number;
  expected: number;
  staleDays: number;
  detail: string;
}

export interface DataConfidenceTrendPoint {
  date: string;
  overallScore: number;
}

export interface DataConfidenceReportShape {
  generatedAt: string;
  overallScore: number;
  overallLevel: 'high' | 'medium' | 'low' | 'critical';
  dimensions: Array<{
    name: 'coverage' | 'freshness' | 'completeness' | 'traceability' | 'concordance';
    score: number;
    level: 'high' | 'medium' | 'low' | 'critical';
    detail: string;
    weight: number;
  }>;
  redFlags: string[];
  recommendations: string[];
}

export interface DataConfidenceSnapshot {
  generatedAt: string;
  report: DataConfidenceReportShape;
  domains: DataConfidenceDomainScore[];
  topIssues: DataConfidenceIssue[];
  trend: DataConfidenceTrendPoint[];
}

export interface DataConfidenceRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  target: number;
  domain: DataConfidenceDomain;
}

export interface DataConfidenceRecommendationsResponse {
  generatedAt: string;
  recommendations: DataConfidenceRecommendation[];
}

export function useDataConfidence(projectId: string | null) {
  return useEndpoint<DataConfidenceSnapshot>(
    projectId ? `/api/sprint-k/${projectId}/data-confidence` : null,
  );
}

export function useDataConfidenceRecommendations(projectId: string | null) {
  return useEndpoint<DataConfidenceRecommendationsResponse>(
    projectId ? `/api/sprint-k/${projectId}/data-confidence/recommendations` : null,
  );
}

export async function dismissDataIssue(
  projectId: string,
  issueId: string,
  reason?: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/data-confidence/dismiss/${encodeURIComponent(issueId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}
