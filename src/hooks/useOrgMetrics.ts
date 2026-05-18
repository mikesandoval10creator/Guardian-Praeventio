// Praeventio Guard — Organizational Metrics client hook (5 mutators).

import { auth } from '../services/firebase';
import type {
  ModuleSignal,
  SiloReport,
  AdminFlowSample,
  FrictionReport,
  ClosedGap,
  ClosureTimeReport,
  GapHistory,
  ChronicGap,
  PressureSignals,
  PressureReport,
} from '../services/orgMetrics/organizationalMetrics';

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

// ── 1. detect-silos ────────────────────────────────────────────────────

export interface DetectSilosInput {
  signals: ModuleSignal[];
}
export interface DetectSilosResponse {
  reports: SiloReport[];
}

export async function detectOrgSilos(
  projectId: string,
  input: DetectSilosInput,
): Promise<DetectSilosResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/org-metrics/detect-silos`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectSilosResponse>(res);
}

// ── 2. build-friction-report ───────────────────────────────────────────

export interface BuildFrictionInput {
  samples: AdminFlowSample[];
}
export interface BuildFrictionResponse {
  reports: FrictionReport[];
}

export async function buildOrgFrictionReport(
  projectId: string,
  input: BuildFrictionInput,
): Promise<BuildFrictionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/org-metrics/build-friction-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildFrictionResponse>(res);
}

// ── 3. build-closure-time-report ───────────────────────────────────────

export interface BuildClosureInput {
  gaps: ClosedGap[];
}
export interface BuildClosureResponse {
  reports: ClosureTimeReport[];
}

export async function buildOrgClosureTimeReport(
  projectId: string,
  input: BuildClosureInput,
): Promise<BuildClosureResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/org-metrics/build-closure-time-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildClosureResponse>(res);
}

// ── 4. detect-chronic-gaps ─────────────────────────────────────────────

export interface DetectChronicInput {
  history: GapHistory[];
}
export interface DetectChronicResponse {
  reports: ChronicGap[];
}

export async function detectOrgChronicGaps(
  projectId: string,
  input: DetectChronicInput,
): Promise<DetectChronicResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/org-metrics/detect-chronic-gaps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectChronicResponse>(res);
}

// ── 5. compute-operational-pressure ────────────────────────────────────

export interface ComputePressureInput {
  signals: PressureSignals;
}
export interface ComputePressureResponse {
  report: PressureReport;
}

export async function computeOrgOperationalPressure(
  projectId: string,
  input: ComputePressureInput,
): Promise<ComputePressureResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/org-metrics/compute-operational-pressure`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputePressureResponse>(res);
}
