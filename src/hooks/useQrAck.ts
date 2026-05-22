// Praeventio Guard — QR Acknowledgement Sessions client hook (2 mutators).

import type {
  AckSession,
  AckItemKind,
  ScanResult,
} from '../services/qrAck/qrAckSessionEngine';
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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      result?: ScanResult;
    };
    // For validate-scan, the engine may surface a structured ScanResult under
    // result for HTTP 400 (replay / expired / no_consent / ...). Throw an
    // error that preserves the engine code so the UI can branch on it.
    if (body.result && body.result.ok === false) {
      const err = new Error(body.result.detail) as Error & {
        scanResult: ScanResult;
      };
      err.scanResult = body.result;
      throw err;
    }
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. create-session ──────────────────────────────────────────────────

/**
 * createdByUid (session creator) is forced server-side to the authenticated
 * caller, so it is not part of the client input. projectId comes from the
 * URL, not the body.
 */
export interface CreateAckSessionInput {
  itemKind: AckItemKind;
  itemId: string;
  itemLabel: string;
  ttlSeconds?: number;
}
export interface CreateAckSessionResponse {
  session: AckSession;
}

export async function createQrAckSession(
  projectId: string,
  input: CreateAckSessionInput,
): Promise<CreateAckSessionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/qr-ack/create-session`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CreateAckSessionResponse>(res);
}

// ── 2. validate-scan ───────────────────────────────────────────────────

/**
 * scannedByUid is forced server-side to the authenticated caller — the
 * worker firmando is whoever is logged in. Clients cannot proxy-sign for
 * another user.
 */
export interface ValidateQrAckScanInput {
  qrPayload: string;
  signature: string;
  consent: boolean;
  biometricUsed: boolean;
  scannedAtLocation?: { lat: number; lng: number };
}
export interface ValidateQrAckScanResponse {
  result: ScanResult;
}

export async function validateQrAckScan(
  projectId: string,
  input: ValidateQrAckScanInput,
): Promise<ValidateQrAckScanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/qr-ack/validate-scan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateQrAckScanResponse>(res);
}
