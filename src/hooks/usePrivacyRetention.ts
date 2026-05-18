// Praeventio Guard — Privacy Retention client hook (4 stateless mutators).

import { auth } from '../services/firebase';
import type {
  ConsentArtifact,
  ConsentCheck,
  DataCategory,
  DataRecord,
  PiiSensitivity,
  RetentionDecision,
  RetentionRule,
} from '../services/privacyRetention/dataRetentionPolicy';

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

// ── 1. decide-retention ────────────────────────────────────────────────

export interface DecideRetentionInput {
  record: DataRecord;
  options?: {
    now?: string;
    customRules?: RetentionRule[];
  };
}
export interface DecideRetentionResponse {
  decision: RetentionDecision;
}

export async function decideRecordRetention(
  projectId: string,
  input: DecideRetentionInput,
): Promise<DecideRetentionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy/decide-retention`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DecideRetentionResponse>(res);
}

// ── 2. check-consent ───────────────────────────────────────────────────

export interface CheckConsentRequestInput {
  artifact: ConsentArtifact | null;
  options: {
    now?: string;
    currentLegalTextVersion: string;
    graceDays?: number;
  };
}
export interface CheckConsentResponse {
  check: ConsentCheck;
}

export async function checkConsentArtifact(
  projectId: string,
  input: CheckConsentRequestInput,
): Promise<CheckConsentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy/check-consent`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CheckConsentResponse>(res);
}

// ── 3. pii-bucket ──────────────────────────────────────────────────────

export interface PiiBucketInput {
  sensitivity: PiiSensitivity;
}
export interface PiiBucketResponse {
  bucket: {
    storagePathPrefix: string;
    firestoreCollectionPrefix: string;
    requiresMedicalRoleClaim: boolean;
  };
}

export async function getPiiBucket(
  projectId: string,
  input: PiiBucketInput,
): Promise<PiiBucketResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy/pii-bucket`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PiiBucketResponse>(res);
}

// ── 4. sensitivity-for-category ────────────────────────────────────────

export interface SensitivityForCategoryInput {
  category: DataCategory;
}
export interface SensitivityForCategoryResponse {
  sensitivity: PiiSensitivity;
}

export async function getSensitivityForCategory(
  projectId: string,
  input: SensitivityForCategoryInput,
): Promise<SensitivityForCategoryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/privacy/sensitivity-for-category`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SensitivityForCategoryResponse>(res);
}
