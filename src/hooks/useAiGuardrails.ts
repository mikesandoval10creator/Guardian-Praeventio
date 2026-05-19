// Praeventio Guard — AI Guardrails client hook (10 mutators).

import { auth } from '../services/firebase';
import type {
  VersionedPrompt,
  CitationPolicy,
} from '../services/aiGuardrails/versionedPrompts';
import type {
  CitationSource,
  CitationValidationResult,
} from '../services/aiGuardrails/citationValidator';
import type {
  HallucinationGuardResult,
} from '../services/aiGuardrails/hallucinationGuard';

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── prompts ────────────────────────────────────────────────────────────

export interface GetPromptInput {
  promptId: string;
  version: string;
}
export interface PromptResponse {
  prompt: VersionedPrompt;
}

export async function getAiGuardrailsPrompt(
  projectId: string,
  input: GetPromptInput,
): Promise<PromptResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/get-prompt`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PromptResponse>(res);
}

export async function getAiGuardrailsLatestVersion(
  projectId: string,
  input: { promptId: string },
): Promise<PromptResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/get-latest-version`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PromptResponse>(res);
}

export interface VersionsResponse {
  versions: string[];
}

export async function listAiGuardrailsVersions(
  projectId: string,
  input: { promptId: string },
): Promise<VersionsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/list-versions`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<VersionsResponse>(res);
}

export interface PromptIdsResponse {
  ids: string[];
}

export async function listAiGuardrailsPromptIds(
  projectId: string,
): Promise<PromptIdsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/list-prompt-ids`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<PromptIdsResponse>(res);
}

export interface CatalogResponse {
  catalog: VersionedPrompt[];
}

export async function getAiGuardrailsCatalog(
  projectId: string,
): Promise<CatalogResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/get-catalog`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<CatalogResponse>(res);
}

// ── placeholder rendering ──────────────────────────────────────────────

export interface RenderPromptBodyInput {
  body: string;
  inputs: Record<string, string | number | boolean>;
}
export interface RenderPromptBodyResponse {
  rendered: string;
}

export async function renderAiGuardrailsPromptBody(
  projectId: string,
  input: RenderPromptBodyInput,
): Promise<RenderPromptBodyResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/render-prompt-body`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RenderPromptBodyResponse>(res);
}

export interface FindUnresolvedInput {
  rendered: string;
}
export interface FindUnresolvedResponse {
  unresolved: string[];
}

export async function findAiGuardrailsUnresolvedPlaceholders(
  projectId: string,
  input: FindUnresolvedInput,
): Promise<FindUnresolvedResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/find-unresolved-placeholders`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindUnresolvedResponse>(res);
}

// ── citations ──────────────────────────────────────────────────────────

export interface ExtractCitationsInput {
  text: string;
}
export interface ExtractCitationsResponse {
  citations: Array<{ index: number; position: number }>;
}

export async function extractAiGuardrailsCitations(
  projectId: string,
  input: ExtractCitationsInput,
): Promise<ExtractCitationsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/extract-citations`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ExtractCitationsResponse>(res);
}

export interface ValidateResponseInput {
  text: string;
  sources: CitationSource[];
  policy: CitationPolicy;
}
export interface ValidateResponseResponse {
  result: CitationValidationResult;
}

export async function validateAiGuardrailsResponse(
  projectId: string,
  input: ValidateResponseInput,
): Promise<ValidateResponseResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/validate-response`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateResponseResponse>(res);
}

// ── hallucination guard ────────────────────────────────────────────────

export interface GuardHallucinationInput {
  text: string;
}
export interface GuardHallucinationResponse {
  result: HallucinationGuardResult;
}

export async function guardAiGuardrailsHallucination(
  projectId: string,
  input: GuardHallucinationInput,
): Promise<GuardHallucinationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ai-guardrails/guard-hallucination`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<GuardHallucinationResponse>(res);
}
