// Praeventio Guard — Protocols (IPER + PREXOR + TMERT + PLANESI) client hook.

import type { IperInput, IperResult } from '../services/protocols/iper';
import type {
  PrexorMeasurement,
  PrexorResult,
} from '../services/protocols/prexor';
import type { TmertInput, TmertResult } from '../services/protocols/tmert';
import type { PlanesiInput, PlanesiResult } from '../services/protocols/planesi';
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

// ── 1. iper ────────────────────────────────────────────────────────────

export interface CalculateIperInput { input: IperInput }
export interface CalculateIperResponse { result: IperResult }

export async function calculateIperRemote(
  projectId: string,
  input: CalculateIperInput,
): Promise<CalculateIperResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/iper`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculateIperResponse>(res);
}

// ── 2. prexor ──────────────────────────────────────────────────────────

export interface CalculatePrexorInput { measurements: PrexorMeasurement[] }
export interface CalculatePrexorResponse { result: PrexorResult }

export async function calculatePrexorRemote(
  projectId: string,
  input: CalculatePrexorInput,
): Promise<CalculatePrexorResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/prexor`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculatePrexorResponse>(res);
}

// ── 3. tmert ───────────────────────────────────────────────────────────

export interface EvaluateTmertInput { input: TmertInput }
export interface EvaluateTmertResponse { result: TmertResult }

export async function evaluateTmertRemote(
  projectId: string,
  input: EvaluateTmertInput,
): Promise<EvaluateTmertResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/tmert`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateTmertResponse>(res);
}

// ── 4. planesi ─────────────────────────────────────────────────────────

export interface EvaluatePlanesiInput { input: PlanesiInput }
export interface EvaluatePlanesiResponse { result: PlanesiResult }

export async function evaluatePlanesiRemote(
  projectId: string,
  input: EvaluatePlanesiInput,
): Promise<EvaluatePlanesiResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/planesi`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluatePlanesiResponse>(res);
}

// ── 5. assessment persistence (B-protocols) ────────────────────────────
//
// The server recomputes the verdict from the raw inputs (a client-supplied
// result is never trusted), stamps the evaluator uid from the verified
// token, persists into `protocol_assessments` (server-only collection) and
// emits the audit_logs row. See src/server/routes/protocols.ts.

export type ProtocolAssessmentKind = 'TMERT' | 'PREXOR' | 'PLANESI';

export interface ProtocolAssessment {
  id: string;
  projectId: string;
  protocol: ProtocolAssessmentKind;
  taskName: string;
  workerId: string | null;
  inputs: unknown;
  result: TmertResult | PrexorResult | PlanesiResult;
  computedAt: string;
  metadata: { author: string; signedAt: string | null };
}

export interface RecordTmertAssessmentInput {
  input: TmertInput;
  taskName: string;
  workerId?: string;
}
export interface RecordTmertAssessmentResponse {
  id: string;
  result: TmertResult;
}

export async function recordTmertAssessment(
  projectId: string,
  input: RecordTmertAssessmentInput,
): Promise<RecordTmertAssessmentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/tmert/assessments`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordTmertAssessmentResponse>(res);
}

export interface RecordPrexorAssessmentInput {
  measurements: PrexorMeasurement[];
  taskName: string;
  workerId?: string;
}
export interface RecordPrexorAssessmentResponse {
  id: string;
  result: PrexorResult;
}

export async function recordPrexorAssessment(
  projectId: string,
  input: RecordPrexorAssessmentInput,
): Promise<RecordPrexorAssessmentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/prexor/assessments`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordPrexorAssessmentResponse>(res);
}

export interface RecordPlanesiAssessmentInput {
  input: PlanesiInput;
  taskName: string;
  workerId?: string;
}
export interface RecordPlanesiAssessmentResponse {
  id: string;
  result: PlanesiResult;
}

export async function recordPlanesiAssessment(
  projectId: string,
  input: RecordPlanesiAssessmentInput,
): Promise<RecordPlanesiAssessmentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/planesi/assessments`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordPlanesiAssessmentResponse>(res);
}

export interface ListProtocolAssessmentsResponse {
  assessments: ProtocolAssessment[];
}

export async function listProtocolAssessments(
  projectId: string,
  protocol?: ProtocolAssessmentKind,
): Promise<ListProtocolAssessmentsResponse> {
  const qs = protocol ? `?protocol=${protocol}` : '';
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/assessments${qs}`,
    { method: 'GET' },
  );
  return json<ListProtocolAssessmentsResponse>(res);
}
