// Praeventio Guard — Wire-orphan Bloque 3 §3.7: client wrappers for the
// externalAuditPortal HTTP surface.
//
// Two surfaces:
//
//   ADMIN  — authenticated via Firebase ID token (auth.currentUser.getIdToken).
//            Used by `<PortalManager />`. CRUD over the tenant's portals.
//
//   PUBLIC — token-based, NO Firebase auth header. Used by `<PortalPublicView />`
//            embedded behind /audit-portal/{token}. The token IS the credential.
//
// Both share a tiny `json<T>` helper but use separate fetch wrappers so the
// public path never accidentally attaches a stale Firebase token when an
// admin happens to also be logged in (would mask token-only auth bugs in
// tests).

import { auth } from '../services/firebase';
import type {
  AuditModule,
  AuditorAffiliation,
} from '../services/auditPortal/externalAuditPortal';

// ────────────────────────────────────────────────────────────────────────
// Shared response envelope helper
// ────────────────────────────────────────────────────────────────────────

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
    throw new Error(body.message ?? body.error ?? body.code ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────────
// ADMIN — authenticated wrappers
// ────────────────────────────────────────────────────────────────────────

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

/** Server-rendered admin view of a portal (NO plaintext token). */
export interface AdminPortalView {
  id: string;
  createdByUid: string;
  createdAt: string;
  expiresAt: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  scopeProjectIds: string[];
  scopeModules: AuditModule[];
  internalNotes?: string;
  revokedAt?: string;
  revokedByUid?: string;
  revokedReason?: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface AdminPortalCreatedView extends AdminPortalView {
  /** Plaintext token, returned exactly once at create time. */
  oneTimeAccessToken: string;
}

// ── 1. create ───────────────────────────────────────────────────────────

export interface CreatePortalAdminInput {
  id: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  scopeProjectIds: string[];
  scopeModules: AuditModule[];
  ttlDays: number;
  internalNotes?: string;
}

export interface CreatePortalAdminResponse {
  portal: AdminPortalCreatedView;
}

export async function createExternalAuditPortal(
  input: CreatePortalAdminInput,
  opts: { idempotencyKey?: string } = {},
): Promise<CreatePortalAdminResponse> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await authedFetch('/api/audit-portal/create', {
    method: 'POST',
    body: JSON.stringify(input),
    headers,
  });
  return unwrap<CreatePortalAdminResponse>(res);
}

// ── 2. admin list ───────────────────────────────────────────────────────

export interface ListPortalsAdminInput {
  affiliation?: AuditorAffiliation;
  limit?: number;
}

export interface ListPortalsAdminResponse {
  portals: AdminPortalView[];
}

export async function listExternalAuditPortals(
  input: ListPortalsAdminInput = {},
): Promise<ListPortalsAdminResponse> {
  const qs = new URLSearchParams();
  if (input.affiliation) qs.set('affiliation', input.affiliation);
  if (typeof input.limit === 'number') qs.set('limit', String(input.limit));
  const path = qs.toString()
    ? `/api/audit-portal/admin/list?${qs.toString()}`
    : '/api/audit-portal/admin/list';
  const res = await authedFetch(path, { method: 'GET' });
  return unwrap<ListPortalsAdminResponse>(res);
}

// ── 3. revoke ───────────────────────────────────────────────────────────

export interface RevokePortalAdminInput {
  portalId: string;
  reason: string;
}

export interface RevokePortalAdminResponse {
  portal: AdminPortalView;
}

export async function revokeExternalAuditPortal(
  input: RevokePortalAdminInput,
  opts: { idempotencyKey?: string } = {},
): Promise<RevokePortalAdminResponse> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await authedFetch(
    `/api/audit-portal/${encodeURIComponent(input.portalId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason }),
      headers,
    },
  );
  return unwrap<RevokePortalAdminResponse>(res);
}

// ── 4. access log ───────────────────────────────────────────────────────

export interface PortalAccessLogEntry {
  portalId: string;
  accessedAt: string;
  module: AuditModule;
  downloaded: boolean;
  payloadBytes?: number;
  ip?: string;
  userAgent?: string;
}

export interface GetPortalAccessLogResponse {
  portalId: string;
  logs: PortalAccessLogEntry[];
}

export async function getExternalAuditPortalAccessLog(
  portalId: string,
  opts: { limit?: number } = {},
): Promise<GetPortalAccessLogResponse> {
  const qs = new URLSearchParams();
  if (typeof opts.limit === 'number') qs.set('limit', String(opts.limit));
  const path = qs.toString()
    ? `/api/audit-portal/${encodeURIComponent(portalId)}/access-log?${qs.toString()}`
    : `/api/audit-portal/${encodeURIComponent(portalId)}/access-log`;
  const res = await authedFetch(path, { method: 'GET' });
  return unwrap<GetPortalAccessLogResponse>(res);
}

// ────────────────────────────────────────────────────────────────────────
// PUBLIC — token-based, no Firebase auth header
// ────────────────────────────────────────────────────────────────────────

/** Sanitized portal view returned by the public GET — NO admin fields. */
export interface PortalPublicView {
  portalId: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  expiresAt: string;
  scopeModules: AuditModule[];
  scopeProjectIds: string[];
  module: AuditModule;
  projectId: string;
  tenantId: string;
}

export interface FetchPublicAuditPortalInput {
  token: string;
  module: AuditModule;
  projectId: string;
  /** If true, server appends downloaded=true to the access log. */
  download?: boolean;
}

export interface FetchPublicAuditPortalResponse {
  portal: PortalPublicView;
}

/**
 * Public token-only fetch. Used by `<PortalPublicView />` and standalone
 * since the route is unauthenticated (the token in the URL is the credential).
 *
 * Returns 403 with `Error('forbidden')` on any deny — opaque on purpose so a
 * malicious caller can't differentiate "wrong token" from "token expired"
 * from "out of scope". Same surface as healthVault/view.
 */
export async function fetchPublicAuditPortal(
  input: FetchPublicAuditPortalInput,
): Promise<FetchPublicAuditPortalResponse> {
  const qs = new URLSearchParams();
  qs.set('module', input.module);
  qs.set('projectId', input.projectId);
  if (input.download) qs.set('download', 'true');
  const res = await fetch(
    `/api/audit-portal/public/${encodeURIComponent(input.token)}?${qs.toString()}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
  );
  return unwrap<FetchPublicAuditPortalResponse>(res);
}
