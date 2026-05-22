// Praeventio Guard — External Audit Portal client hook (6 mutators).

import type {
  AuditPortalConfig,
  AuditModule,
  AuditorAffiliation,
  PortalStatus,
  AccessRequest,
  AccessDecision,
  PortalAccessLog,
  PortalUsageSummary,
} from '../services/auditPortal/externalAuditPortal';
import { apiAuthHeaders } from '../lib/apiAuth';

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. create-portal — createdByUid server-side ────────────────────────

export interface CreatePortalWireInput {
  id: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  scopeProjectIds: string[];
  scopeModules: AuditModule[];
  ttlDays: number;
  internalNotes?: string;
  now?: string;
}
export interface CreatePortalResponse { portal: AuditPortalConfig }

export async function createAuditPortal(
  projectId: string,
  input: CreatePortalWireInput,
): Promise<CreatePortalResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/create-portal`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CreatePortalResponse>(res);
}

// ── 2. derive-status ───────────────────────────────────────────────────

export interface DerivePortalStatusInput {
  portal: AuditPortalConfig;
  now?: string;
}
export interface DerivePortalStatusResponse { status: PortalStatus }

export async function deriveAuditPortalStatus(
  projectId: string,
  input: DerivePortalStatusInput,
): Promise<DerivePortalStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/derive-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DerivePortalStatusResponse>(res);
}

// ── 3. revoke — revokedByUid server-side ───────────────────────────────

export interface RevokePortalInput {
  portal: AuditPortalConfig;
  reason: string;
  now?: string;
}
export interface RevokePortalResponse { portal: AuditPortalConfig }

export async function revokeAuditPortal(
  projectId: string,
  input: RevokePortalInput,
): Promise<RevokePortalResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/revoke`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RevokePortalResponse>(res);
}

// ── 4. check-access ────────────────────────────────────────────────────

export interface CheckAccessInput {
  portal: AuditPortalConfig | null;
  request: AccessRequest;
  now?: string;
}
export interface CheckAccessResponse { decision: AccessDecision }

export async function checkAuditPortalAccess(
  projectId: string,
  input: CheckAccessInput,
): Promise<CheckAccessResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/check-access`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CheckAccessResponse>(res);
}

// ── 5. summarize-usage ─────────────────────────────────────────────────

export interface SummarizeUsageInput {
  portal: AuditPortalConfig;
  logs: PortalAccessLog[];
}
export interface SummarizeUsageResponse { summary: PortalUsageSummary }

export async function summarizeAuditPortalUsage(
  projectId: string,
  input: SummarizeUsageInput,
): Promise<SummarizeUsageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/summarize-usage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeUsageResponse>(res);
}

// ── 6. generate-token ──────────────────────────────────────────────────

export interface GenerateTokenResponse { token: string }

export async function generateAuditPortalToken(
  projectId: string,
): Promise<GenerateTokenResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-portal/generate-token`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<GenerateTokenResponse>(res);
}
