// Praeventio Guard — §90-91 Suppliers hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type { ScoreBreakdown } from '../services/suppliers/supplierScoring';

export type SupplierRiskLevel = 'low' | 'medium' | 'high';
export type SupplierRiskFilter = SupplierRiskLevel | 'all';
export type SupplierTrend = 'improving' | 'stable' | 'worsening';
export type SupplierIncidentSeverity = 'near_miss' | 'incident';

export interface SupplierIncidentRecord {
  id: string;
  occurredAt: string;
  severity: SupplierIncidentSeverity;
  description: string;
  recordedByUid: string;
}

export interface SupplierAuditRecord {
  id: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
  recordedByUid: string;
}

export interface SupplierView {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: SupplierRiskLevel;
  trend: SupplierTrend;
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
}

export interface SuppliersResponse {
  suppliers: SupplierView[];
  total: number;
}

export interface SupplierRankingEntry extends SupplierView {
  rank: number;
  breakdown: ScoreBreakdown;
}

export interface SupplierRankingResponse {
  ranking: SupplierRankingEntry[];
  total: number;
}

export function useSuppliers(
  projectId: string | null,
  opts: { riskLevel?: SupplierRiskFilter } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.riskLevel && opts.riskLevel !== 'all') {
      qs.set('riskLevel', opts.riskLevel);
    } else if (opts.riskLevel === 'all') {
      qs.set('riskLevel', 'all');
    }
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/suppliers${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<SuppliersResponse>(path);
}

export function useSupplierRanking(projectId: string | null) {
  return useEndpoint<SupplierRankingResponse>(
    projectId
      ? `/api/sprint-k/${projectId}/suppliers/ranking`
      : null,
  );
}

export interface RegisterSupplierPayload {
  id?: string;
  name: string;
  taxId: string;
  services: string[];
  criticalRoles?: string[];
  active?: boolean;
}

export async function registerSupplier(
  projectId: string,
  payload: RegisterSupplierPayload,
): Promise<SupplierView> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/suppliers`, {
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
  const data = (await res.json()) as { ok: true; supplier: SupplierView };
  return data.supplier;
}

export interface RecordSupplierIncidentPayload {
  id?: string;
  occurredAt: string;
  severity: SupplierIncidentSeverity;
  description: string;
}

export async function recordSupplierIncident(
  projectId: string,
  supplierId: string,
  payload: RecordSupplierIncidentPayload,
): Promise<SupplierIncidentRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/suppliers/${supplierId}/incidents`,
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
  const data = (await res.json()) as {
    ok: true;
    incident: SupplierIncidentRecord;
  };
  return data.incident;
}

export interface RecordSupplierAuditPayload {
  id?: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
}

export async function recordSupplierAudit(
  projectId: string,
  supplierId: string,
  payload: RecordSupplierAuditPayload,
): Promise<SupplierAuditRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/suppliers/${supplierId}/audits`,
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
  const data = (await res.json()) as {
    ok: true;
    audit: SupplierAuditRecord;
  };
  return data.audit;
}
