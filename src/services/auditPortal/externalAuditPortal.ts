// Praeventio Guard — Sprint 39 Fase H.1: Portal Evidencias Auditor Externo.
//
// Cierra: Documento usuario "Recomendaciones nuevas §8"
//         Plan integral Top 15 #4
//
// Cuando llega un auditor externo (mandante, SUSESO, ISO, mutualidad,
// fiscalización), la empresa necesita darle acceso SOLO LECTURA a un
// SUBSET acotado del proyecto durante una ventana temporal. Sin VPN, sin
// usuario corporativo, sin compartir credenciales.
//
// Diseño:
//   - Cada portal tiene un TOKEN único + expiración + scope (módulos
//     accesibles + projectIds)
//   - El auditor accede vía URL: /audit-portal/{token}
//   - El backend valida token + scope + no-expirado en cada request
//   - Audit log de cada acceso (qué módulo, cuándo, qué descargó)
//
// Determinístico, sin LLM. Token = sha256(secret + id + createdAt).

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type AuditModule =
  | 'documents'
  | 'iper_matrix'
  | 'trainings'
  | 'epp'
  | 'incidents'
  | 'corrective_actions'
  | 'evidences'
  | 'compliance_snapshot';

export type AuditorAffiliation =
  | 'mandante' // empresa cliente
  | 'suseso' // organismo público
  | 'mutualidad' // ACHS, IST, Mutual Seguridad, ISL
  | 'iso' // certificadora externa
  | 'seremi' // fiscalización
  | 'dt' // Dirección del Trabajo
  | 'cliente' // cliente comercial
  | 'other';

export interface AuditPortalConfig {
  id: string;
  /** Token único — el auditor lo lleva en la URL. */
  accessToken: string;
  /** Quién creó el portal. */
  createdByUid: string;
  createdAt: string;
  /** Hasta cuándo es válido (TTL típico: 7-30 días). */
  expiresAt: string;
  /** Nombre del auditor / institución (sólo informativo, no auth). */
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  /** Scope: qué proyectos puede ver. */
  scopeProjectIds: string[];
  /** Scope: qué módulos. */
  scopeModules: AuditModule[];
  /** Notas para el equipo interno (no visibles al auditor). */
  internalNotes?: string;
  /** Si fue revocado manualmente antes de expirar. */
  revokedAt?: string;
  revokedByUid?: string;
  revokedReason?: string;
}

export type PortalStatus = 'active' | 'expired' | 'revoked';

export interface PortalAccessLog {
  portalId: string;
  accessedAt: string;
  module: AuditModule;
  /** Si el acceso fue una descarga (PDF/CSV) vs solo vista. */
  downloaded: boolean;
  /** Tamaño del payload en bytes (informativo). */
  payloadBytes?: number;
  /** IP del solicitante (audit trail). */
  ip?: string;
  userAgent?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Token generation
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera token de 32 bytes random + sha256 → 64 chars hex.
 * El secreto NO se almacena: solo el token público que viaja en URL.
 * Verificación = comparar el token entregado vs el guardado.
 */
export function generateAccessToken(): string {
  const raw = randomBytes(32);
  return bytesToHex(sha256(raw));
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────

export interface CreatePortalInput {
  id: string;
  createdByUid: string;
  auditorName: string;
  auditorAffiliation: AuditorAffiliation;
  auditorEmail?: string;
  scopeProjectIds: string[];
  scopeModules: AuditModule[];
  ttlDays: number;
  internalNotes?: string;
  now?: Date;
}

export class PortalValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'PortalValidationError';
  }
}

const MAX_TTL_DAYS = 90; // 3 meses máximo
const MIN_TTL_DAYS = 1;

