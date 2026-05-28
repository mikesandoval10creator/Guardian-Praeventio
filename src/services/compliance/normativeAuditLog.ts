// Praeventio Guard — §12.4.3: Audit log para mutaciones de normativa.
//
// Cualquier cambio en la tabla `regulatory/jurisdictions/` o equivalentes
// genera una entrada inmutable en el audit log que vincula:
//   - Quién hizo el cambio (uid + role)
//   - Qué cambió (before / after diff)
//   - Cuándo (ISO 8601)
//   - Razón (texto libre validado)
//   - Hash chain con previous entry (tamper-proof)
//
// Composable con `services/audit/tamperProofChain.ts` (existente para
// audit_logs generales). Esta extensión agrega scope `regulatory` con
// validaciones adicionales: nunca borrar entries, never mutate, append-only.
//
// Usado por endpoints que CRUD regulatory data (cuando existan).
// Por ahora regulatory está hardcoded en código; cuando se mueva a
// Firestore se invoca este logger.

export type RegulatoryMutationKind =
  | 'create_regulation'
  | 'update_regulation'
  | 'deprecate_regulation'
  | 'restore_regulation'
  | 'attach_evidence'
  | 'change_effective_date'
  | 'change_jurisdiction_status';

export interface RegulatoryMutationEvent {
  /** Tipo de mutación. */
  kind: RegulatoryMutationKind;
  /** UID del usuario que realiza el cambio. */
  byUid: string;
  /** Rol del usuario (auditable). */
  byRole: string;
  /** ID de la norma/jurisdicción afectada (e.g. "CL/DS-44-2024"). */
  regulationId: string;
  /** Razón obligatoria (mín 10 chars, máx 2000). */
  reason: string;
  /** Estado antes del cambio (JSON snapshot). */
  before: unknown;
  /** Estado después del cambio (JSON snapshot). */
  after: unknown;
  /** ISO 8601 timestamp del cambio. */
  at: string;
  /** Tenant que realizó cambio (puede ser 'system' para cambios globales). */
  tenantId: string;
}

export interface RegulatoryAuditEntry extends RegulatoryMutationEvent {
  /** ID único de la entry (UUID o hash). */
  entryId: string;
  /** Hash SHA-256 de esta entry + previousHash (tamper-proof chain). */
  hash: string;
  /** Hash de la entry previa (chain). */
  previousHash: string | null;
  /** Versión esquema (para migración futura). */
  schemaVersion: 1;
}

export class RegulatoryAuditError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RegulatoryAuditError';
    this.code = code;
  }
}

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 2000;

/**
 * Valida un evento antes de loguearlo. Lanza si los campos son inválidos.
 */
export function validateMutationEvent(event: RegulatoryMutationEvent): void {
  if (!event.byUid || typeof event.byUid !== 'string') {
    throw new RegulatoryAuditError('invalid_uid', 'byUid es requerido');
  }
  if (!event.byRole || typeof event.byRole !== 'string') {
    throw new RegulatoryAuditError('invalid_role', 'byRole es requerido');
  }
  if (!event.regulationId || typeof event.regulationId !== 'string') {
    throw new RegulatoryAuditError(
      'invalid_regulation_id',
      'regulationId es requerido',
    );
  }
  if (!event.reason || event.reason.length < MIN_REASON_LENGTH) {
    throw new RegulatoryAuditError(
      'reason_too_short',
      `reason debe tener ≥${MIN_REASON_LENGTH} caracteres (recibido ${event.reason?.length ?? 0})`,
    );
  }
  if (event.reason.length > MAX_REASON_LENGTH) {
    throw new RegulatoryAuditError(
      'reason_too_long',
      `reason no puede exceder ${MAX_REASON_LENGTH} caracteres`,
    );
  }
  if (!event.at || isNaN(Date.parse(event.at))) {
    throw new RegulatoryAuditError(
      'invalid_at',
      'at debe ser ISO 8601 timestamp válido',
    );
  }
  if (!event.tenantId) {
    throw new RegulatoryAuditError('invalid_tenant', 'tenantId es requerido');
  }
}

/**
 * Calcula hash SHA-256 determinístico para una entry. Cross-env (browser
 * crypto.subtle + node:crypto fallback).
 *
 * Para tests deterministas, exponemos también `hashStringSync` que usa
 * un fallback hash (no cryptographic — solo para tests sin async).
 */
export async function hashEntry(entry: Omit<RegulatoryAuditEntry, 'hash'>): Promise<string> {
  const canonical = JSON.stringify(entry, Object.keys(entry).sort());
  const bytes = new TextEncoder().encode(canonical);
  // Browser crypto.subtle si disponible
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node fallback
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Crea una entry de audit log con hash chain. Llama
 * `previousHash` con el último hash de la chain (null si es el primero).
 *
 * NO escribe a Firestore — esa responsabilidad queda en el adapter
 * (`adapters/regulatoryAuditFirestoreAdapter.ts` cuando se cree).
 *
 * Retorna entry completa lista para persistir.
 */
export async function createAuditEntry(
  event: RegulatoryMutationEvent,
  previousHash: string | null,
  entryId: string,
): Promise<RegulatoryAuditEntry> {
  validateMutationEvent(event);
  const unhashed: Omit<RegulatoryAuditEntry, 'hash'> = {
    ...event,
    entryId,
    previousHash,
    schemaVersion: 1,
  };
  const hash = await hashEntry(unhashed);
  return { ...unhashed, hash };
}

/**
 * Verifica integridad de una chain de audit entries.
 *
 * Reglas:
 *  1. entries[0].previousHash === null (primero de chain)
 *  2. entries[i].previousHash === entries[i-1].hash (chain)
 *  3. recomputar hash(entries[i]) === entries[i].hash (no tampered)
 *
 * Retorna { valid, errors[] } — `errors` describe falla en cada entry.
 */
export async function verifyAuditChain(
  entries: RegulatoryAuditEntry[],
): Promise<{ valid: boolean; errors: Array<{ entryId: string; reason: string }> }> {
  const errors: Array<{ entryId: string; reason: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const expectedPrev = i === 0 ? null : entries[i - 1]!.hash;
    if (entry.previousHash !== expectedPrev) {
      errors.push({
        entryId: entry.entryId,
        reason: `previousHash mismatch (expected ${expectedPrev}, got ${entry.previousHash})`,
      });
    }
    // Recompute hash
    const { hash: _hash, ...unhashed } = entry;
    const recomputed = await hashEntry(unhashed);
    if (recomputed !== entry.hash) {
      errors.push({
        entryId: entry.entryId,
        reason: `hash mismatch — entry tampered or schema changed`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Helper para diff sintético entre before/after JSON. Útil para UI
 * que muestra "qué cambió" sin parsear JSON anidado.
 *
 * Retorna lista de paths que cambiaron + before/after de cada uno.
 * No es deep — solo top-level fields. Para nested usar libs como
 * deep-diff (post Sprint K, fuera de scope inicial).
 */
export function shallowDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Array<{ key: string; before: unknown; after: unknown }> {
  const diff: Array<{ key: string; before: unknown; after: unknown }> = [];
  const b = before ?? {};
  const a = after ?? {};
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of allKeys) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      diff.push({ key, before: b[key], after: a[key] });
    }
  }
  return diff;
}
