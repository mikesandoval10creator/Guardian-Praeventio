// Client half of the dispatch-summary audit trail.
//
// The human-readable summary itself stays in the browser: it can contain
// consented medical data and must NOT be persisted. This module sends only
// structured metadata to the server, which stamps the actor from the verified
// token and writes `medical_emergency_dispatch` to `audit_logs`.
//
// Failure is intentionally non-blocking: a broken audit sink must never stop
// the emergency panel from opening. The server logs/captures the failure and
// returns `audited:false`.

import { apiAuthHeader } from '../../lib/apiAuth';

export type DispatchAuditEventType =
  | 'manDown'
  | 'sos'
  | 'fall'
  | 'gas_alert'
  | 'evacuation'
  | 'cardiac'
  | 'other';

export interface DispatchAuditPayload {
  projectId: string;
  eventType: DispatchAuditEventType;
  regionCode: string;
  includedMedicalFields: string[];
  summaryLength: number;
  generatedAt: string;
}

export interface DispatchAuditDeps {
  authHeader?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * Returns true only when the server confirmed the audit write. Network,
 * auth and 4xx/5xx failures all return false; the caller must not surface
 * this as an emergency failure.
 */
export async function auditDispatchSummary(
  payload: DispatchAuditPayload,
  deps: DispatchAuditDeps = {},
): Promise<boolean> {
  let authHeader: string | null = null;
  try {
    authHeader = deps.authHeader
      ? await deps.authHeader()
      : await apiAuthHeader();
  } catch {
    return false;
  }
  if (!authHeader) return false;

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl('/api/emergency/dispatch-summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as {
      audited?: unknown;
    } | null;
    return body?.audited === true;
  } catch {
    return false;
  }
}
