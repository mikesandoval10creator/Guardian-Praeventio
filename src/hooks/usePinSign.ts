// Praeventio Guard — PIN Sign client hook (5 mutators, F.25).
//
// workerUid is forced to the authenticated caller server-side. The hash
// + salt nunca cruzan al cliente — `register` solo confirma éxito; el
// servidor persiste la credential.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  PinCredential,
  PinSignItemKind,
  PinSignedAcknowledgement,
} from '../services/pinSign/pinSignService';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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
  if (!res.ok && res.status !== 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. validate-policy ─────────────────────────────────────────────────

export async function validatePinPolicyApi(
  projectId: string,
  input: { pin: string },
): Promise<{ ok: boolean }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pin-sign/validate-policy`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ ok: boolean }>(res);
}

// ── 2. register ────────────────────────────────────────────────────────

export interface RegisterPinResponse {
  registered: true;
  workerUid: string;
  createdAt: string;
}

export async function registerPinApi(
  projectId: string,
  input: { pin: string },
): Promise<RegisterPinResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pin-sign/register`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RegisterPinResponse>(res);
}

// ── 3. verify ──────────────────────────────────────────────────────────

export interface VerifyPinResponse {
  ok: boolean;
  justLockedOut: boolean;
  remainingLockoutMinutes?: number;
  credential: PinCredential;
}

export async function verifyPinApi(
  projectId: string,
  input: { credential: PinCredential; pin: string },
): Promise<VerifyPinResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pin-sign/verify`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<VerifyPinResponse>(res);
}

// ── 4. sign-item  (verify + build ack atomic) ──────────────────────────

export interface SignItemInput {
  credential: PinCredential;
  pin: string;
  itemId: string;
  kind: PinSignItemKind;
  location?: { lat: number; lng: number };
}

export interface SignItemResponse {
  ok: boolean;
  acknowledgement?: PinSignedAcknowledgement;
  justLockedOut?: boolean;
  remainingLockoutMinutes?: number;
  credential: PinCredential;
}

export async function signItemWithPinApi(
  projectId: string,
  input: SignItemInput,
): Promise<SignItemResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pin-sign/sign-item`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SignItemResponse>(res);
}

// ── 5. verify-acknowledgement  (audit) ─────────────────────────────────

export async function verifyPinAcknowledgementApi(
  projectId: string,
  input: { acknowledgement: PinSignedAcknowledgement },
): Promise<{ ok: boolean }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pin-sign/verify-acknowledgement`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ ok: boolean }>(res);
}
