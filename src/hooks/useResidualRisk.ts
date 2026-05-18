// Praeventio Guard — §296-301 Residual Risk hooks.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  RiskLevel as ResidualRiskLevel,
  RiskLikelihood as ResidualRiskLikelihood,
  RiskSeverity as ResidualRiskSeverity,
  AppliedControl as ResidualAppliedControl,
} from '../services/residualRisk/residualRiskEngine';

export type ResidualControlEffectiveness =
  ResidualAppliedControl['effectiveness'];

export interface StoredResidualRisk {
  id: string;
  hazard: string;
  category: string;
  riskKind: 'physical' | 'administrative';
  likelihood: ResidualRiskLikelihood;
  inherentSeverity: ResidualRiskSeverity;
  residualSeverity: ResidualRiskSeverity;
  currentControls: ResidualAppliedControl[];
  justification: string;
  initialScore: number;
  controlReduction: number;
  residualScore: number;
  initialLevel: ResidualRiskLevel;
  residualLevel: ResidualRiskLevel;
  requiresFormalAcceptance: boolean;
  nextReviewInDays: number;
  acceptance: {
    status: 'pending' | 'accepted';
    signedByUid: string | null;
    signedAt: string | null;
    reason: string | null;
  };
  createdAt: string;
  createdBy: string;
  isSuspicious: boolean;
  suspiciousReason: string | null;
}

export interface ResidualRisksResponse {
  risks: StoredResidualRisk[];
}

export function useResidualRisks(projectId: string | null) {
  return useEndpoint<ResidualRisksResponse>(
    projectId ? `/api/sprint-k/${projectId}/residual-risk` : null,
  );
}

export function useSuspiciousRisks(projectId: string | null) {
  return useEndpoint<ResidualRisksResponse>(
    projectId ? `/api/sprint-k/${projectId}/residual-risk/suspicious` : null,
  );
}

export interface ResidualRiskPayload {
  id: string;
  hazard: string;
  category: string;
  riskKind: 'physical' | 'administrative';
  likelihood: ResidualRiskLikelihood;
  inherentSeverity: ResidualRiskSeverity;
  residualSeverity: ResidualRiskSeverity;
  currentControls: Array<{
    controlId: string;
    effectiveness: ResidualControlEffectiveness;
  }>;
  justification: string;
}

export async function registerResidualRisk(
  projectId: string,
  payload: ResidualRiskPayload,
): Promise<{ ok: true; risk: StoredResidualRisk }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/residual-risk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { ok: true; risk: StoredResidualRisk };
}

export async function acceptResidualRisk(
  projectId: string,
  riskId: string,
  reason: string,
): Promise<void> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/residual-risk/${riskId}/accept`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}
