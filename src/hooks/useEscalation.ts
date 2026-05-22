// Praeventio Guard — Escalation + SLA Engine client hook (5 mutators).

import type {
  WorkflowItem,
  WorkflowItemKind,
  SeverityLevel,
  EscalationChain,
  EscalationDecision,
  SlaAssessment,
  BatchEscalationResult,
} from '../services/escalation/escalationSlaEngine';
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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Engine EscalationOptions uses Set<string>; wire form is string[].
 */
export interface EscalationOptionsWire {
  unavailableUids?: string[];
  severityJustIncreased?: boolean;
  manualEscalation?: boolean;
}

// ── 1. sla-minutes ─────────────────────────────────────────────────────

export interface SlaMinutesInput {
  kind: WorkflowItemKind;
  severity: SeverityLevel;
}
export interface SlaMinutesResponse {
  slaMinutes: number;
}

export async function getEscalationSlaMinutes(
  projectId: string,
  input: SlaMinutesInput,
): Promise<SlaMinutesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/escalation/sla-minutes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SlaMinutesResponse>(res);
}

// ── 2. assess-sla ──────────────────────────────────────────────────────

export interface AssessSlaInput {
  item: WorkflowItem;
  now?: string;
}
export interface AssessSlaResponse {
  assessment: SlaAssessment;
}

export async function assessEscalationSla(
  projectId: string,
  input: AssessSlaInput,
): Promise<AssessSlaResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/escalation/assess-sla`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessSlaResponse>(res);
}

// ── 3. decide ──────────────────────────────────────────────────────────

export interface DecideEscalationInput {
  item: WorkflowItem;
  chain: EscalationChain;
  options?: EscalationOptionsWire;
  now?: string;
}
export interface DecideEscalationResponse {
  decision: EscalationDecision;
}

export async function decideEscalationRemote(
  projectId: string,
  input: DecideEscalationInput,
): Promise<DecideEscalationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/escalation/decide`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DecideEscalationResponse>(res);
}

// ── 4. apply ───────────────────────────────────────────────────────────

export interface ApplyEscalationInput {
  item: WorkflowItem;
  decision: EscalationDecision;
  now?: string;
}
export interface ApplyEscalationResponse {
  item: WorkflowItem;
}

export async function applyEscalationRemote(
  projectId: string,
  input: ApplyEscalationInput,
): Promise<ApplyEscalationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/escalation/apply`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ApplyEscalationResponse>(res);
}

// ── 5. process-batch ───────────────────────────────────────────────────

export interface ProcessBatchInput {
  items: WorkflowItem[];
  chain: EscalationChain;
  options?: EscalationOptionsWire;
  now?: string;
}
export interface ProcessBatchResponse {
  result: BatchEscalationResult;
}

export async function processEscalationBatch(
  projectId: string,
  input: ProcessBatchInput,
): Promise<ProcessBatchResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/escalation/process-batch`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ProcessBatchResponse>(res);
}
