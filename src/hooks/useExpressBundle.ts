// Praeventio Guard — Auditoría Express Bundle client hook (1 mutator).

import { auth } from '../services/firebase';
import type {
  BundleDoc,
  BundleIper,
  BundleTraining,
  BundleEpp,
  BundleWorker,
  BundlePhoto,
  BundleAuditLog,
  BundleSummary,
} from '../services/audit/expressBundleBuilder';
import type { ComplianceTrafficLightResult } from '../services/compliance/trafficLightEngine';
import type { LegalRequirement } from '../services/legal/legalRuleEngine';

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

export interface BuildExpressBundleInput {
  projectName: string;
  generatedBy: { fullName: string; role: string };
  data: {
    documents: BundleDoc[];
    iperMatrix: BundleIper[];
    trainings: BundleTraining[];
    eppAssignments: BundleEpp[];
    activeWorkers: BundleWorker[];
    applicableProtocols: LegalRequirement[];
    photoEvidences: BundlePhoto[];
    recentAuditLogs: BundleAuditLog[];
    complianceSnapshot: ComplianceTrafficLightResult;
  };
}

export interface BuildExpressBundleResponse {
  manifest: {
    generatedAt: string;
    complianceSnapshot: ComplianceTrafficLightResult;
    summary: BundleSummary;
    /** Base64-encoded PDF (index). Caller decodes and pushes into the ZIP. */
    indexPdfBase64: string;
  };
}

export async function buildExpressBundle(
  projectId: string,
  input: BuildExpressBundleInput,
): Promise<BuildExpressBundleResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/express-bundle/build`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildExpressBundleResponse>(res);
}
