// Praeventio Guard — Checklist Builder client hook (4 stateless mutators).

import { auth } from '../services/firebase';
import type {
  ChecklistTemplate,
  ChecklistResponse,
  ChecklistValidationResult,
  FieldValue,
  SignatureRole,
} from '../services/checklistBuilder/checklistBuilder';

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

// ── 1. validate-response ────────────────────────────────────────────────

export interface ValidateChecklistInput {
  template: ChecklistTemplate;
  response: ChecklistResponse;
}
export interface ValidateChecklistResponse {
  result: ChecklistValidationResult;
}

export async function validateChecklistResponse(
  projectId: string,
  input: ValidateChecklistInput,
): Promise<ValidateChecklistResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/checklists/validate-response`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateChecklistResponse>(res);
}

// ── 2. rectify-field ────────────────────────────────────────────────────

export interface RectifyChecklistFieldInput {
  response: ChecklistResponse;
  fieldId: string;
  newValue: FieldValue;
  reason: string;
  now?: string;
}
export interface RectifyChecklistFieldResponse {
  response: ChecklistResponse;
}

export async function rectifyChecklistField(
  projectId: string,
  input: RectifyChecklistFieldInput,
): Promise<RectifyChecklistFieldResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/checklists/rectify-field`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RectifyChecklistFieldResponse>(res);
}

// ── 3. apply-signature ──────────────────────────────────────────────────

export interface ApplyChecklistSignatureInput {
  response: ChecklistResponse;
  role: SignatureRole;
  signaturePng: string;
  now?: string;
}
export interface ApplyChecklistSignatureResponse {
  response: ChecklistResponse;
}

export async function applyChecklistSignature(
  projectId: string,
  input: ApplyChecklistSignatureInput,
): Promise<ApplyChecklistSignatureResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/checklists/apply-signature`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ApplyChecklistSignatureResponse>(res);
}

// ── 4. lock-response ────────────────────────────────────────────────────

export interface LockChecklistResponseInput {
  response: ChecklistResponse;
  now?: string;
}
export interface LockChecklistResponseResponse {
  response: ChecklistResponse;
}

export async function lockChecklistResponse(
  projectId: string,
  input: LockChecklistResponseInput,
): Promise<LockChecklistResponseResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/checklists/lock-response`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<LockChecklistResponseResponse>(res);
}
