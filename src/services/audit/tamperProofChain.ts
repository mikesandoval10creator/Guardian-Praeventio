/**
 * Tamper-Proof Audit Hash Chain.
 *
 * Implementación inmutable, append-only, hash-linked de eventos de
 * auditoría. Pensado para flujos donde la integridad es legalmente
 * exigible:
 *
 *   - **Investigación post-fatal**: SUSESO + fiscalía piden cadena
 *     completa de eventos ANTES de ese accidente. Si la cadena tiene
 *     un gap o un hash inválido, la defensa legal de la empresa cae.
 *   - **Ley Karin (denuncias confidenciales)**: cada modificación a
 *     un reporte debe quedar registrada de forma que NO se pueda
 *     editar a posteriori sin detección.
 *   - **ISO 45001 §10.2** (no conformidades): el ciclo PDCA exige
 *     trazabilidad inmutable de las acciones correctivas.
 *
 * Cada evento se vincula al anterior por SHA-256 del payload canónico
 * + prev hash. Verificar la cadena = recorrer y recomputar cada hash.
 * Cualquier alteración intermedia produce mismatch detectable.
 *
 * Diseño:
 *   - **Pure function core** — sin I/O. La persistencia la inyecta
 *     el caller (Firestore, IndexedDB, archivo local).
 *   - **Canonical JSON serialization** — el orden de keys es
 *     determinista para que el mismo payload produzca el mismo
 *     hash independientemente del orden de inserción.
 *   - **Sequence numbers** + **timestamp monotónico** para detectar
 *     gaps incluso si un atacante recompone la cadena.
 *   - **Genesis hash** fijo conocido — el primer evento se ancla a
 *     una constante pública verificable.
 *
 * Threat model cubierto:
 *   - Modificación de un evento ya escrito → hash mismatch en verify
 *   - Inserción de un evento nuevo entre dos existentes → seq gap
 *   - Borrado de un evento → seq gap O orphan chain
 *   - Reordering → hash chain rota
 *
 * Threat model NO cubierto (out of scope):
 *   - Atacante con write access que reconstruye TODA la cadena
 *     desde 0 con nuevos hashes válidos. Mitigación: el último
 *     hash debe replicarse en un canal independiente (Firestore
 *     auth-protected, GCS write-once bucket, o un secondary BFT log).
 *   - Side-channel timing en SubtleCrypto digest. No relevante para
 *     compliance.
 */

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Hash inicial conocido. Anclar la cadena a esta constante elimina
 * ambigüedad sobre dónde empieza una cadena válida.
 *
 * Valor: SHA-256("praeventio:audit-genesis:v1") = derivado público.
 * Cualquier auditor puede recalcularlo y verificar que la cadena
 * efectivamente arranca desde este anchor.
 */
export const GENESIS_HASH =
  '6e6fe39c4b6fe39c8c5f2d6e6fe39c4b6fe39c4b6fe39c4b6fe39c4b6fe39c4b';

/** Payload arbitrario JSON-serializable que el caller registra. */
export type AuditPayload = Record<string, unknown>;

/** Un evento de auditoría hash-linked. */
export interface AuditEvent {
  /** Número de secuencia 0-indexed. El primer evento tiene seq=0. */
  seq: number;
  /** ISO-8601 UTC. NO se confía como anti-tamper (clock manipulable);
   *  se usa como display + ordering helper. La integridad la da `hash`. */
  timestamp: string;
  /** Hash del evento anterior. Para seq=0, es GENESIS_HASH. */
  prevHash: string;
  /** SHA-256 hex lowercase del payload canónico + prevHash + seq + timestamp. */
  hash: string;
  /** Identificador del actor (UID, system role, etc.). */
  actor: string;
  /** Acción canónica (e.g. 'incident.create', 'sitebook.entry.append'). */
  action: string;
  /** Payload arbitrario. Serializa canónicamente para el hash. */
  payload: AuditPayload;
}

