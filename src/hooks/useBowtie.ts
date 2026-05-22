// Praeventio Guard — Bowtie Risk Analysis client hook (3 stateless mutators).

import type {
  BarrierType,
  BowtieDiagram,
  Consequence,
  HazardousEvent,
  Threat,
} from '../services/bowtie/bowtieAnalysisBuilder';
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

// ── 1. build ────────────────────────────────────────────────────────────

export interface BuildBowtieClientInput {
  diagramId: string;
  hazardousEvent: HazardousEvent;
  threats: Threat[];
  consequences: Consequence[];
  now?: string;
}
export interface BuildBowtieResponse {
  diagram: BowtieDiagram;
}

export async function buildBowtieDiagram(
  projectId: string,
  input: BuildBowtieClientInput,
): Promise<BuildBowtieResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/bowtie/build`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildBowtieResponse>(res);
}

// ── 2. list-unprotected-threats ─────────────────────────────────────────

export interface ListUnprotectedThreatsInput {
  diagram: BowtieDiagram;
}
export interface ListUnprotectedThreatsResponse {
  threats: Threat[];
}

export async function listUnprotectedBowtieThreats(
  projectId: string,
  input: ListUnprotectedThreatsInput,
): Promise<ListUnprotectedThreatsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/bowtie/list-unprotected-threats`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ListUnprotectedThreatsResponse>(res);
}

// ── 3. recommend-next-barrier ───────────────────────────────────────────

export interface RecommendNextBarrierInput {
  threat: Threat;
}
export interface RecommendNextBarrierResponse {
  barrierType: BarrierType;
}

export async function recommendNextBowtieBarrier(
  projectId: string,
  input: RecommendNextBarrierInput,
): Promise<RecommendNextBarrierResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/bowtie/recommend-next-barrier`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecommendNextBarrierResponse>(res);
}