export function createPortal(input: CreatePortalInput): AuditPortalConfig {
  if (input.ttlDays < MIN_TTL_DAYS || input.ttlDays > MAX_TTL_DAYS) {
    throw new PortalValidationError(
      'TTL_OUT_OF_RANGE',
      `ttlDays must be in [${MIN_TTL_DAYS}, ${MAX_TTL_DAYS}]`,
    );
  }
  if (input.scopeProjectIds.length === 0) {
    throw new PortalValidationError(
      'EMPTY_SCOPE',
      'must include at least one projectId in scope',
    );
  }
  if (input.scopeModules.length === 0) {
    throw new PortalValidationError(
      'EMPTY_MODULES',
      'must include at least one module in scope',
    );
  }
  if (input.auditorName.trim().length < 3) {
    throw new PortalValidationError(
      'AUDITOR_NAME_TOO_SHORT',
      'auditorName must be at least 3 chars',
    );
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    accessToken: generateAccessToken(),
    createdByUid: input.createdByUid,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.ttlDays * 86_400_000).toISOString(),
    auditorName: input.auditorName,
    auditorAffiliation: input.auditorAffiliation,
    auditorEmail: input.auditorEmail,
    scopeProjectIds: [...input.scopeProjectIds],
    scopeModules: [...input.scopeModules],
    internalNotes: input.internalNotes,
  };
}

export function derivePortalStatus(
  portal: AuditPortalConfig,
  now: Date = new Date(),
): PortalStatus {
  if (portal.revokedAt) return 'revoked';
  if (Date.parse(portal.expiresAt) < now.getTime()) return 'expired';
  return 'active';
}

export function revokePortal(
  portal: AuditPortalConfig,
  revokedByUid: string,
  reason: string,
  now: Date = new Date(),
): AuditPortalConfig {
  if (portal.revokedAt) {
    throw new PortalValidationError(
      'ALREADY_REVOKED',
      `portal ${portal.id} already revoked at ${portal.revokedAt}`,
    );
  }
  if (reason.trim().length < 10) {
    throw new PortalValidationError(
      'REASON_TOO_SHORT',
      'revoke reason must be ≥10 chars',
    );
  }
  return {
    ...portal,
    revokedAt: now.toISOString(),
    revokedByUid,
    revokedReason: reason.trim(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Access control
// ────────────────────────────────────────────────────────────────────────

export interface AccessRequest {
  token: string;
  module: AuditModule;
  projectId: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason?:
    | 'token_unknown'
    | 'portal_expired'
    | 'portal_revoked'
    | 'module_not_in_scope'
    | 'project_not_in_scope';
}

/**
 * Decide si un request del auditor está autorizado.
 * El caller resuelve el portal por `token` previamente.
 */
export function checkAccess(
  portal: AuditPortalConfig | null,
  request: AccessRequest,
  now: Date = new Date(),
): AccessDecision {
  if (!portal) return { allowed: false, reason: 'token_unknown' };
  if (portal.accessToken !== request.token) {
    return { allowed: false, reason: 'token_unknown' };
  }
  const status = derivePortalStatus(portal, now);
  if (status === 'expired') return { allowed: false, reason: 'portal_expired' };
  if (status === 'revoked') return { allowed: false, reason: 'portal_revoked' };
  if (!portal.scopeModules.includes(request.module)) {
    return { allowed: false, reason: 'module_not_in_scope' };
  }
  if (!portal.scopeProjectIds.includes(request.projectId)) {
    return { allowed: false, reason: 'project_not_in_scope' };
  }
  return { allowed: true };
}

// ────────────────────────────────────────────────────────────────────────
// Aggregations for ops dashboard
// ────────────────────────────────────────────────────────────────────────

export interface PortalUsageSummary {
  portalId: string;
  totalAccesses: number;
  totalDownloads: number;
  uniqueModulesAccessed: number;
  lastAccessAt?: string;
}

export function summarizePortalUsage(
  portal: AuditPortalConfig,
  logs: PortalAccessLog[],
): PortalUsageSummary {
  const own = logs.filter((l) => l.portalId === portal.id);
  const modules = new Set(own.map((l) => l.module));
  const lastAccess = own
    .map((l) => l.accessedAt)
    .sort()
    .pop();
  return {
    portalId: portal.id,
    totalAccesses: own.length,
    totalDownloads: own.filter((l) => l.downloaded).length,
    uniqueModulesAccessed: modules.size,
    lastAccessAt: lastAccess,
  };
}
