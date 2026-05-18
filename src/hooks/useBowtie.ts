// Praeventio Guard — Bowtie Risk Analysis client hook (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  BarrierType,
  BowtieDiagram,
  Consequence,
  HazardousEvent,
  Threat,
} from '../services/bowtie/bowtieAnalysisBuilder';

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
