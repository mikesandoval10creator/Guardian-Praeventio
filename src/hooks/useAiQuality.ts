// Praeventio Guard — AI Quality Audit client hook (6 stateless mutators).

import { auth } from '../services/firebase';
import type {
  AiAuditEntry,
  AiQualitySummary,
  AiResponseKind,
  AiSource,
  HumanDecision,
} from '../services/aiQuality/aiAuditLog';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

// ── 1. log-response ────────────────────────────────────────────────────

export interface LogAiResponseInput {
  id: string;
  source: AiSource;
  kind: AiResponseKind;
  prompt: string;
  response: string;
  contextDigest?: string;
  recipientRole: string;
  now?: string;
}
export interface LogAiResponseResponse {
  entry: AiAuditEntry;
}

export async function logAiResponseRemote(
  projectId: string,
  input: LogAiResponseInput,
): Promise<LogAiResponseResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/log-response`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<LogAiResponseResponse>(res);
}

// ── 2. assert-human-gated ──────────────────────────────────────────────

export interface AssertHumanGatedInput {
  kind: AiResponseKind;
  humanDecision?: HumanDecision;
}
export interface AssertHumanGatedResponse {
  ok: true;
}

export async function assertAiActionHumanGated(
  projectId: string,
  input: AssertHumanGatedInput,
): Promise<AssertHumanGatedResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/assert-human-gated`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssertHumanGatedResponse>(res);
}

// ── 3. record-human-decision ───────────────────────────────────────────

export interface RecordHumanDecisionInput {
  entry: AiAuditEntry;
  decision: HumanDecision;
}
export interface RecordHumanDecisionResponse {
  entry: AiAuditEntry;
}

export async function recordHumanDecisionRemote(
  projectId: string,
  input: RecordHumanDecisionInput,
): Promise<RecordHumanDecisionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/record-human-decision`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordHumanDecisionResponse>(res);
}

// ── 4. record-override ─────────────────────────────────────────────────

export interface RecordOverrideInput {
  entry: AiAuditEntry;
  overrideReason: string;
  now?: string;
}
export interface RecordOverrideResponse {
  entry: AiAuditEntry;
}

export async function recordAiOverrideRemote(
  projectId: string,
  input: RecordOverrideInput,
): Promise<RecordOverrideResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/record-override`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordOverrideResponse>(res);
}

// ── 5. rate-entry ──────────────────────────────────────────────────────

export interface RateEntryInput {
  entry: AiAuditEntry;
  rating: {
    verdict: 'useful' | 'not_useful' | 'missing_context' | 'incorrect';
    reviewedAt?: string;
    reviewerNote?: string;
  };
}
export interface RateEntryResponse {
  entry: AiAuditEntry;
}

export async function rateAiEntryRemote(
  projectId: string,
  input: RateEntryInput,
): Promise<RateEntryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/rate-entry`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RateEntryResponse>(res);
}

// ── 6. summarize ───────────────────────────────────────────────────────

export interface SummarizeAiQualityInput {
  entries: AiAuditEntry[];
}
export interface SummarizeAiQualityResponse {
  summary: AiQualitySummary;
}

export async function summarizeAiQualityRemote(
  projectId: string,
  input: SummarizeAiQualityInput,
): Promise<SummarizeAiQualityResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-quality/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeAiQualityResponse>(res);
}
