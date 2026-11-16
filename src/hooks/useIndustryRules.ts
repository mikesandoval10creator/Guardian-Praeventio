// Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules client hook.
//
// Wraps the HTTP surface at `src/server/routes/industryRules.ts`. Firebase
// ID-token auth, JSON-only. Mirrors `useLoneWorker.ts` shape so callers
// can compose `select` + `applicable-norms` + `required-epp` +
// `typical-hazards` in the wizard without re-implementing fetch glue.

import { apiAuthHeaders } from '../lib/apiAuth';
import {
  decodeRequiredEpp, decodeIndustryList, decodeApplicableNorms,
  decodeTypicalHazards, decodeIndustrySelection, type IndustryResponseDecoder,
  IndustryResponseValidationError,
} from '../lib/industryResponseValidation';
import type {
  IndustryPreset,
  PresetApplication,
} from '../services/industryRules/industryRuleEngine';

function authedFetch<T>(
  path: string,
  init: RequestInit,
  decode: IndustryResponseDecoder<T>,
): Promise<T> {
  // Bound the whole operation, including auth and JSON body consumption.
  // Explicit timers/listeners work in WebViews without AbortSignal.any/timeout.
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const caller = init.signal;
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caller?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', aborted);
      complete();
    };
    const cancel = () => controller.abort(new DOMException('Solicitud cancelada.', 'AbortError'));
    const aborted = () => finish(() => reject(controller.signal.reason));
    const timer = setTimeout(() => controller.abort(
      new DOMException('La solicitud demoró demasiado. Intenta nuevamente.', 'TimeoutError'),
    ), 15_000);
    controller.signal.addEventListener('abort', aborted, { once: true });
    caller?.addEventListener('abort', cancel, { once: true });
    if (caller?.aborted) {
      cancel();
      return;
    }
    void (async () => {
      const authHeaders = await apiAuthHeaders();
      if (controller.signal.aborted) return;
      const res = await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), ...authHeaders },
      });
      if (controller.signal.aborted) return;
      const result = await jsonResponse<T>(res, decode);
      if (!controller.signal.aborted) finish(() => resolve(result));
    })().catch((error: unknown) => finish(() => reject(error)));
  });
}

async function jsonResponse<T>(res: Response, decode: IndustryResponseDecoder<T>): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new IndustryResponseValidationError(res.status);
  }
  return decode(payload, res.status);
}

// ── 1. list ────────────────────────────────────────────────────────────

export interface IndustryListResponse {
  presets: Array<{ prefix: string; label: string }>;
}

export async function listIndustryPresetsRemote(
  projectId: string,
  signal?: AbortSignal,
): Promise<IndustryListResponse> {
  const res = await authedFetch<IndustryListResponse>(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/list`,
    { method: 'GET', signal },
    decodeIndustryList,
  );
  return res;
}

// ── 2. select ──────────────────────────────────────────────────────────

export interface SelectIndustryInput {
  industryPrefix: string;
}
export interface SelectIndustryResponse {
  application: PresetApplication;
  preset: IndustryPreset;
}

export async function selectIndustryRemote(
  projectId: string,
  input: SelectIndustryInput,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<SelectIndustryResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch<SelectIndustryResponse>(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/select`,
    { method: 'POST', body: JSON.stringify(input), headers, signal },
    decodeIndustrySelection,
  );
  return res;
}

// ── 3. applicable-norms ────────────────────────────────────────────────

export interface ApplicableNormsResponse {
  industryPrefix: string;
  applicableRegulations: string[];
  minsalProtocols: string[];
}

export async function fetchApplicableNorms(
  projectId: string,
  industryPrefix: string,
  signal?: AbortSignal,
): Promise<ApplicableNormsResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch<ApplicableNormsResponse>(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/applicable-norms?${qs}`,
    { method: 'GET', signal },
    decodeApplicableNorms,
  );
  return res;
}

// ── 4. required-epp ────────────────────────────────────────────────────

export interface RequiredEppResponse {
  industryPrefix: string;
  baseEpp: string[];
}

export async function fetchRequiredEpp(
  projectId: string,
  industryPrefix: string,
  signal?: AbortSignal,
): Promise<RequiredEppResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch<RequiredEppResponse>(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/required-epp?${qs}`,
    { method: 'GET', signal },
    decodeRequiredEpp,
  );
  return res;
}

// ── 5. typical-hazards ─────────────────────────────────────────────────

export interface TypicalHazardsResponse {
  industryPrefix: string;
  label: string;
  typicalRisks: string[];
  mandatoryDocuments: string[];
  mandatoryTrainings: string[];
}

export async function fetchTypicalHazards(
  projectId: string,
  industryPrefix: string,
  signal?: AbortSignal,
): Promise<TypicalHazardsResponse> {
  const qs = new URLSearchParams({ industryPrefix }).toString();
  const res = await authedFetch<TypicalHazardsResponse>(
    `/api/sprint-k/${encodeURIComponent(projectId)}/industry/typical-hazards?${qs}`,
    { method: 'GET', signal },
    decodeTypicalHazards,
  );
  return res;
}