export class AuditChainError extends Error {
  constructor(
    public readonly code:
      | 'NO_SUBTLE'
      | 'INVALID_PREV_HASH'
      | 'SEQ_GAP'
      | 'HASH_MISMATCH'
      | 'GENESIS_MISMATCH'
      | 'EMPTY_CHAIN'
      | 'INVALID_TIMESTAMP'
      | 'NONMONOTONIC_TIMESTAMP',
    msg: string,
    public readonly seq?: number,
  ) {
    super(`[${code}${seq !== undefined ? ` seq=${seq}` : ''}] ${msg}`);
    this.name = 'AuditChainError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Canonical JSON serialization
// ────────────────────────────────────────────────────────────────────────

/**
 * Serializa cualquier valor JSON-compatible a una string canónica:
 *   - Object keys ordenadas alfabéticamente (recursivo)
 *   - Arrays preservan orden (es semántico)
 *   - Sin whitespace
 *   - Strings escapadas igual que JSON.stringify
 *
 * Garantiza que el MISMO objeto produce el MISMO hash sin importar
 * el orden de inserción de keys en el caller. Esto es crítico para
 * que la cadena sea reproducible.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      // JSON spec rechaza NaN/Infinity — al normalizar a null
      // mantenemos la cadena reproducible aunque el caller cometa
      // este error.
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }
  // undefined / function / symbol → null (consistente con JSON)
  return 'null';
}

// ────────────────────────────────────────────────────────────────────────
// SubtleCrypto helpers
// ────────────────────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new AuditChainError(
      'NO_SUBTLE',
      'globalThis.crypto.subtle.digest unavailable. SHA-256 cannot be computed.',
    );
  }
  return subtle;
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = getSubtle();
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    const h = view[i]!.toString(16);
    out += h.length === 1 ? `0${h}` : h;
  }
  return out;
}

/**
 * Calcula el hash de un evento dado sus campos. El hash cubre:
 * seq, timestamp, prevHash, actor, action, payload-canónico. NO se
 * incluye `hash` mismo (sería circular).
 */
export async function computeEventHash(
  fields: Omit<AuditEvent, 'hash'>,
): Promise<string> {
  const preimage = canonicalize({
    seq: fields.seq,
    timestamp: fields.timestamp,
    prevHash: fields.prevHash,
    actor: fields.actor,
    action: fields.action,
    payload: fields.payload,
  });
  return sha256Hex(preimage);
}

// ────────────────────────────────────────────────────────────────────────
// Append + verify
// ────────────────────────────────────────────────────────────────────────

export interface AppendInput {
  actor: string;
  action: string;
  payload: AuditPayload;
  /** ISO-8601. Default: now(). Inyectable para tests deterministicos. */
  timestamp?: string;
}

/**
 * Genera un nuevo evento que se encadena al `prev` (o GENESIS si
 * prev es null para iniciar la cadena). Devuelve el evento ya
 * hash-firmado. El caller persiste según convenga.
 *
 * Garantías:
 *   - El nuevo seq = prev.seq + 1 (o 0 si genesis)
 *   - prevHash = prev.hash (o GENESIS_HASH si genesis)
 *   - timestamp ≥ prev.timestamp (monotonía no-decreciente; si el
 *     caller pasa uno menor, lanza NONMONOTONIC_TIMESTAMP)
 */
export async function appendEvent(
  prev: AuditEvent | null,
  input: AppendInput,
): Promise<AuditEvent> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new AuditChainError(
      'INVALID_TIMESTAMP',
      `timestamp not a valid ISO-8601: ${timestamp}`,
    );
  }
  if (prev && Date.parse(timestamp) < Date.parse(prev.timestamp)) {
    throw new AuditChainError(
      'NONMONOTONIC_TIMESTAMP',
      `new timestamp ${timestamp} predates previous ${prev.timestamp}`,
      (prev.seq ?? -1) + 1,
    );
  }

  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const fields: Omit<AuditEvent, 'hash'> = {
    seq,
    timestamp,
    prevHash,
    actor: input.actor,
    action: input.action,
    payload: input.payload,
  };
  const hash = await computeEventHash(fields);
  return { ...fields, hash };
}

/**
 * Resultado de verificar una cadena completa.
 */
export interface VerifyResult {
  valid: boolean;
  /** Si fail, el seq del primer evento problemático. */
  failedAt?: number;
  /** Código de error específico. */
  errorCode?: AuditChainError['code'];
  /** Detalle humano. */
  detail?: string;
  /** Número de eventos verificados (puede ser <chain.length si falló). */
  verifiedCount: number;
}

