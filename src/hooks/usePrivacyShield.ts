// Praeventio Guard — Privacy Shield client hook (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  ClassificationReport,
  ComplianceGap,
  DataField,
  ExpirableRecord,
  RetentionReaperResult,
} from '../services/privacyShield/piiClassifier';

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

// ── 1. classify-field ──────────────────────────────────────────────────

export interface ClassifyFieldInput {
  field: DataField;
}
export interface ClassifyFieldResponse {
  report: ClassificationReport;
}

export async function classifyPiiField(
  projectId: string,
  input: ClassifyFieldInput,
): Promise<ClassifyFieldResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy-shield/classify-field`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ClassifyFieldResponse>(res);
}

// ── 2. detect-gaps ─────────────────────────────────────────────────────

export interface DetectGapsInput {
  fields: DataField[];
}
export interface DetectGapsResponse {
  gaps: ComplianceGap[];
}

export async function detectPiiComplianceGaps(
  projectId: string,
  input: DetectGapsInput,
): Promise<DetectGapsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy-shield/detect-gaps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectGapsResponse>(res);
}

// ── 3. reap-expired ────────────────────────────────────────────────────

export interface ReapExpiredInput {
  records: ExpirableRecord[];
  nowIso?: string;
}
export interface ReapExpiredResponse {
  result: RetentionReaperResult;
}

export async function reapExpiredPiiRecords(
  projectId: string,
  input: ReapExpiredInput,
): Promise<ReapExpiredResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy-shield/reap-expired`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ReapExpiredResponse>(res);
}
