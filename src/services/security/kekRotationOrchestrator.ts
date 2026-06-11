/**
 * KEK Rotation Orchestrator.
 *
 * El `resilienceHealthMonitor` (#231) recomienda rotar la KEK cuando
 * tiene >90 días, pero hoy NO hay flujo que ejecute la rotación
 * end-to-end. Esta pieza cierra el gap:
 *
 *   1. Toma snapshot de la KEK actual (old)
 *   2. Genera + persiste una KEK nueva (new) reemplazando la actual
 *   3. Por cada envelope cifrado en `encryptedKvStore`:
 *      - Lee el record (envelope)
 *      - `rewrapEnvelope(env, oldKek, newKek)` — solo cambia el
 *        wrappedDek (~60B), NO re-encripta el payload (KB/MB)
 *      - Persiste el re-wrapped envelope con la misma key
 *   4. Reporta stats (rotated / failed / total)
 *
 * Diseño:
 *   - **Atomicidad parcial**: si un re-wrap individual falla (e.g.
 *     KEK vieja no descifra ese envelope porque ya fue rotated en
 *     otra tab), se loggea y se sigue con el resto. La rotación NO
 *     es transaccional — el orchestrator deja un campo
 *     `rotationVersion` en cada record migrado para que un re-run
 *     pueda detectar "ya migrado" idempotente.
 *   - **In-flight protection**: si dos tabs disparan rotación
 *     simultánea, una gana el mutex y la otra detecta y aborta. El
 *     mecanismo primario es la Web Locks API (`navigator.locks`) —
 *     mutex real cross-tab con liberación automática si la tab muere.
 *     Cuando el API no existe (Safari viejo / SSR / tests) se cae al
 *     lock localStorage con double-check (no atómico, best-effort).
 *   - **Progress callback**: caller pasa `onProgress(processed,
 *     total)` para UI banner durante la migración.
 *   - **Inyección**: la `oldKek` la pasa el caller (típicamente
 *     desde getOrCreateDeviceKek() ANTES de rotar). Esto evita race
 *     condition donde el orchestrator rota antes de tener
 *     referencia in-memory a la vieja.
 *
 * Caller pattern productivo:
 * ```
 * const oldKek = await getOrCreateDeviceKek();
 * const newKek = await rotateDeviceKek();
 * const result = await runKekRotation({
 *   oldKek,
 *   newKek,
 *   onProgress: (p, t) => setProgress(p / t),
 * });
 * // result: { processed, failed, total, abortedReason? }
 * ```
 */

import {
  decryptEnvelope,
  rewrapEnvelope,
  validateEnvelope,
  type BrowserEnvelope,
} from './browserEnvelope';
import {
  getRawEnvelope,
  listEncryptedKeys,
  setRawEnvelope,
} from './encryptedKvStore';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface KekRotationInput {
  /** La KEK que envolvió los envelopes actuales. Caller la obtiene
   *  ANTES de llamar `rotateDeviceKek()`. */
  oldKek: CryptoKey;
  /** La nueva KEK que reemplazó la anterior en `deviceKek`. */
  newKek: CryptoKey;
  /** Callback de progreso, llamado por cada record procesado. */
  onProgress?: (processed: number, total: number) => void;
  /** Si está set, sobrescribe el lock check (solo para tests). */
  bypassLock?: boolean;
}

export interface KekRotationResult {
  /** Total de records inspeccionados. */
  total: number;
  /** Records exitosamente re-envueltos con la nueva KEK. */
  processed: number;
  /** Records que fallaron (e.g. envelope corrupto, KEK vieja no descifra). */
  failed: number;
  /** Records que ya estaban en la versión nueva (skip idempotente). */
  alreadyMigrated: number;
  /** Lista de keys fallidos con el motivo (audit + retry). */
  failures: Array<{ key: string; error: string }>;
  /** True si la rotación se abortó antes de empezar. */
  aborted: boolean;
  /** Motivo del abort. */
  abortedReason?: 'lock_busy' | 'no_records';
  /** Latencia total ms. */
  latencyMs: number;
}

export class KekRotationError extends Error {
  constructor(
    public readonly code: 'LOCK_BUSY' | 'NO_OLD_KEK' | 'INVALID_INPUT',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'KekRotationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Lock — evita rotaciones simultáneas en distintas tabs
//
// Primario: Web Locks API. Es un mutex REAL provisto por el browser
// (atómico cross-tab, auto-release cuando el holder muere o navega),
// exactamente lo que una rotación de llaves criptográficas necesita.
// Fallback: lock localStorage con double-check — el propio double-check
// admite que localStorage no es atómico, así que solo se usa cuando
// `navigator.locks` no existe (Safari viejo, SSR, jsdom/tests).
// ────────────────────────────────────────────────────────────────────────

const LOCK_KEY = 'praeventio:kek:rotation:lock:v1';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min — más que cualquier rotación realista

interface LockValue {
  acquiredAt: number;
  acquiredBy: string;
}

/**
 * Shape mínimo de `navigator.locks` que usamos. Tipado estructural para
 * no depender de que lib.dom incluya LockManager en todos los targets.
 */
interface WebLockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => T | Promise<T>,
  ): Promise<T>;
}

