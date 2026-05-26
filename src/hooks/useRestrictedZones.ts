// Praeventio Guard — Restricted Zones client hook.
//
// Wraps the five endpoints of `src/server/routes/restrictedZones.ts`:
//   • defineRestrictedZone        — POST /api/zones/define
//   • listRestrictedZonesBySite   — GET  /api/zones/by-site/:projectId
//   • checkZoneEntryRemote        — POST /api/zones/check
//   • logZoneEntryEvent           — POST /api/zones/entry-event
//   • fetchZoneEntryPermissions   — GET  /api/zones/entry-permissions/:projectId/:workerUid
//
// Founder directive — NUNCA BLOQUEAR ACCESO FÍSICO:
//   `logZoneEntryEvent` ALWAYS attempts to persist the event regardless of
//   the engine's `allowed: true/false`. A `false` from the engine is a
//   recommendation, not a denial. The UI uses this hook to record an
//   informed-entry acknowledgement; it never refuses to call this hook on
//   the basis of `allowed === false`.

import { auth } from '../services/firebase';
import type {
  RestrictedZone,
  ZoneEntryResult,
} from '../services/zones/restrictedZonesEngine';

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

// ── 1. define ─────────────────────────────────────────────────────────

export interface DefineZoneInput {
  projectId: string;
  zone: RestrictedZone;
}
export interface DefineZoneResponse {
  success: true;
  zoneId: string;
}

export async function defineRestrictedZone(
  input: DefineZoneInput,
  idempotencyKey?: string,
): Promise<DefineZoneResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch('/api/zones/define', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return json<DefineZoneResponse>(res);
}

// ── 2. list by site ────────────────────────────────────────────────────

export interface ListZonesBySiteResponse {
  zones: RestrictedZone[];
}

export async function listRestrictedZonesBySite(
  projectId: string,
): Promise<ListZonesBySiteResponse> {
  const res = await authedFetch(
    `/api/zones/by-site/${encodeURIComponent(projectId)}`,
  );
  return json<ListZonesBySiteResponse>(res);
}

// ── 3. check (pure compute) ────────────────────────────────────────────

export interface CheckZoneEntryInput {
  projectId: string;
  workerUid: string;
  workerEppLabels: string[];
  workerTrainings: string[];
  workerActivePermitKinds: string[];
  zone: RestrictedZone;
  now?: string;
}

export interface CheckZoneEntryResponse {
  result: ZoneEntryResult;
}

export async function checkZoneEntryRemote(
  input: CheckZoneEntryInput,
): Promise<CheckZoneEntryResponse> {
  const res = await authedFetch('/api/zones/check', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<CheckZoneEntryResponse>(res);
}

// ── 4. entry-event (informed-entry log, NEVER blocks) ─────────────────

export interface LogZoneEntryEventInput {
  projectId: string;
  zoneId: string;
  workerUid: string;
  evaluation: ZoneEntryResult;
  zoneSnapshot?: RestrictedZone;
  workerSnapshot?: {
    workerEppLabels: string[];
    workerTrainings: string[];
    workerActivePermitKinds: string[];
  };
  acknowledgedAt?: string;
  notes?: string;
}

export interface LogZoneEntryEventResponse {
  success: true;
  eventId: string;
  evaluation: ZoneEntryResult;
  recorded: true;
}

export async function logZoneEntryEvent(
  input: LogZoneEntryEventInput,
  idempotencyKey?: string,
): Promise<LogZoneEntryEventResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch('/api/zones/entry-event', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return json<LogZoneEntryEventResponse>(res);
}

// ── 5. entry-permissions ──────────────────────────────────────────────

export interface FetchZoneEntryPermissionsInput {
  projectId: string;
  workerUid: string;
  eppLabels?: string[];
  trainings?: string[];
  permits?: string[];
}

export interface ZoneEntryPermissionRow {
  zoneId: string;
  zone: RestrictedZone;
  result: ZoneEntryResult;
}

export interface FetchZoneEntryPermissionsResponse {
  permissions: ZoneEntryPermissionRow[];
}

export async function fetchZoneEntryPermissions(
  input: FetchZoneEntryPermissionsInput,
): Promise<FetchZoneEntryPermissionsResponse> {
  const params = new URLSearchParams();
  if (input.eppLabels?.length) params.set('eppLabels', input.eppLabels.join(','));
  if (input.trainings?.length) params.set('trainings', input.trainings.join(','));
  if (input.permits?.length) params.set('permits', input.permits.join(','));
  const qs = params.toString();
  const path = `/api/zones/entry-permissions/${encodeURIComponent(
    input.projectId,
  )}/${encodeURIComponent(input.workerUid)}${qs ? `?${qs}` : ''}`;
  const res = await authedFetch(path);
  return json<FetchZoneEntryPermissionsResponse>(res);
}
