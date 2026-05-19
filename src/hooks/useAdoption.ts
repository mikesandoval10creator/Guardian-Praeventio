// Praeventio Guard — Adoption Analytics client hook (4 mutators).

import { auth } from '../services/firebase';
import type {
  ModuleAdoptionReport,
  ModuleUsageKind,
  FunnelReport,
  ChurnRiskReport,
  FirstValueEvent,
  FirstValueReport,
} from '../services/adoption/adoptionAnalytics';

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

/**
 * Wire shape for a TenantUsageSnapshot. The engine uses Set<ModuleUsageKind>
 * for activeModules; on the wire we send a string[] and the server converts.
 */
export interface TenantUsageSnapshotWire {
  tenantId: string;
  snapshotAt: string;
  daysSinceSignup: number;
  activeModules: ModuleUsageKind[];
  events30d: number;
  activeWorkers: number;
  activeProjects: number;
  hasPaidPlan: boolean;
}

// ── 1. module-adoption ─────────────────────────────────────────────────

export interface SnapshotsInput {
  snapshots: TenantUsageSnapshotWire[];
}
export interface ModuleAdoptionResponse {
  report: ModuleAdoptionReport;
}

export async function buildAdoptionModuleReport(
  projectId: string,
  input: SnapshotsInput,
): Promise<ModuleAdoptionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/adoption/module-adoption`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ModuleAdoptionResponse>(res);
}

// ── 2. funnel ──────────────────────────────────────────────────────────

export interface FunnelResponse {
  report: FunnelReport;
}

export async function buildAdoptionFunnel(
  projectId: string,
  input: SnapshotsInput,
): Promise<FunnelResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/adoption/funnel`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FunnelResponse>(res);
}

// ── 3. churn-risk ──────────────────────────────────────────────────────

export interface ChurnRiskInput {
  snapshot: TenantUsageSnapshotWire;
}
export interface ChurnRiskResponse {
  report: ChurnRiskReport;
}

export async function assessAdoptionChurnRisk(
  projectId: string,
  input: ChurnRiskInput,
): Promise<ChurnRiskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/adoption/churn-risk`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ChurnRiskResponse>(res);
}

// ── 4. first-value ─────────────────────────────────────────────────────

export interface FirstValueInput {
  events: FirstValueEvent[];
  nowIso?: string;
}
export interface FirstValueResponse {
  report: FirstValueReport;
}

export async function buildAdoptionFirstValueReport(
  projectId: string,
  input: FirstValueInput,
): Promise<FirstValueResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/adoption/first-value`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FirstValueResponse>(res);
}
