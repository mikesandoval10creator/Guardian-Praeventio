// SPDX-License-Identifier: MIT
//
// Sprint 25 — HealthVault Share Token (ADR 0012)
//
// El trabajador es DUEÑO ABSOLUTO de su información médica. Para
// compartirla con un médico tratante (consultorio, mutual, especialista),
// genera un QR temporal que da acceso de lectura por 24h al subset
// que el trabajador eligió. El médico escanea, ve la información en su
// navegador, hace su consulta informada. Después de 24h, expira.
//
// Esta es la pieza brillante que cumple Ley 20.584 (derechos del paciente):
// el paciente tiene control absoluto sobre quién accede y cuándo.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type VaultShareScope = 'full' | 'recent' | 'topic';

export interface VaultShareToken {
  /** Token id (no contiene el secret crudo). */
  id: string;
  /** UID del trabajador dueño del vault. */
  workerUid: string;
  /** Alcance de los datos compartidos. */
  scope: VaultShareScope;
  /** Si scope === 'topic', el tema (ej. 'lumbalgia'). */
  topic?: string;
  /** Si scope === 'topic' o subset, IDs específicos. */
  recordIds?: string[];
  /** Hash SHA-256 del secret. NUNCA almacenamos el secret crudo. */
  tokenHash: string;
  /** Solo los primeros 8 chars del secret para display al worker. */
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number;
  /** Máximo número de consumos antes de invalidación automática. */
  maxConsumes: number;
  consumeCount: number;
  /** Histórico de consumos (audit). */
  consumes: Array<{
    at: number;
    viewerName: string;
    viewerUid?: string;
    viewerIpHash?: string;
  }>;
  revokedAt: number | null;
  revokedBy?: string;
}

export class VaultShareError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_token'
      | 'expired'
      | 'revoked'
      | 'max_consumes_reached'
      | 'max_sessions_reached'
      | 'recipient_mismatch'
      | 'professional_not_eligible'
      | 'owner_required'
      | 'recipient_confirmation_required'
      | 'malformed',
  ) {
    super(message);
    this.name = 'VaultShareError';
  }
}

export const DEFAULT_TTL_HOURS = 24;
export const DEFAULT_MAX_CONSUMES = 5;

/**
 * Genera un secret URL-safe + su hash. El secret es lo que va en el QR;
 * el hash es lo que persistimos. El secret crudo NO se guarda nunca.
 */
function generateSecret(): { secret: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('base64url'); // ~32 chars URL-safe
  const hash = createHash('sha256').update(raw).digest('hex');
  return { secret: raw, hash, prefix: raw.slice(0, 8) };
}

/**
 * Verifica un secret entrante contra el hash almacenado en constant time.
 */