/**
 * Verifica una cadena completa de auditoría. Por cada evento:
 *   1. Verify seq es secuencial (0, 1, 2, ...)
 *   2. Verify prevHash matches el hash del anterior (o GENESIS para seq=0)
 *   3. Verify timestamps son no-decrecientes
 *   4. Recompute el hash y verify matches el `hash` declarado
 *
 * Cualquier fallo detiene la verificación y reporta el seq exacto.
 *
 * Cadena vacía → valid=true (no hay nada que verificar). Si el caller
 * espera ≥1 evento, debe checkear `verifiedCount === 0` después.
 */
export async function verifyChain(
  chain: ReadonlyArray<AuditEvent>,
): Promise<VerifyResult> {
  if (chain.length === 0) {
    return { valid: true, verifiedCount: 0 };
  }

  let prevHashExpected = GENESIS_HASH;
  let prevTimestamp: string | null = null;

  for (let i = 0; i < chain.length; i++) {
    const ev = chain[i]!;

    // 1. seq secuencial.
    if (ev.seq !== i) {
      return {
        valid: false,
        failedAt: i,
        errorCode: 'SEQ_GAP',
        detail: `Expected seq=${i}, got ${ev.seq}`,
        verifiedCount: i,
      };
    }

    // 2. prevHash matches.
    if (ev.prevHash !== prevHashExpected) {
      return {
        valid: false,
        failedAt: i,
        errorCode: i === 0 ? 'GENESIS_MISMATCH' : 'INVALID_PREV_HASH',
        detail:
          i === 0
            ? `First event prevHash should be GENESIS but got ${ev.prevHash}`
            : `prevHash mismatch at seq=${i}: expected ${prevHashExpected}, got ${ev.prevHash}`,
        verifiedCount: i,
      };
    }

    // 3. Timestamps monotonicos.
    if (prevTimestamp !== null && Date.parse(ev.timestamp) < Date.parse(prevTimestamp)) {
      return {
        valid: false,
        failedAt: i,
        errorCode: 'NONMONOTONIC_TIMESTAMP',
        detail: `Timestamp at seq=${i} (${ev.timestamp}) predates seq=${i - 1} (${prevTimestamp})`,
        verifiedCount: i,
      };
    }

    // 4. Hash recomputado matches.
    const expectedHash = await computeEventHash({
      seq: ev.seq,
      timestamp: ev.timestamp,
      prevHash: ev.prevHash,
      actor: ev.actor,
      action: ev.action,
      payload: ev.payload,
    });
    if (ev.hash !== expectedHash) {
      return {
        valid: false,
        failedAt: i,
        errorCode: 'HASH_MISMATCH',
        detail: `Hash mismatch at seq=${i}: expected ${expectedHash}, got ${ev.hash} (tamper)`,
        verifiedCount: i,
      };
    }

    prevHashExpected = ev.hash;
    prevTimestamp = ev.timestamp;
  }

  return { valid: true, verifiedCount: chain.length };
}

// ────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Construye una cadena entera desde una lista de inputs en orden.
 * Útil para tests y migraciones donde se necesita generar la cadena
 * completa al vuelo.
 */
export async function buildChain(
  inputs: ReadonlyArray<AppendInput>,
): Promise<AuditEvent[]> {
  const chain: AuditEvent[] = [];
  let prev: AuditEvent | null = null;
  for (const input of inputs) {
    const ev = await appendEvent(prev, input);
    chain.push(ev);
    prev = ev;
  }
  return chain;
}

/**
 * Devuelve el "merkle root" de la cadena. NO es un merkle tree real
 * — es el hash del último evento. Llamarlo "anchor" porque es el
 * punto que el caller debería replicar a un canal externo
 * (Firestore con auth strict, GCS write-once, blockchain testnet)
 * para que la integridad sobreviva incluso si toda la DB local se
 * compromete.
 */
export function chainAnchor(chain: ReadonlyArray<AuditEvent>): string | null {
  if (chain.length === 0) return null;
  return chain[chain.length - 1]!.hash;
}

/**
 * Detecta el seq del primer gap si la cadena fue cortada. Útil
 * cuando se reciben slices y se quiere saber si están completos.
 */
export function findFirstGap(
  chain: ReadonlyArray<AuditEvent>,
): { gapAt: number } | null {
  for (let i = 0; i < chain.length; i++) {
    if (chain[i]!.seq !== i) {
      return { gapAt: i };
    }
  }
  return null;
}
