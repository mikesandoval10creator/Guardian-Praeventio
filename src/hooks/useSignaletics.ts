// Praeventio Guard — Signaletics client hook (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  EvacuationNode,
  EvacuationPath,
  SignageZoneAudit,
  SiteRanking,
  ZoneAuditResult,
} from '../services/signaletics/signageValidator';

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

export interface AuditZoneResponse {
  result: ZoneAuditResult;
}

export async function auditZoneSignage(
  projectId: string,
  audit: SignageZoneAudit,
): Promise<AuditZoneResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/signaletics/audit-zone`,
    { method: 'POST', body: JSON.stringify(audit) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as AuditZoneResponse;
}

export interface RankSiteResponse {
  ranking: SiteRanking;
}

export async function rankSiteSignage(
  projectId: string,
  audits: ZoneAuditResult[],
): Promise<RankSiteResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/signaletics/rank-site`,
    { method: 'POST', body: JSON.stringify({ audits }) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as RankSiteResponse;
}

export interface FindEvacPathsInput {
  nodes: EvacuationNode[];
  startId: string;
  riskyZones?: string[];
  maxRoutes?: number;
}

export interface FindEvacPathsResponse {
  paths: EvacuationPath[];
}

export async function findEvacuationPaths(
  projectId: string,
  input: FindEvacPathsInput,
): Promise<FindEvacPathsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/signaletics/evacuation-paths`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as FindEvacPathsResponse;
}
