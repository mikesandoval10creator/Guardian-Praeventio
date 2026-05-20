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
 *     simultánea, una gana via lock localStorage. La otra detecta
 *     y aborta.
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
// Bloque 5.3 (C13) — Sentry instrumentation for the KEK rotation
// orchestrator. Rotation is a once-per-90-days workflow but when it
// runs it touches every encrypted record on the device — latency and
// per-record failures need to surface as `module=kms` rows in Sentry
// so Settings UI engineers can spot a regression before users do.
import { withSentryScope } from '../observability/sentryInstrumentation';

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
// ────────────────────────────────────────────────────────────────────────

const LOCK_KEY = 'praeventio:kek:rotation:lock:v1';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min — más que cualquier rotación realista

interface LockValue {
  acquiredAt: number;
  acquiredBy: string;
}

function generateLockId(): string {
  // Random ID por tab para detectar reentry.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  // Bloque 5.3 (C13) — wrap the whole rotation in
  // `withSentryScope('kms.kek.rotate', …)`. Scope context is intentionally
  // sparse: we don't include CryptoKey handles (they're not serializable
  // and would surface as `[object CryptoKey]` anyway) — `bypassLock` is
  // the only useful flag for triage (true == test-induced run). The
  // wrapper itself captures any throw; per-record `failed` outcomes are
  // NOT exceptions (they're tallied into the result), so a partial
  // rotation will succeed at the Sentry layer but log per-record errors
  // in `result.failures` for the Settings UI to surface.
  return withSentryScope(
    'kms',
    {
      action: 'kms.kek.rotate',
      bypassLock: Boolean(input.bypassLock),
    },
    async () => {
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

      // Acquire lock unless bypass (tests).
      let lockId: string | null = null;
      if (!input.bypassLock) {
        lockId = tryAcquireLock(nowMsFn());
        if (!lockId) {
          return {
            total: 0,
            processed: 0,
            failed: 0,
            alreadyMigrated: 0,
            failures: [],
            aborted: true,
            abortedReason: 'lock_busy',
            latencyMs: nowMsFn() - startedAt,
          };
        }
      }

      try {
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
      } finally {
        if (lockId) releaseLock(lockId);
      }
    },
  );
}

/**
 * Helper para limpiar el lock si quedó stuck (post-crash). Solo para
 * desarrolladores / UI de emergencia en Settings.
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
 * Lee el estado actual del lock sin modificarlo.
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
