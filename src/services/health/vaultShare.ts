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
  const qrPayload = `https://praeventio.app/vault/share/${id}/${secret}`;

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
    | 'health_vault.share.revoked',
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