function getWebLocks(): WebLockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: WebLockManagerLike } })
    .navigator;
  if (nav?.locks && typeof nav.locks.request === 'function') {
    return nav.locks;
  }
  return null;
}

// PR #482 codex round-4 P2: counter monotónico de fallback cuando Web
// Crypto no está disponible (SSR / older Node / restricted webview).
// El lock id no es cryptographic — solo necesita unicidad inter-tab.
let lockIdFallbackCounter = 0;

/** Exported for tests only — covers the Web-Crypto-missing branch. */
export function __generateLockIdForTests(): string {
  return generateLockId();
}

function generateLockId(): string {
  // Random ID por tab para detectar reentry. Prefiere Web Crypto CSPRNG;
  // cae a Math.random + counter + ms cuando crypto.getRandomValues no
  // existe (SSR / older Node / restricted webview).
  const ts = Date.now().toString(36);
  const bytes = new Uint8Array(6);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?(b: Uint8Array): void } })
    .crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Codex round-5 P1 (PR #483 follow-up) — el fallback previo era
    // counter + ms únicamente. Dos tabs del mismo origin ambos arrancan
    // `lockIdFallbackCounter = 0`, así que si llamaban en el mismo ms
    // generaban el mismo `acquiredBy` → `tryAcquireLock` los daba ambos
    // por ganadores → KEK rotation corría concurrente. Rompía el mutex
    // precisamente en el entorno que el fallback target (webview).
    //
    // Math.random() tiene un seed inicial distinto por tab (V8/Spider
    // Monkey inicializan con time + PID + pointer addr), entonces el r32
    // de cada tab es independiente. NO es CSPRNG — pero acá no hace falta:
    // el lock no es secreto, solo necesita unicidad inter-tab. Las DEKs
    // reales viven en kmsEnvelope/kmsAdapter con node:crypto.randomBytes.
    //
    // Counter monotónico se mantiene en bytes[4..5] para resolver el caso
    // raro donde Math.random colisiona dentro del mismo tab en el mismo
    // ms (Math.random no garantiza no-repetición consecutiva).
    const r32 = Math.floor(Math.random() * 0x100000000) >>> 0;
    lockIdFallbackCounter = (lockIdFallbackCounter + 1) >>> 0;
    const ms16 = Date.now() & 0xffff;
    const mix = (lockIdFallbackCounter ^ ms16) >>> 0;
    bytes[0] = (r32 >>> 24) & 0xff;
    bytes[1] = (r32 >>> 16) & 0xff;
    bytes[2] = (r32 >>> 8) & 0xff;
    bytes[3] = r32 & 0xff;
    bytes[4] = (mix >>> 8) & 0xff;
    bytes[5] = mix & 0xff;
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${ts}-${hex}`;
}

function tryAcquireLock(nowMs: number): string | null {
  if (typeof localStorage === 'undefined') return generateLockId(); // SSR — no lock real
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LockValue;
      if (parsed.acquiredAt && nowMs - parsed.acquiredAt < LOCK_TTL_MS) {
        return null; // lock held by another tab
      }
      // Lock expired (TTL) — overwrite below.
    }
    const id = generateLockId();
    const value: LockValue = { acquiredAt: nowMs, acquiredBy: id };
    localStorage.setItem(LOCK_KEY, JSON.stringify(value));
    // Verify we won (defensive double-check for race conditions in non-atomic localStorage).
    const verify = localStorage.getItem(LOCK_KEY);
    if (!verify) return null;
    const verified = JSON.parse(verify) as LockValue;
    if (verified.acquiredBy !== id) return null;
    return id;
  } catch {
    return null;
  }
}

function releaseLock(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as LockValue;
    if (parsed.acquiredBy === id) {
      localStorage.removeItem(LOCK_KEY);
    }
    // Si otro tab adquirió el lock encima (TTL expired race), NO lo
    // borramos — defensivo.
  } catch {
    // ignore
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-record rotation
// ────────────────────────────────────────────────────────────────────────

/**
 * Detecta si un value en encryptedKvStore parece un BrowserEnvelope.
 * El store puede tener otros shapes (records custom), pero nosotros
 * solo migramos los envelopes válidos.
 */
function isLikelyEnvelope(value: unknown): value is BrowserEnvelope {
  try {
    validateEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

interface RotatePerRecordResult {
  status: 'rotated' | 'already-migrated' | 'not-envelope' | 'failed';
  error?: string;
}

async function rotatePerRecord(
  key: string,
  oldKek: CryptoKey,
  newKek: CryptoKey,
): Promise<RotatePerRecordResult> {
  // Leemos el envelope CRUDO (sin descifrar) — `getEncrypted` falla
  // porque ya rotamos la device KEK; el envelope sigue envuelto con
  // la vieja y la nueva no lo descifra todavía. `getRawEnvelope`
  // bypasea esa fricción.
  let envelope: BrowserEnvelope | null;
  try {
    envelope = await getRawEnvelope(key);
  } catch (err) {
    return {
      status: 'failed',
      error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!envelope) {
    // Borrado entre listKeys y read — ignorar.
    return { status: 'not-envelope' };
  }
  if (!isLikelyEnvelope(envelope)) {
    return { status: 'not-envelope' };
  }

  // Detectar idempotencia: si el envelope ya descifra con la newKek,
  // ya fue migrado por una run anterior (o por otra tab) — skip.
  try {
    await decryptEnvelope(envelope, newKek);
    return { status: 'already-migrated' };
  } catch {
    // No descifra con la nueva → necesita rewrap (caso normal).
  }

  try {
    const rewrapped = await rewrapEnvelope(envelope, oldKek, newKek);
    await setRawEnvelope(key, rewrapped);
    return { status: 'rotated' };
  } catch (err) {
    return {
      status: 'failed',
      error: `rewrap failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main entrypoint
// ────────────────────────────────────────────────────────────────────────

export async function runKekRotation(
  input: KekRotationInput,
  nowMsFn: () => number = Date.now,
): Promise<KekRotationResult> {
  if (!input.oldKek || !input.newKek) {
    throw new KekRotationError(
      'INVALID_INPUT',
      'oldKek and newKek must be provided',
    );
  }
  if (input.oldKek === input.newKek) {
    throw new KekRotationError(
      'INVALID_INPUT',
      'oldKek and newKek are the same — rotation is a no-op',
    );
  }

  const startedAt = nowMsFn();

  // Bypass (tests): rotación directa sin mutex.
  if (input.bypassLock) {
    return executeRotation(input, nowMsFn, startedAt);
  }

  // Mecanismo primario: Web Locks API — mutex atómico cross-tab con
  // liberación automática al resolver el callback (o si la tab crashea).
  const webLocks = getWebLocks();
  if (webLocks) {
    const outcome = await webLocks.request(
      LOCK_KEY,
      { ifAvailable: true },
      async (lock): Promise<KekRotationResult | null> => {
        if (!lock) return null; // held by another tab
        return executeRotation(input, nowMsFn, startedAt);
      },
    );
    return outcome ?? lockBusyResult(nowMsFn() - startedAt);
  }

  // Fallback: lock localStorage best-effort (navigator.locks ausente).
  const lockId = tryAcquireLock(nowMsFn());
  if (!lockId) {
    return lockBusyResult(nowMsFn() - startedAt);
  }
  try {
    return await executeRotation(input, nowMsFn, startedAt);
  } finally {
    releaseLock(lockId);
  }
}

function lockBusyResult(latencyMs: number): KekRotationResult {
  return {
    total: 0,
    processed: 0,
    failed: 0,
    alreadyMigrated: 0,
    failures: [],
    aborted: true,
    abortedReason: 'lock_busy',
    latencyMs,
  };
}

/** Cuerpo de la rotación — el caller ya resolvió el mutex. */
async function executeRotation(
  input: KekRotationInput,
  nowMsFn: () => number,
  startedAt: number,
): Promise<KekRotationResult> {
  const allKeys = await listEncryptedKeys();
  if (allKeys.length === 0) {
    return {
      total: 0,
      processed: 0,
      failed: 0,
      alreadyMigrated: 0,
      failures: [],
      aborted: true,
      abortedReason: 'no_records',
      latencyMs: nowMsFn() - startedAt,
    };
  }

  let processed = 0;
  let failed = 0;
  let alreadyMigrated = 0;
  const failures: Array<{ key: string; error: string }> = [];

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i]!;
    const r = await rotatePerRecord(key, input.oldKek, input.newKek);
    if (r.status === 'rotated') {
      processed++;
    } else if (r.status === 'already-migrated') {
      alreadyMigrated++;
    } else if (r.status === 'failed') {
      failed++;
      failures.push({ key, error: r.error ?? 'unknown' });
    }
    // 'not-envelope' → simplemente skip sin contar como fail
    input.onProgress?.(i + 1, allKeys.length);
  }

  return {
    total: allKeys.length,
    processed,
    failed,
    alreadyMigrated,
    failures,
    aborted: false,
    latencyMs: nowMsFn() - startedAt,
  };
}

/**
 * Helper para limpiar el lock localStorage (fallback) si quedó stuck
 * (post-crash). Solo para desarrolladores / UI de emergencia en Settings.
 * Con Web Locks no hace falta: el browser libera el lock al morir la tab.
 */
export function forceReleaseRotationLock(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
}

/**
 * Lee el estado actual del lock localStorage (fallback) sin modificarlo.
 */
export function inspectRotationLock(
  nowMs: number = Date.now(),
): {
  held: boolean;
  ageMs?: number;
  expired?: boolean;
} {
  if (typeof localStorage === 'undefined') return { held: false };
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { held: false };
    const parsed = JSON.parse(raw) as LockValue;
    const ageMs = nowMs - parsed.acquiredAt;
    return {
      held: true,
      ageMs,
      expired: ageMs > LOCK_TTL_MS,
    };
  } catch {
    return { held: false };
  }
}
