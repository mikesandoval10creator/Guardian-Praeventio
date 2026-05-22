// Praeventio Guard — Soft-blocking requirement gate client hook (4 mutators).

import type {
  RequirementCheck,
  GateDecision,
  OverrideAuditEntry,
} from '../services/softBlocking/requirementGate';
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

// ── 1. evaluate-gate ───────────────────────────────────────────────────

export interface EvaluateGateInput { checks: RequirementCheck[] }
export interface EvaluateGateResponse { decision: GateDecision }

export async function evaluateGateRemote(
  projectId: string,
  input: EvaluateGateInput,
): Promise<EvaluateGateResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/soft-blocking/evaluate-gate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateGateResponse>(res);
}

// ── 2. validate-override (authorizingUid server-side) ──────────────────

export interface ValidateOverrideWireInput {
  decision: GateDecision;
  override: {
    reason: string;
    approvedAt: string;
    validUntil?: string;
  };
}
export interface ValidateOverrideResponse {
  result: { valid: boolean; error?: string };
}

export async function validateGateOverride(
  projectId: string,
  input: ValidateOverrideWireInput,
): Promise<ValidateOverrideResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/soft-blocking/validate-override`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateOverrideResponse>(res);
}

// ── 3. build-audit-entry ───────────────────────────────────────────────

export interface BuildAuditEntryWireInput {
  decision: GateDecision;
  override: {
    reason: string;
    approvedAt: string;
    validUntil?: string;
  };
  gateContext: {
    activityId: string;
    activityKind: string;
  };
}
export interface BuildAuditEntryResponse { entry: OverrideAuditEntry }

export async function buildGateOverrideAuditEntry(
  projectId: string,
  input: BuildAuditEntryWireInput,
): Promise<BuildAuditEntryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/soft-blocking/build-audit-entry`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildAuditEntryResponse>(res);
}

// ── 4. is-override-valid ───────────────────────────────────────────────

export interface IsOverrideValidInput {
  entry: OverrideAuditEntry;
  now?: string;
}
export interface IsOverrideValidResponse { valid: boolean }

export async function isGateOverrideStillValid(
  projectId: string,
  input: IsOverrideValidInput,
): Promise<IsOverrideValidResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/soft-blocking/is-override-valid`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<IsOverrideValidResponse>(res);
}
