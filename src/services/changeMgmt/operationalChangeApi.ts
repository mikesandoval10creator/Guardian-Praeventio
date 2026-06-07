// Praeventio Guard — MOC client API (B13).
//
// Thin POST clients for the audited `/api/sprint-k/:projectId/moc/*` endpoints.
// The page used to mutate via a client Firestore store (operationalChangeStore)
// with NO audit trail and a client-side role heuristic. These route every MOC
// transition through the server, which stamps the actor identity, derives the
// approval role from the VERIFIED token, and writes audit_logs (CLAUDE.md #3).
// Reads stay on the live `subscribeChanges` subscription.

import { apiAuthHeaders } from '../../lib/apiAuth';
import type {
  OperationalChange,
  ChangeKind,
  ChangeImpact,
} from './operationalChangeService';

async function mocPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(b.message ?? b.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export interface DeclareChangeApiInput {
  kind: ChangeKind;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  rationale: string;
  impact: ChangeImpact;
  affectedWorkerUids: string[];
  declaredByRole: string;
  effectiveFrom: string;
  referenceDocumentId?: string;
}

const base = (projectId: string) => `/api/sprint-k/${projectId}/moc`;

export function declareChangeApi(
  projectId: string,
  input: DeclareChangeApiInput,
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/declare`, input);
}

export function acknowledgeChangeApi(
  projectId: string,
  mocId: string,
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/acknowledge`, {});
}

export function submitChangeApi(
  projectId: string,
  mocId: string,
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/submit-for-review`, {});
}

export function decideChangeApi(
  projectId: string,
  mocId: string,
  input: { decision: 'approved' | 'rejected'; comment: string },
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/decide`, input);
}

export function activateChangeApi(
  projectId: string,
  mocId: string,
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/activate`, {});
}

export function verifyChangeApi(
  projectId: string,
  mocId: string,
  input: { effective: boolean; observations: string },
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/verify`, input);
}

export function revertChangeApi(
  projectId: string,
  mocId: string,
  input: { reason: string },
): Promise<{ change: OperationalChange }> {
  return mocPost(`${base(projectId)}/${mocId}/revert`, input);
}