export function verifySecret(secret: string, hash: string): boolean {
  if (typeof secret !== 'string' || typeof hash !== 'string') return false;
  const computed = createHash('sha256').update(secret).digest('hex');
  if (computed.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Crea un share token para un subset del HealthVault del trabajador.
 *
 * El trabajador es el ÚNICO que puede llamar esto. La función NO
 * persiste — devuelve el record + secret. El caller (route handler)
 * persiste el record en Firestore y devuelve el secret + QR al cliente
 * UNA SOLA VEZ.
 */
export function createShareToken(opts: {
  workerUid: string;
  scope: VaultShareScope;
  topic?: string;
  recordIds?: string[];
  ttlHours?: number;
  maxConsumes?: number;
  /** Override de "ahora" para tests deterministas. */
  now?: () => number;
}): { record: VaultShareToken; secret: string; qrPayload: string } {
  if (!opts.workerUid) throw new VaultShareError('workerUid required', 'malformed');
  if (opts.scope === 'topic' && !opts.topic) {
    throw new VaultShareError('topic required when scope=topic', 'malformed');
  }

  const now = (opts.now ?? Date.now)();
  const ttl = (opts.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
  const maxConsumes = opts.maxConsumes ?? DEFAULT_MAX_CONSUMES;

  const { secret, hash, prefix } = generateSecret();
  const id = `vs_${prefix}_${now.toString(36)}`;

  const record: VaultShareToken = {
    id,
    workerUid: opts.workerUid,
    scope: opts.scope,
    topic: opts.topic,
    recordIds: opts.recordIds,
    tokenHash: hash,
    tokenPrefix: prefix,
    createdAt: now,
    expiresAt: now + ttl,
    maxConsumes,
    consumeCount: 0,
    consumes: [],
    revokedAt: null,
  };

  // QR payload: URL-safe deeplink que el médico abre en su navegador.
  // El secret va en el path para que el clipboard del médico no quede
  // pegajoso con datos sensibles.
  const baseUrl = process.env.APP_BASE_URL ?? 'https://praeventio.app';
  const qrPayload = `${baseUrl}/vault/share/${id}/${secret}`;

  return { record, secret, qrPayload };
}

/**
 * Intenta consumir un share token. El médico (viewer) ya escaneó el QR
 * y abrió la URL en su navegador.
 *
 * Retorna el record actualizado + datos visibles. Si falla por
 * expiración / revocación / max-consumes, throws VaultShareError con
 * code específico.
 *
 * NO persiste — devuelve el patch que el caller debe escribir en
 * Firestore (atomic transaction).
 */
export function consumeShareToken(
  record: VaultShareToken,
  incomingSecret: string,
  viewer: {
    name: string;
    uid?: string;
    ipHash?: string;
  },
  options: { now?: () => number } = {},
): {
  patch: Pick<VaultShareToken, 'consumeCount' | 'consumes'>;
  recordIdsToReveal: string[] | 'all';
  topicHint?: string;
} {
  const now = (options.now ?? Date.now)();

  if (record.revokedAt !== null) {
    throw new VaultShareError('Token revoked', 'revoked');
  }
  if (now > record.expiresAt) {
    throw new VaultShareError('Token expired', 'expired');
  }
  if (record.consumeCount >= record.maxConsumes) {
    throw new VaultShareError('Max consumes reached', 'max_consumes_reached');
  }
  if (!verifySecret(incomingSecret, record.tokenHash)) {
    throw new VaultShareError('Invalid token', 'invalid_token');
  }

  const patch = {
    consumeCount: record.consumeCount + 1,
    consumes: [
      ...record.consumes,
      {
        at: now,
        viewerName: viewer.name,
        viewerUid: viewer.uid,
        viewerIpHash: viewer.ipHash,
      },
    ],
  };

  return {
    patch,
    recordIdsToReveal: record.scope === 'full' ? 'all' : record.recordIds ?? [],
    topicHint: record.topic,
  };
}

/**
 * Re-valida un share SIN consumir una unidad del presupuesto de vistas.
 * La usa el endpoint file-proxy: cada fetch de un blob debe re-chequear
 * revokedAt / expiry / secret sobre datos FRESCOS, de modo que un share
 * revocado nunca pueda servir el archivo — pero una sola página con N
 * archivos NO debe quemar N de maxConsumes. Lanza VaultShareError con
 * code específico (revoked / expired / max_consumes_reached / invalid_token).
 *
 * Es una función pura (no toca Firestore, no muta el record): el caller
 * la corre dentro de su runTransaction sobre el snapshot fresco.
 */
export function validateShareAccess(
  record: VaultShareToken,
  incomingSecret: string,
  options: { now?: () => number } = {},
): void {
  const now = (options.now ?? Date.now)();
  if (record.revokedAt !== null) {
    throw new VaultShareError('Token revoked', 'revoked');
  }
  if (now > record.expiresAt) {
    throw new VaultShareError('Token expired', 'expired');
  }
  if (record.consumeCount >= record.maxConsumes) {
    throw new VaultShareError('Max consumes reached', 'max_consumes_reached');
  }
  if (!verifySecret(incomingSecret, record.tokenHash)) {
    throw new VaultShareError('Invalid token', 'invalid_token');
  }
}

/**
 * True sólo si `recordId` está dentro del scope del share. Para `full`
 * (sin subset explícito) expone todo el vault. Para `recent` exige además
 * que el record esté dentro de la ventana de N días que /view muestra
 * (paridad con getRecentHealthRecords) — el caller pasa la fecha del
 * record vía `recordUploadedAt`. Para `topic` (o cualquier subset) sólo
 * los IDs fijados en record.recordIds.
 */
export function recordIdInShareScope(
  record: VaultShareToken,
  recordId: string,
  opts: { recordUploadedAt?: number; recentDaysBack?: number; now?: () => number } = {},
): boolean {
  if (typeof recordId !== 'string' || recordId.length === 0) return false;
  // Subset explícito siempre manda, sea cual sea el scope.
  if (record.recordIds !== undefined) {
    return record.recordIds.includes(recordId);
  }
  if (record.scope === 'full') {
    return true;
  }
  if (record.scope === 'recent') {
    // Paridad con /view: sólo records dentro de la ventana reciente.
    const daysBack = opts.recentDaysBack ?? 90;
    const uploadedAt = opts.recordUploadedAt;
    if (typeof uploadedAt !== 'number') return false;
    const now = (opts.now ?? Date.now)();
    const cutoff = now - daysBack * 24 * 60 * 60 * 1000;
    return uploadedAt >= cutoff;
  }
  // scope === 'topic' sin recordIds fijados -> nada explícito -> denegar.
  return false;
}

/**
 * Revoca un token explícitamente (worker decide cancelar acceso antes
 * del expiry natural).
 */
export function revokeShareToken(
  record: VaultShareToken,
  byUid: string,
  options: { now?: () => number } = {},
): { patch: Pick<VaultShareToken, 'revokedAt' | 'revokedBy'> } {
  if (record.revokedAt !== null) {
    return {
      patch: { revokedAt: record.revokedAt, revokedBy: record.revokedBy ?? byUid },
    };
  }
  const now = (options.now ?? Date.now)();
  return { patch: { revokedAt: now, revokedBy: byUid } };
}

/**
 * Helper para audit log entries. La política del ADR 0012 es:
 * cada create/consume/revoke/expire genera un audit row inmutable.
 */
export function buildAuditEntry(
  action:
    | 'health_vault.share.created'
    | 'health_vault.share.consumed'
    | 'health_vault.share.expired'
    | 'health_vault.share.revoked'
    | 'health_vault.share.file_accessed',
  record: VaultShareToken,
  extra?: Record<string, unknown>,
): {
  action: string;
  resourceType: 'health_vault';
  details: Record<string, unknown>;
  timestamp: number;
} {
  return {
    action,
    resourceType: 'health_vault',
    details: {
      tokenId: record.id,
      workerUid: record.workerUid,
      scope: record.scope,
      topic: record.topic,
      tokenPrefix: record.tokenPrefix, // safe to log
      consumeCount: record.consumeCount,
      ...extra,
    },
    timestamp: Date.now(),
  };
}

export type HealthAccessPurpose =
  | 'continuity_of_care'
  | 'second_opinion'
  | 'diagnostic_review'
  | 'occupational_health';

export interface HealthAccessGrantV2 {
  version: 2;
  id: string;
  ownerUid: string;
  scope: VaultShareScope;
  resourceIds: string[];
  recipientProfessionalUid?: string;
  purpose: HealthAccessPurpose;
  consentTextVersion: string;
  consentTextHash: string;
  consentedAt: number;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  tokenHash: string;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number;
  maxSessions: number;
  sessionCount: number;
  sessions: Array<{
    at: number;
    professionalUid: string;
    credentialIdHash: string;
  }>;
  revokedAt: number | null;
  revokedBy?: string;
}

export type GrantRecipientProfessional = {
  uid: string;
  status: 'pending' | 'provisional' | 'verified' | 'suspended' | 'revoked';
  webauthnRequired: boolean;
};

const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function requireGrantText(value: string, field: string, maxLength: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new VaultShareError(`${field} is invalid`, 'malformed');
  }
  return normalized;
}

export function createHealthAccessGrant(opts: {
  ownerUid: string;
  scope: VaultShareScope;
  resourceIds: string[];
  recipientProfessionalUid?: string;
  purpose: HealthAccessPurpose;
  consentTextVersion: string;
  consentText: string;
  ttlHours?: number;
  maxSessions?: number;
  now?: () => number;
}): { record: HealthAccessGrantV2; secret: string; qrPayload: string } {
  const ownerUid = requireGrantText(opts.ownerUid, 'ownerUid', 128);
  const consentTextVersion = requireGrantText(
    opts.consentTextVersion,
    'consentTextVersion',
    80,
  );
  const consentText = requireGrantText(opts.consentText, 'consentText', 4_000);
  if (!Array.isArray(opts.resourceIds) || opts.resourceIds.length === 0 || opts.resourceIds.length > 100) {
    throw new VaultShareError('resourceIds must contain 1-100 records', 'malformed');
  }
  const resourceIds = opts.resourceIds.map((id) => requireGrantText(id, 'resourceId', 128));
  if (resourceIds.some((id) => !GRANT_ID_PATTERN.test(id)) || new Set(resourceIds).size !== resourceIds.length) {
    throw new VaultShareError('resourceIds must be unique valid ids', 'malformed');
  }
  const recipientProfessionalUid = opts.recipientProfessionalUid
    ? requireGrantText(opts.recipientProfessionalUid, 'recipientProfessionalUid', 128)
    : undefined;
  const now = (opts.now ?? Date.now)();
  const ttlHours = opts.ttlHours ?? DEFAULT_TTL_HOURS;
  const maxSessions = opts.maxSessions ?? DEFAULT_MAX_CONSUMES;
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 168) {
    throw new VaultShareError('ttlHours is invalid', 'malformed');
  }
  if (!Number.isInteger(maxSessions) || maxSessions <= 0 || maxSessions > 20) {
    throw new VaultShareError('maxSessions is invalid', 'malformed');
  }
  const { secret, hash, prefix } = generateSecret();
  const id = `hvg_${prefix}_${now.toString(36)}`;
  const record: HealthAccessGrantV2 = {
    version: 2,
    id,
    ownerUid,
    scope: opts.scope,
    resourceIds: [...resourceIds],
    recipientProfessionalUid,
    purpose: opts.purpose,
    consentTextVersion,
    consentTextHash: createHash('sha256').update(consentText, 'utf8').digest('hex'),
    consentedAt: now,
    status: recipientProfessionalUid ? 'active' : 'pending',
    tokenHash: hash,
    tokenPrefix: prefix,
    createdAt: now,
    expiresAt: now + ttlHours * 60 * 60 * 1000,
    maxSessions,
    sessionCount: 0,
    sessions: [],
    revokedAt: null,
  };
  const baseUrl = process.env.APP_BASE_URL ?? 'https://praeventio.app';
  return {
    record,
    secret,
    qrPayload: `${baseUrl}/vault/share/${id}#${secret}`,
  };
}

export function confirmGrantRecipient(
  grant: HealthAccessGrantV2,
  actorUid: string,
  professionalUid: string,
  options: { now?: () => number } = {},
): HealthAccessGrantV2 {
  if (actorUid !== grant.ownerUid) {
    throw new VaultShareError('Only the owner may confirm a recipient', 'owner_required');
  }
  if (grant.status !== 'pending' || grant.recipientProfessionalUid) {
    throw new VaultShareError('Grant is not awaiting a recipient', 'recipient_confirmation_required');
  }
  const now = (options.now ?? Date.now)();
  if (now > grant.expiresAt) throw new VaultShareError('Grant expired', 'expired');
  return {
    ...grant,
    recipientProfessionalUid: requireGrantText(professionalUid, 'professionalUid', 128),
    status: 'active',
  };
}

export function validateGrantClaim(
  grant: HealthAccessGrantV2,
  secret: string,
  professional: GrantRecipientProfessional,
  options: { now?: () => number } = {},
): { resourceIds: string[] } {
  const now = (options.now ?? Date.now)();
  if (grant.status === 'revoked' || grant.revokedAt !== null) {
    throw new VaultShareError('Grant revoked', 'revoked');
  }
  if (grant.status === 'pending' || !grant.recipientProfessionalUid) {
    throw new VaultShareError('Recipient confirmation required', 'recipient_confirmation_required');
  }
  if (grant.status === 'expired' || now > grant.expiresAt) {
    throw new VaultShareError('Grant expired', 'expired');
  }
  if (!verifySecret(secret, grant.tokenHash)) {
    throw new VaultShareError('Invalid token', 'invalid_token');
  }
  if (grant.recipientProfessionalUid !== professional.uid) {
    throw new VaultShareError('Professional is not the selected recipient', 'recipient_mismatch');
  }
  if (
    professional.webauthnRequired !== true ||
    (professional.status !== 'provisional' && professional.status !== 'verified')
  ) {
    throw new VaultShareError('Professional is not eligible', 'professional_not_eligible');
  }
  if (grant.sessionCount >= grant.maxSessions) {
    throw new VaultShareError('Maximum sessions reached', 'max_sessions_reached');
  }
  return { resourceIds: [...grant.resourceIds] };
}

export function activateGrantSession(
  grant: HealthAccessGrantV2,
  professionalUid: string,
  credentialIdHash: string,
  options: { now?: () => number } = {},
): HealthAccessGrantV2 {
  if (grant.sessionCount >= grant.maxSessions) {
    throw new VaultShareError('Maximum sessions reached', 'max_sessions_reached');
  }
  if (grant.recipientProfessionalUid !== professionalUid) {
    throw new VaultShareError('Professional is not the selected recipient', 'recipient_mismatch');
  }
  const at = (options.now ?? Date.now)();
  return {
    ...grant,
    sessionCount: grant.sessionCount + 1,
    sessions: [
      ...grant.sessions,
      {
        at,
        professionalUid,
        credentialIdHash: requireGrantText(credentialIdHash, 'credentialIdHash', 128),
      },
    ],
  };
}

export function revokeHealthAccessGrant(
  grant: HealthAccessGrantV2,
  actorUid: string,
  options: { now?: () => number } = {},
): HealthAccessGrantV2 {
  if (actorUid !== grant.ownerUid) {
    throw new VaultShareError('Only the owner may revoke a grant', 'owner_required');
  }
  if (grant.status === 'revoked') return grant;
  const at = (options.now ?? Date.now)();
  return { ...grant, status: 'revoked', revokedAt: at, revokedBy: actorUid };
}
