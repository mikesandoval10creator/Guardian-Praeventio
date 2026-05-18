// Praeventio Guard — Universal expiration scanner client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  ExpirableItem,
  ScanResult,
  ScanOptions,
  ExpirationOutcome,
  ExpirationKind,
  ExpirationSeverity,
} from '../services/expirations/expirationScanner';

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

/**
 * Wire shape for ScanOptions. The engine's `now` is `Date`; on the wire
 * we send an ISO string and the server constructs the Date.
 */
export interface ScanOptionsWire {
  now?: string;
  warningWindowDays?: number;
  criticalWindowDays?: number;
}

// ── 1. scan ────────────────────────────────────────────────────────────

export interface ScanExpirationsInput {
  items: ExpirableItem[];
  opts?: ScanOptionsWire;
}
export interface ScanExpirationsResponse {
  result: ScanResult;
}

export async function scanExpirationsRemote(
  projectId: string,
  input: ScanExpirationsInput,
): Promise<ScanExpirationsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/expirations/scan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScanExpirationsResponse>(res);
}

// ── 2. build-finding-payload ───────────────────────────────────────────

export interface BuildExpirationPayloadInput {
  outcome: ExpirationOutcome;
}
export interface BuildExpirationPayloadResponse {
  payload: {
    type: 'expiration_warning';
    itemId: string;
    itemKind: ExpirationKind;
    label: string;
    expiresAt: string;
    daysUntilExpiry: number;
    severity: ExpirationSeverity;
    projectId?: string;
  };
}

export async function buildExpirationFindingPayloadRemote(
  projectId: string,
  input: BuildExpirationPayloadInput,
): Promise<BuildExpirationPayloadResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/expirations/build-finding-payload`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildExpirationPayloadResponse>(res);
}

export type { ScanOptions };
